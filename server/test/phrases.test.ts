import { describe, expect, it } from "vitest";
import type { PhraseSuggestion, StudySession, Word } from "@ivocab/shared";
import type { PhraseSuggester } from "../src/services/phrasebook.ts";
import { setup } from "./helpers.ts";

const fake = (): PhraseSuggester & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    async suggest(input) {
      calls.push(input);
      return {
        intentJa: "週末はのんびりしていた",
        suggestions: [
          { text: "I just took it easy.", register: "casual", noteJa: "会話でよく使う", example: { en: "How was your weekend? — I just took it easy.", ja: "週末どうだった？ — のんびりしてたよ。" } },
          { text: "I spent a quiet weekend at home.", register: "neutral", noteJa: "そのまま説明する言い方", example: null },
          { text: "I took the weekend to rest.", register: "formal", noteJa: "少しかしこまった言い方", example: null },
        ],
        feedbackJa: "relax は動詞なので I was relaxed / I relaxed にします",
        keyWords: [{ lemma: "happy", meaningJa: "幸せな" }, { lemma: "take it easy", meaningJa: "のんびりする" }],
      };
    },
  };
};

describe("phrasebook", () => {
  it("returns 503 when no AI is configured", async () => {
    const { call } = await setup();
    const r = await call("POST", "/phrases/suggest", { text: "週末はのんびりした" });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("ai_unavailable");
  });

  it("suggests phrases at the learner's level, links known key words and counts usage", async () => {
    const ai = fake();
    const { call } = await setup({ phrases: ai, phraseDailyLimit: 2 });
    const r = await call("POST", "/phrases/suggest", { text: "It was relax. 週末はのんびりした", context: "オンライン英会話" });
    expect(r.status).toBe(200);
    const s = r.body as PhraseSuggestion;
    expect(ai.calls[0]).toMatchObject({ text: "It was relax. 週末はのんびりした", context: "オンライン英会話", cefr: "B1" });
    expect(s.suggestions.map((x) => x.register)).toEqual(["casual", "neutral", "formal"]);
    expect(s.keyWords[0]).toMatchObject({ lemma: "happy", wordId: expect.any(Number) });
    expect(s.keyWords[1].wordId).toBeNull();
    expect(s.remainingToday).toBe(1);

    expect((await call("POST", "/phrases/suggest", { text: "もう一回" })).body.remainingToday).toBe(0);
    const limited = await call("POST", "/phrases/suggest", { text: "三回目" });
    expect(limited.status).toBe(429);
    expect(ai.calls).toHaveLength(2);
    expect((await call("POST", "/phrases/suggest", { text: " " })).status).toBe(400);
  });

  it("saves the chosen phrase as the learner's own card with the other registers as alternatives", async () => {
    const ai = fake();
    const { app, call } = await setup({ phrases: ai });
    const s = (await call("POST", "/phrases/suggest", { text: "週末はのんびりした" })).body as PhraseSuggestion;
    const [chosen, ...rest] = s.suggestions;
    const saved = await call("POST", "/phrases", { intentJa: s.intentJa, chosen, alternatives: rest });
    expect(saved.status).toBe(200);
    const word = saved.body.word as Word;
    expect(word).toMatchObject({ lemma: "I just took it easy.", pos: "phrase", meaningJa: "週末はのんびりしていた", source: "phrase" });
    expect(word.examples[0]).toMatchObject({ en: "How was your weekend? — I just took it easy.", attribution: "AI生成（Claude）" });
    expect(word.synonyms.map((x) => x.note)).toEqual(["標準。そのまま説明する言い方", "フォーマル。少しかしこまった言い方"]);
    expect(saved.body.card).toMatchObject({ source: "phrase", state: "new", headline: "I just took it easy." });

    const list = (await call("GET", "/phrases")).body.phrases as Word[];
    expect(list.map((w) => w.lemma)).toEqual(["I just took it easy."]);

    // 「新しい単語・表現」の最初に出てくる
    const fresh = (await call("GET", "/study/session?task=new")).body as StudySession;
    expect(fresh.questions[0]).toMatchObject({ cardId: saved.body.card.id, prompt: "I just took it easy." });

    // 他のユーザーには見えない
    const reg = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: "b@example.com", password: "password123" } });
    const other = await app.inject({ method: "GET", url: `/api/v1/words/${word.id}`, headers: { authorization: `Bearer ${reg.json().token}` } });
    expect(other.statusCode).toBe(404);
    const otherList = await app.inject({ method: "GET", url: "/api/v1/phrases", headers: { authorization: `Bearer ${reg.json().token}` } });
    expect(otherList.json().phrases).toEqual([]);
  });
});
