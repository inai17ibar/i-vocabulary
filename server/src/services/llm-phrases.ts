import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AiUnavailableError, type PhraseSuggester } from "./phrasebook.ts";

/**
 * 「言えなかった」フレーズ帳の提案を Claude で作る。Node（main.ts）と Workers（worker.ts）の両方から使う。
 * 構造化出力（JSON Schema）で受け取り、念のため zod でも検証する。
 */
export const DEFAULT_PHRASE_MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `You help Japanese learners of English say what they could not say in a conversation.

The learner writes what they wanted to say, in Japanese or in unfinished English, sometimes with the situation. Their level is given as a CEFR level.

Return:
- intent_ja: what they wanted to say, restated briefly and clearly in Japanese (at most 40 characters). This becomes the meaning on their flashcard.
- suggestions: 2 to 4 natural ways to say it in spoken English, ordered from casual to formal. Keep each to one sentence and within the learner's level or one step above. For each give the register (casual, neutral or formal), a short Japanese note on when or why to use it (at most 40 characters), and one short example exchange line in English with a Japanese translation, or null if the phrase itself is already a full sentence.
- feedback_ja: if the input contains the learner's own English attempt, one or two short Japanese sentences on what to fix; otherwise null.
- key_words: up to 3 useful single words or short collocations from your suggestions that are worth learning, each with a short Japanese meaning. Skip very basic words.

Write everything yourself in natural, current English and Japanese.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    intent_ja: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          register: { type: "string", enum: ["casual", "neutral", "formal"] },
          note_ja: { type: "string" },
          example: {
            anyOf: [
              { type: "object", properties: { en: { type: "string" }, ja: { type: "string" } }, required: ["en", "ja"], additionalProperties: false },
              { type: "null" },
            ],
          },
        },
        required: ["text", "register", "note_ja", "example"],
        additionalProperties: false,
      },
    },
    feedback_ja: { anyOf: [{ type: "string" }, { type: "null" }] },
    key_words: {
      type: "array",
      items: {
        type: "object",
        properties: { lemma: { type: "string" }, meaning_ja: { type: "string" } },
        required: ["lemma", "meaning_ja"],
        additionalProperties: false,
      },
    },
  },
  required: ["intent_ja", "suggestions", "feedback_ja", "key_words"],
  additionalProperties: false,
};

const outputSchema = z.object({
  intent_ja: z.string().min(1),
  suggestions: z.array(z.object({
    text: z.string().min(1),
    register: z.enum(["casual", "neutral", "formal"]),
    note_ja: z.string(),
    example: z.object({ en: z.string(), ja: z.string() }).nullable(),
  })).min(1),
  feedback_ja: z.string().nullable(),
  key_words: z.array(z.object({ lemma: z.string().min(1), meaning_ja: z.string() })),
});

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function createClaudePhraseSuggester(opts: { apiKey: string; model?: string }): PhraseSuggester {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_PHRASE_MODEL;
  return {
    async suggest(input) {
      const user = [`Level: ${input.cefr}`, input.context ? `Situation: ${input.context}` : null, `What I wanted to say: ${input.text}`].filter(Boolean).join("\n");
      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await client.beta.messages.create({
          model,
          max_tokens: 4000,
          // 安全判定で断られた場合はサーバー側で別モデルに切り替える
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: user }],
        });
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) throw new AiUnavailableError("AI が混み合っています。少し待ってからもう一度試してください");
        if (e instanceof Anthropic.APIError) throw new AiUnavailableError(`AI の呼び出しに失敗しました（${e.status ?? "network"}）`);
        throw e;
      }
      if (msg.stop_reason === "refusal") throw new AiUnavailableError("この内容には提案できませんでした。言い方を変えて試してください");
      if (msg.stop_reason !== "end_turn") throw new AiUnavailableError("AI の応答が途中で終わりました。もう一度試してください");
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let parsed: z.infer<typeof outputSchema>;
      try {
        parsed = outputSchema.parse(JSON.parse(text));
      } catch {
        throw new AiUnavailableError("AI の応答を読み取れませんでした。もう一度試してください");
      }
      return {
        intentJa: clip(parsed.intent_ja.trim(), 80),
        suggestions: parsed.suggestions.slice(0, 4).map((s) => ({
          text: clip(s.text.trim(), 200),
          register: s.register,
          noteJa: clip(s.note_ja.trim(), 100),
          example: s.example && s.example.en.trim() ? { en: clip(s.example.en.trim(), 300), ja: clip(s.example.ja.trim(), 300) } : null,
        })),
        feedbackJa: parsed.feedback_ja?.trim() ? clip(parsed.feedback_ja.trim(), 300) : null,
        keyWords: parsed.key_words.slice(0, 3).map((k) => ({ lemma: clip(k.lemma.trim(), 60), meaningJa: clip(k.meaning_ja.trim(), 60) })),
      };
    },
  };
}
