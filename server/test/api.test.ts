import { describe, expect, it } from "vitest";
import type { DailyTasks, QuizQuestion, StudySession } from "@ivocab/shared";
import { setup } from "./helpers.ts";

describe("auth", () => {
  it("registers, logs in and rejects bad tokens", async () => {
    const { app, user } = await setup();
    expect(user.levelId).toBe("eiken-2");
    const bad = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: "Bearer nope" } });
    expect(bad.statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "A@example.com", password: "password123" } });
    expect(login.statusCode).toBe(200);
    const wrong = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "a@example.com", password: "wrong-pass" } });
    expect(wrong.statusCode).toBe(401);
    const dup = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: "a@example.com", password: "password123" } });
    expect(dup.statusCode).toBe(401);
  });

  it("updates level and exam together", async () => {
    const { call } = await setup();
    const r = await call("PATCH", "/me", { levelId: "ielts-5.5" });
    expect(r.body.user).toMatchObject({ levelId: "ielts-5.5", exam: "ielts" });
    expect((await call("PATCH", "/me", { levelId: "nope" })).status).toBe(400);
  });
});

describe("study flow", () => {
  it("introduces level-appropriate new words and schedules them with FSRS", async () => {
    const { call } = await setup();
    const tasks = (await call("GET", "/tasks/today")).body as DailyTasks;
    expect(tasks.tasks.map((t) => t.key)).toEqual(["review", "new", "synonym", "antonym", "paraphrase"]);
    expect(tasks.levelLabel).toBe("英検2級");

    const session = (await call("GET", "/study/session?task=new")).body as StudySession;
    // 英検2級: 新出 12 語 + 表現 3 セット
    expect(session.questions).toHaveLength(15);
    const words = session.questions.filter((q) => q.word);
    expect(words.every((q) => ["B1", "B2"].includes(q.word!.cefr))).toBe(true);
    expect(session.questions.every((q) => q.mode === "flashcard")).toBe(true);

    // 2 回目は追加導入されず、未回答のカードが再提示される
    const again = (await call("GET", "/study/session?task=new")).body as StudySession;
    expect(again.questions.map((q) => q.cardId).sort()).toEqual(session.questions.map((q) => q.cardId).sort());

    const r = await call("POST", "/reviews", { cardId: session.questions[0].cardId, grade: 3, mode: "flashcard" });
    expect(r.status).toBe(200);
    expect(r.body.card.state).toBe("learning");
    const easy = await call("POST", "/reviews", { cardId: session.questions[1].cardId, grade: 4, mode: "flashcard" });
    expect(easy.body.card.state).toBe("review");
    expect(easy.body.intervalDays).toBeGreaterThan(1);

    const after = (await call("GET", "/tasks/today")).body as DailyTasks;
    expect(after.tasks.find((t) => t.key === "new")!.done).toBe(15);
  });

  it("builds synonym / antonym drills with a valid answer", async () => {
    const { call } = await setup();
    for (const task of ["synonym", "antonym"] as const) {
      const s = (await call("GET", `/study/session?task=${task}`)).body as StudySession;
      expect(s.questions.length).toBeGreaterThan(0);
      for (const q of s.questions) {
        expect(q.mode).toBe(task);
        expect(q.choices.length).toBeGreaterThanOrEqual(3);
        const answer = q.choices[q.answerIndex].text.toLowerCase();
        const rel = task === "synonym" ? q.word!.synonyms : q.word!.antonyms;
        expect(rel.map((x) => x.lemma.toLowerCase())).toContain(answer);
        // 正解以外の選択肢は正解の関係語ではない
        const others = q.choices.filter((_, i) => i !== q.answerIndex).map((c) => c.text.toLowerCase());
        expect(others.some((o) => rel.map((x) => x.lemma.toLowerCase()).includes(o))).toBe(false);
      }
    }
  });

  it("builds paraphrase drills from expression groups", async () => {
    const { call } = await setup();
    const s = (await call("GET", "/study/session?task=paraphrase")).body as StudySession;
    expect(s.questions.length).toBe(5);
    for (const q of s.questions as QuizQuestion[]) {
      expect(q.group).toBeDefined();
      const groupTexts = q.group!.expressions.map((e) => e.text);
      expect(groupTexts).toContain(q.choices[q.answerIndex].text);
    }
  });

  it("grades quiz answers by correctness and speed, and dedupes client review ids", async () => {
    const { call } = await setup();
    const s = (await call("GET", "/study/session?task=synonym")).body as StudySession;
    const cardId = s.questions[0].cardId;
    const wrong = await call("POST", "/reviews", { cardId, correct: false, mode: "synonym", clientReviewId: "x1" });
    expect(wrong.body.grade).toBe(1);
    const dup = await call("POST", "/reviews", { cardId, correct: true, mode: "synonym", clientReviewId: "x1" });
    expect(dup.body.duplicate).toBe(true);
    expect(dup.body.grade).toBe(1);
    const slow = await call("POST", "/reviews", { cardId, correct: true, durationMs: 20_000, mode: "synonym" });
    expect(slow.body.grade).toBe(2);
    expect((await call("POST", "/reviews", { cardId, mode: "synonym" })).status).toBe(400);
    expect((await call("POST", "/reviews", { cardId: 99999, grade: 3, mode: "flashcard" })).status).toBe(404);
  });

  it("accepts offline review batches", async () => {
    const { call } = await setup();
    const s = (await call("GET", "/study/session?task=new")).body as StudySession;
    const t0 = Date.now() - 60_000;
    const reviews = s.questions.slice(0, 3).map((q, i) => ({
      cardId: q.cardId, grade: 3, mode: "flashcard", reviewedAt: new Date(t0 + i * 1000).toISOString(), clientReviewId: `b${i}`,
    }));
    const r = await call("POST", "/reviews/batch", { reviews: [...reviews, reviews[0]] });
    expect(r.body.results).toHaveLength(4);
    expect(r.body.results.filter((x: { result?: { duplicate: boolean } }) => x.result?.duplicate)).toHaveLength(1);
  });

  it("reports stats with a forgetting curve once cards are in review", async () => {
    const { call } = await setup();
    const s = (await call("GET", "/study/session?task=new")).body as StudySession;
    for (const q of s.questions) await call("POST", "/reviews", { cardId: q.cardId, grade: 4, mode: "flashcard" });
    const stats = (await call("GET", "/stats")).body;
    expect(stats.reviewsToday).toBe(s.questions.length);
    expect(stats.streakDays).toBe(1);
    expect(stats.byState.review).toBe(s.questions.length);
    expect(stats.forgettingCurve.points[0].retention).toBeCloseTo(1);
    const last = stats.forgettingCurve.points.at(-1).retention;
    expect(last).toBeLessThan(0.9);
    expect(stats.history).toHaveLength(30);
    expect(stats.forecast).toHaveLength(14);
  });
});

