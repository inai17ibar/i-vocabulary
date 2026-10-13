import type Anthropic from "@anthropic-ai/sdk";
import type { Cefr } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";
import { addExample, addRelation } from "./vocab.ts";

/**
 * Claude で単語の日本語訳・例文・類義語・対義語を一度だけ生成し、ファイル（data/generated/llm-words.jsonl）に記録して DB に反映する。
 * 生成済みの語は再生成しないので、記録したファイルがあれば他の環境は反映（apply）だけで済む。
 */

export const DEFAULT_MODEL = "claude-opus-5-5";
/** 1 リクエストで扱う語数 */
export const WORDS_PER_REQUEST = 20;
/** 生成した例文の出典表示 */
export const LLM_ATTRIBUTION = "AI生成（Claude）";

/** USD / 100 万トークン（入力, 出力）。Batch API はこの半額 */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function costUsd(model: string, usage: { input: number; output: number }, batch: boolean): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return ((usage.input * p[0] + usage.output * p[1]) / 1e6) * (batch ? 0.5 : 1);
}

export interface TargetWord {
  lemma: string;
  pos: string;
  cefr: Cefr;
  tags: string;
  meaningJa: string;
}

export interface GeneratedEntry {
  lemma: string;
  pos: string;
  meaning_ja: string;
  examples: { en: string; ja: string }[];
  synonyms: { lemma: string; note_ja: string }[];
  antonyms: string[];
  model: string;
  generated_at: string;
}

export const keyOf = (w: { lemma: string; pos: string }) => `${w.lemma}|${w.pos}`;

/** 生成対象: 共有語のうち同梱の厳選データ以外で、まだ生成していない語（低い CEFR・高頻度から） */
export function selectTargets(db: DB, done: Set<string>, opts: { limit?: number; cefr?: Cefr[] } = {}): TargetWord[] {
  const where = ["created_by IS NULL", "source <> 'seed'"];
  const params: string[] = [];
  if (opts.cefr?.length) {
    where.push(`cefr IN (${opts.cefr.map(() => "?").join(",")})`);
    params.push(...opts.cefr);
  }
  const rows = db.prepare(
    `SELECT lemma, pos, cefr, tags, meaning_ja AS meaningJa FROM words WHERE ${where.join(" AND ")}
     ORDER BY CASE cefr WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END,
              COALESCE(frequency_rank, 1000000), id`,
  ).all(...params) as unknown as TargetWord[];
  const pending = rows.filter((r) => !done.has(keyOf(r)));
  return opts.limit ? pending.slice(0, opts.limit) : pending;
}

const SYSTEM_PROMPT = `You write entries for an English vocabulary app used by Japanese learners who are preparing for English conversation lessons, the Eiken test and IELTS.

For each word you receive (headword, part of speech, CEFR level), write:
- meaning_ja: the 1-3 most useful Japanese translations for this part of speech, joined with 「、」, in natural modern Japanese, at most 25 characters in total. A machine-picked "current" meaning is given for reference; it is sometimes wrong or old-fashioned, so do not copy it blindly.
- examples: 2 natural example sentences that use the word in this part of speech, 6-14 words each, with a natural Japanese translation. For A1-B2 words use everyday conversation; for C1-C2 or academic words, sentences like those in IELTS reading or writing.
- synonyms: up to 3 words or short phrases with the same part of speech that a learner could use instead, each with a short Japanese note on how it differs (for example 「よりフォーマル」「強い不満を含む」). Use an empty list if there is no good one.
- antonyms: up to 2 single words or short phrases with the opposite meaning. Use an empty list if none exists naturally.

Write every sentence and note yourself. Do not quote dictionaries, textbooks, word books or exam materials.
Return one entry per input word, with "key" copied exactly from the input.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          meaning_ja: { type: "string" },
          examples: {
            type: "array",
            items: {
              type: "object",
              properties: { en: { type: "string" }, ja: { type: "string" } },
              required: ["en", "ja"],
              additionalProperties: false,
            },
          },
          synonyms: {
            type: "array",
            items: {
              type: "object",
              properties: { lemma: { type: "string" }, note_ja: { type: "string" } },
              required: ["lemma", "note_ja"],
              additionalProperties: false,
            },
          },
          antonyms: { type: "array", items: { type: "string" } },
        },
        required: ["key", "meaning_ja", "examples", "synonyms", "antonyms"],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
};

export function buildParams(words: TargetWord[], model: string): Anthropic.MessageCreateParamsNonStreaming {
  const input = words.map((w) => JSON.stringify({ key: keyOf(w), headword: w.lemma, pos: w.pos, cefr: w.cefr, current_meaning: w.meaningJa || null }));
  return {
    model,
    max_tokens: 16000,
    // 辞書的な定型作業なので effort は low（Claude Opus 5.5 は thinking を止められないため effort で量を抑える）
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Words (one JSON object per line):\n${input.join("\n")}` }],
  };
}

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");

