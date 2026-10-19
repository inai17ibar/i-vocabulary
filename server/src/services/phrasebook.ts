import type { Cefr, PhraseRequest, PhraseSuggestion, SavePhraseRequest, User, Word } from "@ivocab/shared";
import { getLevel } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";
import { ensureCard } from "./cards.ts";
import type { CardRow } from "./srs.ts";
import { localDate } from "./time.ts";
import { getWord, upsertWord } from "./vocab.ts";

/**
 * 「言えなかった」フレーズ帳。言いたかったことを日本語（や途中までの英語）で書くと、AI がレベルに合った自然な言い方を
 * カジュアル〜フォーマルで提案し、選んだものをその人専用のフレーズカードにする。
 * フレーズはユーザー所有の単語（pos = phrase）として保存するので、既存の出題（意味・穴埋め・言い換え）にそのまま乗る。
 */

/** AI の呼び出し口。本番は Claude（llm-phrases.ts）、テストは差し替える */
export interface PhraseSuggester {
  suggest(input: PhraseRequest & { cefr: Cefr }): Promise<Omit<PhraseSuggestion, "keyWords" | "remainingToday"> & { keyWords: { lemma: string; meaningJa: string }[] }>;
}

export class RateLimitError extends Error {}
export class AiUnavailableError extends Error {}

/** 1 人 1 日あたりの AI 利用回数の上限（費用の上限） */
export const DEFAULT_PHRASE_DAILY_LIMIT = 30;

function usedToday(db: DB, user: User, now: Date): number {
  return (db.prepare("SELECT count FROM llm_usage WHERE user_id = ? AND local_date = ?").get(user.id, localDate(now, user.timezone)) as { count: number } | undefined)?.count ?? 0;
}

export async function suggestPhrases(
  db: DB, user: User, ai: PhraseSuggester | undefined, input: PhraseRequest, opts: { dailyLimit?: number; now?: Date } = {},
): Promise<PhraseSuggestion> {
  if (!ai) throw new AiUnavailableError("AI の提案はこのサーバーでは使えません（API キー未設定）");
  const now = opts.now ?? new Date();
  const limit = opts.dailyLimit ?? DEFAULT_PHRASE_DAILY_LIMIT;
  const used = usedToday(db, user, now);
  if (used >= limit) throw new RateLimitError(`今日の AI 提案は上限（${limit} 回）に達しました。明日また使えます`);

  const result = await ai.suggest({ ...input, cefr: getLevel(user.levelId).cefr });
  db.prepare(
    `INSERT INTO llm_usage (user_id, local_date, count) VALUES (?, ?, 1)
     ON CONFLICT (user_id, local_date) DO UPDATE SET count = count + 1`,
  ).run(user.id, localDate(now, user.timezone));

  // 提案に出てきた語が辞書にあれば、そのまま単語カードに追加できるよう ID を付ける
  const findWord = db.prepare("SELECT id FROM words WHERE lower(lemma) = lower(?) AND (created_by IS NULL OR created_by = ?) ORDER BY created_by IS NULL DESC, id LIMIT 1");
  return {
    ...result,
    keyWords: result.keyWords.map((k) => ({ ...k, wordId: (findWord.get(k.lemma, user.id) as { id: number } | undefined)?.id ?? null })),
    remainingToday: Math.max(0, limit - used - 1),
  };
}

const REGISTER_JA = { casual: "カジュアル", neutral: "標準", formal: "フォーマル" } as const;

/** 選んだ言い方をフレーズカードにする。ほかの言い方はニュアンス注記つきの類義表現として残す */
export function savePhrase(db: DB, user: User, input: SavePhraseRequest): { word: Word; card: CardRow } {
  return tx(db, () => {
    const id = upsertWord(db, {
      lemma: input.chosen.text,
      pos: "phrase",
      cefr: getLevel(user.levelId).cefr,
      meaningJa: input.intentJa,
      definitionEn: `${REGISTER_JA[input.chosen.register]}: ${input.chosen.noteJa}`,
      examples: input.chosen.example ? [{ ...input.chosen.example, attribution: "AI生成（Claude）" }] : [],
      synonyms: input.alternatives.map((a) => ({ lemma: a.text, note: `${REGISTER_JA[a.register]}。${a.noteJa}` })),
      source: "phrase",
      createdBy: user.id,
    });
    return { word: getWord(db, id)!, card: ensureCard(db, user.id, "word", id, "phrase") };
  });
}

/** 保存したフレーズ（新しい順） */
export function listPhrases(db: DB, user: User): Word[] {
  const ids = db.prepare("SELECT id FROM words WHERE created_by = ? AND source = 'phrase' ORDER BY id DESC LIMIT 200").all(user.id) as { id: number }[];
  return ids.map((r) => getWord(db, r.id)!).filter(Boolean);
}