describe("cambly integration", () => {
  const transcript = `Tutor: So what did you do last weekend?
Me: I bought a new bicycle and I think it was expensive, but I couldn't agree more that it's essential for commuting.
Tutor: Nice! I didn't quite catch that last part.
Me: The commute is quite tedious without it.
I go to there yesterday -> I went there yesterday
Instead of "very delicious", say "absolutely delicious".
Tutor: Your pronunciation is improving remarkably.`;

  it("analyzes a lesson transcript", async () => {
    const { call } = await setup();
    const a = (await call("POST", "/cambly/analyze", { text: transcript })).body;
    const lemmas = a.knownWords.map((w: { lemma: string }) => w.lemma);
    expect(lemmas).toEqual(expect.arrayContaining(["buy", "expensive", "essential", "improve"]));
    expect(a.expressions.map((e: { text: string }) => e.text)).toEqual(expect.arrayContaining(["I couldn't agree more.", "I didn't quite catch that."]));
    expect(a.corrections).toEqual([
      { original: "I go to there yesterday", better: "I went there yesterday" },
      { original: "very delicious", better: "absolutely delicious" },
    ]);
    expect(a.unknownCandidates).toEqual(expect.arrayContaining(["bicycle", "commute", "remarkably"]));
    expect(a.unknownCandidates).not.toContain("expensive");
  });

  it("adds lesson items as cards and runs the prep → used flow", async () => {
    const { call } = await setup();
    const a = (await call("POST", "/cambly/analyze", { text: transcript })).body;
    const added = await call("POST", "/cambly/cards", {
      wordIds: a.knownWords.slice(0, 2).map((w: { wordId: number }) => w.wordId),
      groupIds: [a.expressions[0].groupId],
      customWords: [{ lemma: "commute", meaningJa: "通勤（する）", pos: "verb" }],
      corrections: a.corrections,
    });
    expect(added.body.cards).toHaveLength(6);
    expect(added.body.cards.every((c: { source: string }) => c.source === "cambly")).toBe(true);

    // ユーザー追加語は他ユーザーの検索に出ない
    const words = (await call("GET", "/words?q=commute")).body;
    expect(words.total).toBe(1);

    for (const c of added.body.cards) await call("POST", "/reviews", { cardId: c.id, grade: 3, mode: "flashcard" });
    const sug = (await call("GET", "/cambly/suggestions")).body.targets;
    expect(sug.length).toBeGreaterThan(0);

    const created = await call("POST", "/cambly/lessons", { lessonDate: "2026-10-10", tutor: "Emma", targetCardIds: sug.map((t: { cardId: number }) => t.cardId) });
    expect(created.body.prepSheet).toContain("Today I'd like to practice");
    const firstWord = created.body.lesson.targets.find((t: { itemType: string }) => t.itemType === "word");
    expect(created.body.prepSheet).toContain(`- ${firstWord.headline}`);
    const lesson = created.body.lesson;
    const target = lesson.targets[0];
    const used = await call("PUT", `/cambly/lessons/${lesson.id}/targets/${target.cardId}`, { used: true });
    expect(used.body.lesson.targets.find((t: { cardId: number }) => t.cardId === target.cardId).used).toBe(true);
    // 二重チェックしてもレビューは 1 回だけ
    await call("PUT", `/cambly/lessons/${lesson.id}/targets/${target.cardId}`, { used: false });
    await call("PUT", `/cambly/lessons/${lesson.id}/targets/${target.cardId}`, { used: true });
    const stats = (await call("GET", "/stats")).body;
    expect(stats.reviewsToday).toBe(6 + 1);

    const patched = await call("PATCH", `/cambly/lessons/${lesson.id}`, { notes: "Talked about commuting" });
    expect(patched.body.lesson.notes).toBe("Talked about commuting");
    expect((await call("GET", "/cambly/lessons")).body.lessons).toHaveLength(1);
  });

  it("does not let users touch other users' lessons", async () => {
    const one = await setup();
    const lesson = (await one.call("POST", "/cambly/lessons", { lessonDate: "2026-10-10" })).body.lesson;
    const reg = await one.app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: "b@example.com", password: "password123" } });
    const res = await one.app.inject({ method: "GET", url: `/api/v1/cambly/lessons/${lesson.id}`, headers: { authorization: `Bearer ${reg.json().token}` } });
    expect(res.statusCode).toBe(404);
  });
});
