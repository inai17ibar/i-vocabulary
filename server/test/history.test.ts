import { describe, expect, it } from "vitest";
import type { CardDetail, HistoryResponse, ReviewLogPage, ScheduleResponse, StudySession } from "@ivocab/shared";
import { setup } from "./helpers.ts";

/** 新出カードを取ってきて、指定の評価で回答する */
async function studied(grades: (1 | 2 | 3 | 4)[]) {
  const ctx = await setup();
  const s = (await ctx.call("GET", "/study/session?task=new")).body as StudySession;
  const qs = s.questions.slice(0, grades.length);
  for (const [i, q] of qs.entries()) await ctx.call("POST", "/reviews", { cardId: q.cardId, grade: grades[i], mode: "flashcard" });
  return { ...ctx, session: s, qs };
}

describe("review log", () => {
  it("lists answers newest first with headlines and pages with a cursor", async () => {
    const { call, qs, session } = await studied([3, 1, 4, 2, 3]);
    const p1 = (await call("GET", "/reviews?limit=2")).body as ReviewLogPage;
    expect(p1.reviews.map((r) => r.cardId)).toEqual([qs[4].cardId, qs[3].cardId]);
    expect(p1.reviews[0]).toMatchObject({ grade: 3, correct: true, mode: "flashcard", stateBefore: "new" });
    const word = session.questions.find((q) => q.cardId === qs[4].cardId)!;
    expect(p1.reviews[0].headline).toBe(word.word?.lemma ?? word.prompt);
    expect(p1.nextCursor).toBe(p1.reviews[1].id);

    const p2 = (await call("GET", `/reviews?limit=2&before=${p1.nextCursor}`)).body as ReviewLogPage;
    const p3 = (await call("GET", `/reviews?limit=2&before=${p2.nextCursor}`)).body as ReviewLogPage;
    expect([...p2.reviews, ...p3.reviews].map((r) => r.cardId)).toEqual([qs[2].cardId, qs[1].cardId, qs[0].cardId]);
    expect(p3.nextCursor).toBeNull();
    expect(p2.reviews[1]).toMatchObject({ grade: 1, correct: false });
  });

  it("orders late-synced offline answers by when they were answered", async () => {
    const { call, qs } = await studied([3]);
    const s = (await call("GET", "/study/session?task=new")).body as StudySession;
    const other = s.questions.find((q) => q.cardId !== qs[0].cardId)!;
    const earlier = new Date(Date.now() - 3600_000).toISOString();
    await call("POST", "/reviews/batch", { reviews: [{ cardId: other.cardId, grade: 3, mode: "flashcard", reviewedAt: earlier, clientReviewId: "x1" }] });
    const page = (await call("GET", "/reviews")).body as ReviewLogPage;
    expect(page.reviews.map((r) => r.cardId)).toEqual([qs[0].cardId, other.cardId]);
  });

  it("filters by card and by date", async () => {
    const { call, qs } = await studied([1, 3]);
    await call("POST", "/reviews", { cardId: qs[0].cardId, grade: 3, mode: "meaning" });
    const byCard = (await call("GET", `/reviews?cardId=${qs[0].cardId}`)).body as ReviewLogPage;
    expect(byCard.reviews.map((r) => r.grade)).toEqual([3, 1]);
    const today = byCard.reviews[0].localDate;
    expect(((await call("GET", `/reviews?date=${today}`)).body as ReviewLogPage).reviews).toHaveLength(3);
    expect(((await call("GET", "/reviews?date=2000-01-01")).body as ReviewLogPage).reviews).toHaveLength(0);
    expect((await call("GET", "/reviews?date=yesterday")).status).toBe(400);
  });
});

describe("history", () => {
  it("summarizes each day and fills days without study", async () => {
    const { call, qs } = await studied([3, 1, 4]);
    await call("POST", "/reviews", { cardId: qs[1].cardId, grade: 3, mode: "flashcard", durationMs: 2000 });
    const h = (await call("GET", "/history")).body as HistoryResponse;
    expect(h.days).toHaveLength(30);
    expect(h.days.at(-1)!.date).toBe(h.to);
    expect(h.days.at(-1)).toMatchObject({ reviews: 4, correct: 3, newCards: 3, uniqueCards: 3, studyMs: 2000 });
    expect(h.days.at(-2)).toMatchObject({ reviews: 0, newCards: 0 });
    expect(h.totals).toMatchObject({ reviews: 4, correct: 3, newCards: 3, activeDays: 1 });
  });

  it("accepts a custom range and rejects bad ones", async () => {
    const { call } = await setup();
    const h = (await call("GET", "/history?from=2026-09-28&to=2026-10-04")).body as HistoryResponse;
    expect(h.days.map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect((await call("GET", "/history?from=2026-10-04&to=2026-09-28")).status).toBe(400);
    expect((await call("GET", "/history?from=2024-01-01&to=2026-01-01")).status).toBe(400);
  });
});

describe("schedule", () => {
  it("buckets studied cards by due day, separates overdue and unstarted", async () => {
    const { call, db, qs, session } = await studied([1, 4, 4]);
    // 1 枚を昨日期限切れにする
    db.prepare("UPDATE cards SET due = ? WHERE id = ?").run(new Date(Date.now() - 2 * 86_400_000).toISOString(), qs[2].cardId);

    const s = (await call("GET", "/schedule?days=30")).body as ScheduleResponse;
    expect(s.days).toHaveLength(30);
    expect(s.overdue.count).toBe(1);
    expect(s.overdue.cards[0]).toMatchObject({ cardId: qs[2].cardId, state: "review" });
    // Again は数分後 → 今日
    expect(s.days[0].cards.map((c) => c.cardId)).toContain(qs[0].cardId);
    // Easy は数日後
    const easy = s.days.findIndex((d) => d.cards.some((c) => c.cardId === qs[1].cardId));
    expect(easy).toBeGreaterThan(0);
    expect(s.days[easy].cards.find((c) => c.cardId === qs[1].cardId)!.headline).toBeTruthy();
    expect(s.unstarted).toBe(session.questions.length - 3);
    const scheduled = s.overdue.count + s.days.reduce((a, d) => a + d.count, 0) + s.later;
    expect(scheduled).toBe(3);
  });

  it("validates days", async () => {
    const { call } = await setup();
    expect((await call("GET", "/schedule?days=0")).status).toBe(400);
    expect(((await call("GET", "/schedule")).body as ScheduleResponse).days).toHaveLength(14);
  });
});

describe("card detail", () => {
  it("returns the card with its full answer history and hides other users' cards", async () => {
    const { app, call, qs } = await studied([1]);
    await call("POST", "/reviews", { cardId: qs[0].cardId, grade: 3, mode: "cloze" });
    const d = (await call("GET", `/cards/${qs[0].cardId}`)).body as CardDetail;
    expect(d.card.id).toBe(qs[0].cardId);
    expect(d.card.reps).toBe(2);
    expect(d.reviews.map((r) => [r.grade, r.mode])).toEqual([[3, "cloze"], [1, "flashcard"]]);

    const reg = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: "b@example.com", password: "password123" } });
    const other = await app.inject({ method: "GET", url: `/api/v1/cards/${qs[0].cardId}`, headers: { authorization: `Bearer ${reg.json().token}` } });
    expect(other.statusCode).toBe(404);
    const otherLogs = await app.inject({ method: "GET", url: `/api/v1/reviews?cardId=${qs[0].cardId}`, headers: { authorization: `Bearer ${reg.json().token}` } });
    expect(otherLogs.json().reviews).toHaveLength(0);
  });
});
