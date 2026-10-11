import type {
  CardDetail, Grade, HistoryDay, HistoryResponse, ItemType, QuizMode, ReviewLogEntry, ReviewLogPage, ScheduleDay, ScheduledCard, ScheduleResponse, User,
} from "@ivocab/shared";
import type { DB } from "../db.ts";
import { getCardRow, toCardDto } from "./cards.ts";
import { type CardRow, retrievability, stateName } from "./srs.ts";
import { addDays, localDate } from "./time.ts";

/**
 * 学習記録（いつ・何を・どう答えたか）と復習予定（何がいつ出るか）。
 * /stats は集計値だけを返すので、個々のカード・回答を見たい画面や iOS 版はこちらを使う。
 */

/** カードの見出し（単語なら lemma、表現なら意図）を JOIN で引く */
const HEADLINE_JOIN = `
  LEFT JOIN words w ON c.item_type = 'word' AND w.id = c.item_id
  LEFT JOIN expression_groups g ON c.item_type = 'expression' AND g.id = c.item_id`;
const HEADLINE = "COALESCE(w.lemma, g.intent_ja, '?')";

interface LogRow {
  id: number;
  card_id: number;
  item_type: ItemType;
  item_id: number;
  headline: string;
  grade: Grade;
  mode: QuizMode | "lesson";
  state_before: number;
  scheduled_days: number;
  duration_ms: number | null;
  reviewed_at: string;
  local_date: string;
}

const LOG_SELECT = `
  SELECT l.id, l.card_id, c.item_type, c.item_id, ${HEADLINE} AS headline, l.grade, l.mode, l.state_before,
         l.scheduled_days, l.duration_ms, l.reviewed_at, l.local_date
  FROM review_logs l JOIN cards c ON c.id = l.card_id ${HEADLINE_JOIN}`;

function toLogEntry(r: LogRow): ReviewLogEntry {
  return {
    id: r.id,
    cardId: r.card_id,
    itemType: r.item_type,
    itemId: r.item_id,
    headline: r.headline,
    grade: r.grade,
    correct: r.grade > 1,
    mode: r.mode,
    stateBefore: stateName(r.state_before),
    intervalDays: r.scheduled_days,
    durationMs: r.duration_ms,
    reviewedAt: r.reviewed_at,
    localDate: r.local_date,
  };
}

export interface ReviewLogQuery {
  /** この日（ユーザーのタイムゾーン）の回答だけ */
  date?: string;
  from?: string;
  to?: string;
  cardId?: number;
  limit?: number;
  /** 前ページの nextCursor */
  before?: number;
}