/** 応答の JSON を検証して記録用の形にする。入力にない key や中身のない項目は捨てる */
export function parseEntries(message: Anthropic.Message, words: TargetWord[], now = new Date()): GeneratedEntry[] {
  if (message.stop_reason !== "end_turn") return [];
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let data: { entries?: unknown[] };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const byKey = new Map(words.map((w) => [keyOf(w), w]));
  const out: GeneratedEntry[] = [];
  for (const raw of data.entries ?? []) {
    const e = raw as Record<string, unknown>;
    const w = byKey.get(clean(e.key));
    const meaning = clean(e.meaning_ja);
    if (!w || !meaning) continue;
    byKey.delete(keyOf(w));
    out.push({
      lemma: w.lemma,
      pos: w.pos,
      meaning_ja: meaning,
      examples: (Array.isArray(e.examples) ? e.examples : [])
        .map((x) => ({ en: clean((x as Record<string, unknown>).en), ja: clean((x as Record<string, unknown>).ja) }))
        .filter((x) => x.en && x.ja)
        .slice(0, 2),
      synonyms: (Array.isArray(e.synonyms) ? e.synonyms : [])
        .map((x) => ({ lemma: clean((x as Record<string, unknown>).lemma), note_ja: clean((x as Record<string, unknown>).note_ja) }))
        .filter((x) => x.lemma && x.lemma.toLowerCase() !== w.lemma.toLowerCase())
        .slice(0, 3),
      antonyms: (Array.isArray(e.antonyms) ? e.antonyms : []).map(clean).filter(Boolean).slice(0, 2),
      model: message.model,
      generated_at: now.toISOString(),
    });
  }
  return out;
}

export function parseGeneratedFile(text: string): GeneratedEntry[] {
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as GeneratedEntry);
}

/**
 * 記録した生成結果を DB に反映する。同梱の厳選データ・ユーザー追加語は触らない。
 * 訳は置き換え、例文・類義語・対義語は追加する（同じものは重複しない）
 */
export function applyGenerated(db: DB, entries: GeneratedEntry[]): { applied: number; missing: number } {
  const find = db.prepare("SELECT id FROM words WHERE lemma = ? AND pos = ? AND created_by IS NULL AND source <> 'seed'");
  const setMeaning = db.prepare("UPDATE words SET meaning_ja = ? WHERE id = ?");
  let applied = 0;
  let missing = 0;
  tx(db, () => {
    for (const e of entries) {
      const row = find.get(e.lemma, e.pos) as { id: number } | undefined;
      if (!row) {
        missing++;
        continue;
      }
      setMeaning.run(e.meaning_ja, row.id);
      for (const ex of e.examples) addExample(db, row.id, { en: ex.en, ja: ex.ja, attribution: LLM_ATTRIBUTION });
      for (const s of e.synonyms) addRelation(db, row.id, "synonym", s.lemma, s.note_ja || null, "llm");
      for (const a of e.antonyms) addRelation(db, row.id, "antonym", a, null, "llm");
      applied++;
    }
  });
  return { applied, missing };
}
