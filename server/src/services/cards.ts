import type { Card, CardSource, Grade, ItemType, QuizMode, ReviewResult, User } from "@ivocab/shared";
import { getLevel } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";
import { type CardRow, emptyCardFields, retrievability, review, stateName } from "./srs.ts";
import { localDate } from "./time.ts";

export class NotFoundError extends Error {}

export function getCardRow(db: DB, userId: number, cardId: number): CardRow {
  const row = db.prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId) as CardRow | undefined;
  if (!row) throw new NotFoundError(`card ${cardId} not found`);
  return row;
}

export function headlineFor(db: DB, itemType: ItemType, itemId: number): string {
  if (itemType === "word") {
    return (db.prepare("SELECT lemma FROM words WHERE id = ?").get(itemId) as { lemma: string } | undefined)?.lemma ?? "?";
  }
  return (db.prepare("SELECT intent_ja FROM expression_groups WHERE id = ?").get(itemId) as { intent_ja: string } | undefined)?.intent_ja ?? "?";
}

export function toCardDto(db: DB, row: CardRow, now = new Date(), desiredRetention = 0.9): Card {
  return {
    id: row.id,
    itemType: row.item_type,
    itemId: row.item_id,
    headline: headlineFor(db, row.item_type, row.item_id),
    state: stateName(row.state),
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    lastReview: row.last_review,
    retrievability: retrievability(row, now, desiredRetention),
    source: row.source as CardSource,
  };
}

/** カードがなければ作る。既存カードはそのまま返す */
export function ensureCard(db: DB, userId: number, itemType: ItemType, itemId: number, source: CardSource, now = new Date()): CardRow {
  const f = emptyCardFields(now);
  db.prepare(
    `INSERT OR IGNORE INTO cards (user_id, item_type, item_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, itemType, itemId, f.due, f.stability, f.difficulty, f.elapsed_days, f.scheduled_days, f.learning_steps, f.reps, f.lapses, f.state, f.last_review, source, now.toISOString());
  return db.prepare("SELECT * FROM cards WHERE user_id = ? AND item_type = ? AND item_id = ?").get(userId, itemType, itemId) as unknown as CardRow;
}

/** 今日（ユーザーのタイムゾーン）レベル学習で導入したカード数 */
export function introducedToday(db: DB, user: User, itemType: ItemType, now = new Date()): number {
  const today = localDate(now, user.timezone);
  const rows = db.prepare("SELECT created_at FROM cards WHERE user_id = ? AND item_type = ? AND source = 'level' AND created_at >= ?").all(
    user.id,
    itemType,
    new Date(now.getTime() - 36 * 3600_000).toISOString(),
  ) as { created_at: string }[];
  return rows.filter((r) => localDate(new Date(r.created_at), user.timezone) === today).length;
}

/**
 * レベルに応じて新出カードを導入する。
 * 単語: レベルの CEFR 帯から、低い CEFR → 頻度順 → ID 順で未導入のものを選ぶ。
 */
export function introduceNewCards(db: DB, user: User, itemType: ItemType, count: number, now = new Date()): CardRow[] {
  if (count <= 0) return [];
  const level = getLevel(user.levelId);
  let ids: number[];
  if (itemType === "word") {
    const placeholders = level.vocabBands.map(() => "?").join(",");
    ids = (
      db.prepare(
        `SELECT w.id FROM words w
         WHERE w.cefr IN (${placeholders}) AND (w.created_by IS NULL OR w.created_by = ?) AND w.meaning_ja <> ''
           AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.user_id = ? AND c.item_type = 'word' AND c.item_id = w.id)
         ORDER BY CASE w.cefr WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END,
                  COALESCE(w.frequency_rank, 1000000), w.id
         LIMIT ?`,
      ).all(...level.vocabBands, user.id, user.id, count) as { id: number }[]
    ).map((r) => r.id);
  } else {
    // 表現はレベル以下の CEFR から（会話の基本は全レベル共通で必要なため）
    ids = (
      db.prepare(
        `SELECT g.id FROM expression_groups g
         WHERE CASE g.cefr WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END
               <= CASE ? WHEN 'A1' THEN 2 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END
           AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.user_id = ? AND c.item_type = 'expression' AND c.item_id = g.id)
         ORDER BY g.id LIMIT ?`,
      ).all(level.cefr, user.id, count) as { id: number }[]
    ).map((r) => r.id);
  }
  return tx(db, () => ids.map((id) => ensureCard(db, user.id, itemType, id, "level", now)));
}

export interface RecordReviewInput {
  cardId: number;
  grade: Grade;
  mode: QuizMode | "lesson";
  durationMs?: number;
  reviewedAt?: Date;
  clientReviewId?: string;
}

export function recordReview(db: DB, user: User, input: RecordReviewInput, now = new Date()): ReviewResult {
  if (input.clientReviewId) {
    const dup = db.prepare("SELECT card_id, grade, scheduled_days FROM review_logs WHERE user_id = ? AND client_review_id = ?").get(user.id, input.clientReviewId) as
      | { card_id: number; grade: Grade; scheduled_days: number }
      | undefined;
    if (dup) {
      const row = getCardRow(db, user.id, dup.card_id);
      return { card: toCardDto(db, row, now, user.desiredRetention), grade: dup.grade, intervalDays: dup.scheduled_days, duplicate: true };
    }
  }
  const row = getCardRow(db, user.id, input.cardId);
  // 未来の時刻や前回レビューより前の時刻は信用しない（オフライン同期時の時計ずれ対策）
  let at = input.reviewedAt && input.reviewedAt <= now ? input.reviewedAt : now;
  if (row.last_review && at < new Date(row.last_review)) at = now;
  const { fields } = review(row, input.grade, at, user.desiredRetention);
  const intervalDays = Math.max(0, (new Date(fields.due).getTime() - at.getTime()) / 86_400_000);
  tx(db, () => {
    db.prepare(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?,
         reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
    ).run(fields.due, fields.stability, fields.difficulty, fields.elapsed_days, fields.scheduled_days, fields.learning_steps, fields.reps, fields.lapses, fields.state, fields.last_review, row.id);
    db.prepare(
      `INSERT INTO review_logs (card_id, user_id, grade, mode, state_before, stability_after, scheduled_days, duration_ms, reviewed_at, local_date, client_review_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, user.id, input.grade, input.mode, row.state, fields.stability, Math.round(intervalDays * 100) / 100, input.durationMs ?? null, at.toISOString(), localDate(at, user.timezone), input.clientReviewId ?? null);
  });
  const updated = getCardRow(db, user.id, row.id);
  return { card: toCardDto(db, updated, now, user.desiredRetention), grade: input.grade, intervalDays, duplicate: false };
}

export function listCards(db: DB, user: User, opts: { itemType?: ItemType; limit?: number; offset?: number }, now = new Date()) {
  const where = ["user_id = ?"];
  const params: (string | number)[] = [user.id];
  if (opts.itemType) {
    where.push("item_type = ?");
    params.push(opts.itemType);
  }
  const rows = db.prepare(`SELECT * FROM cards WHERE ${where.join(" AND ")} ORDER BY due LIMIT ? OFFSET ?`).all(...params, opts.limit ?? 100, opts.offset ?? 0) as unknown as CardRow[];
  return rows.map((r) => toCardDto(db, r, now, user.desiredRetention));
}

export function deleteCard(db: DB, userId: number, cardId: number) {
  const r = db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").run(cardId, userId);
  if (r.changes === 0) throw new NotFoundError(`card ${cardId} not found`);
}