/** 回答記録を新しい順に返す。オフライン回答は後から届くので ID ではなく回答時刻で並べる */
export function listReviewLogs(db: DB, user: User, q: ReviewLogQuery): ReviewLogPage {
  const where = ["l.user_id = ?"];
  const params: (string | number)[] = [user.id];
  if (q.date) { where.push("l.local_date = ?"); params.push(q.date); }
  if (q.from) { where.push("l.local_date >= ?"); params.push(q.from); }
  if (q.to) { where.push("l.local_date <= ?"); params.push(q.to); }
  if (q.cardId) { where.push("l.card_id = ?"); params.push(q.cardId); }
  if (q.before) {
    const cursor = db.prepare("SELECT reviewed_at FROM review_logs WHERE id = ? AND user_id = ?").get(q.before, user.id) as { reviewed_at: string } | undefined;
    if (cursor) {
      where.push("(l.reviewed_at < ? OR (l.reviewed_at = ? AND l.id < ?))");
      params.push(cursor.reviewed_at, cursor.reviewed_at, q.before);
    }
  }
  const limit = q.limit ?? 50;
  const rows = db.prepare(`${LOG_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.reviewed_at DESC, l.id DESC LIMIT ?`)
    .all(...params, limit + 1) as unknown as LogRow[];
  const page = rows.slice(0, limit);
  return { reviews: page.map(toLogEntry), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

/** 日別の学習サマリー。学習しなかった日も 0 で埋めて返す（グラフ・カレンダー用） */
export function history(db: DB, user: User, range: { from?: string; to?: string }, now = new Date()): HistoryResponse {
  const to = range.to ?? localDate(now, user.timezone);
  const from = range.from ?? addDays(to, -29);
  const rows = db.prepare(
    `SELECT local_date AS date, COUNT(*) AS reviews,
            SUM(CASE WHEN grade > 1 THEN 1 ELSE 0 END) AS correct,
            COUNT(DISTINCT CASE WHEN state_before = 0 THEN card_id END) AS newCards,
            COUNT(DISTINCT card_id) AS uniqueCards,
            COALESCE(SUM(duration_ms), 0) AS studyMs
     FROM review_logs WHERE user_id = ? AND local_date BETWEEN ? AND ? GROUP BY local_date`,
  ).all(user.id, from, to) as unknown as HistoryDay[];
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const days: HistoryDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(byDate.get(d) ?? { date: d, reviews: 0, correct: 0, newCards: 0, uniqueCards: 0, studyMs: 0 });
  }
  const totals = { reviews: 0, correct: 0, newCards: 0, studyMs: 0, activeDays: 0 };
  for (const d of days) {
    totals.reviews += d.reviews;
    totals.correct += d.correct;
    totals.newCards += d.newCards;
    totals.studyMs += d.studyMs;
    if (d.reviews > 0) totals.activeDays++;
  }
  return { from, to, days, totals };
}

/** 1 日に返すカードの上限（count は全件数） */
const SCHEDULE_CARDS_PER_DAY = 200;

/** 復習予定。期限切れ・今日から days 日分を日別に、期限の早い順で返す */
export function schedule(db: DB, user: User, opts: { days?: number } = {}, now = new Date()): ScheduleResponse {
  const days = opts.days ?? 14;
  const today = localDate(now, user.timezone);
  const last = addDays(today, days - 1);
  const rows = db.prepare(
    `SELECT c.*, ${HEADLINE} AS headline FROM cards c ${HEADLINE_JOIN}
     WHERE c.user_id = ? AND c.state <> 0 ORDER BY c.due, c.id`,
  ).all(user.id) as unknown as (CardRow & { headline: string })[];

  const empty = (date: string): ScheduleDay => ({ date, count: 0, cards: [] });
  const overdue = empty(addDays(today, -1));
  const buckets = new Map<string, ScheduleDay>();
  for (let i = 0; i < days; i++) buckets.set(addDays(today, i), empty(addDays(today, i)));
  let later = 0;
  for (const r of rows) {
    const d = localDate(new Date(r.due), user.timezone);
    const bucket = d < today ? overdue : buckets.get(d);
    if (!bucket) {
      if (d > last) later++;
      continue;
    }
    bucket.count++;
    if (bucket.cards.length < SCHEDULE_CARDS_PER_DAY) bucket.cards.push(toScheduled(r, now, user.desiredRetention));
  }
  const unstarted = (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND state = 0").get(user.id) as { n: number }).n;
  return { overdue, days: [...buckets.values()], later, unstarted };
}

function toScheduled(r: CardRow & { headline: string }, now: Date, desiredRetention: number): ScheduledCard {
  return {
    cardId: r.id,
    itemType: r.item_type,
    itemId: r.item_id,
    headline: r.headline,
    state: stateName(r.state),
    due: r.due,
    retrievability: retrievability(r, now, desiredRetention),
    stability: r.stability,
  };
}

/** カード 1 枚の現在の状態と、全回答履歴（新しい順） */
export function cardDetail(db: DB, user: User, cardId: number, now = new Date()): CardDetail {
  const row = getCardRow(db, user.id, cardId);
  const reviews = db.prepare(`${LOG_SELECT} WHERE l.user_id = ? AND l.card_id = ? ORDER BY l.reviewed_at DESC, l.id DESC`)
    .all(user.id, cardId) as unknown as LogRow[];
  return { card: toCardDto(db, row, now, user.desiredRetention), reviews: reviews.map(toLogEntry) };
}
