import type { Cefr, CardState, Stats, User } from "@ivocab/shared";
import { CEFR_LEVELS } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { type CardRow, forgettingCurve, retrievability, stateName } from "./srs.ts";
import { addDays, localDate } from "./time.ts";

const MASTERED_STABILITY_DAYS = 21;

export function computeStats(db: DB, user: User, now = new Date()): Stats {
  const cards = db.prepare("SELECT * FROM cards WHERE user_id = ?").all(user.id) as unknown as CardRow[];
  const byState: Record<CardState, number> = { new: 0, learning: 0, review: 0, relearning: 0 };
  const rs: number[] = [];
  const stabilities: number[] = [];
  for (const c of cards) {
    byState[stateName(c.state)]++;
    const r = retrievability(c, now, user.desiredRetention);
    if (r !== null) rs.push(r);
    if (c.state === 2) stabilities.push(c.stability);
  }

  const today = localDate(now, user.timezone);
  const from = addDays(today, -29);
  const logRows = db.prepare(
    "SELECT local_date AS date, COUNT(*) AS count, SUM(CASE WHEN grade > 1 THEN 1 ELSE 0 END) AS correct FROM review_logs WHERE user_id = ? AND local_date >= ? GROUP BY local_date",
  ).all(user.id, from) as { date: string; count: number; correct: number }[];
  const byDate = new Map(logRows.map((r) => [r.date, r]));
  const history = Array.from({ length: 30 }, (_, i) => {
    const d = addDays(from, i);
    const r = byDate.get(d);
    return { date: d, count: r?.count ?? 0, correct: r?.correct ?? 0 };
  });
  const total30 = history.reduce((a, h) => a + h.count, 0);
  const correct30 = history.reduce((a, h) => a + h.correct, 0);

  // 連続学習日数（今日まだなら昨日から数える）
  const allDates = new Set((db.prepare("SELECT DISTINCT local_date AS d FROM review_logs WHERE user_id = ?").all(user.id) as { d: string }[]).map((r) => r.d));
  let streak = 0;
  let cursor = allDates.has(today) ? today : addDays(today, -1);
  while (allDates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const forecast = Array.from({ length: 14 }, (_, i) => ({ date: addDays(today, i), count: 0 }));
  const idx = new Map(forecast.map((f, i) => [f.date, i]));
  for (const c of cards) {
    if (c.state === 0) continue;
    const d = localDate(new Date(c.due), user.timezone);
    const i = d < today ? 0 : idx.get(d);
    if (i !== undefined) forecast[i].count++;
  }

  let forgettingCurveData: Stats["forgettingCurve"] = null;
  if (stabilities.length) {
    const sorted = [...stabilities].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const horizon = Math.max(7, Math.min(90, Math.ceil(median * 3)));
    const points = Array.from({ length: 31 }, (_, i) => {
      const day = (horizon * i) / 30;
      return { day: Math.round(day * 10) / 10, retention: forgettingCurve(median, day) };
    });
    forgettingCurveData = { stabilityDays: Math.round(median * 10) / 10, points };
  }

  const masteredByCefr = Object.fromEntries(CEFR_LEVELS.map((c) => [c, 0])) as Record<Cefr, number>;
  const mastered = db.prepare(
    `SELECT w.cefr, COUNT(*) AS n FROM cards c JOIN words w ON w.id = c.item_id
     WHERE c.user_id = ? AND c.item_type = 'word' AND c.state = 2 AND c.stability >= ? GROUP BY w.cefr`,
  ).all(user.id, MASTERED_STABILITY_DAYS) as { cefr: Cefr; n: number }[];
  for (const m of mastered) masteredByCefr[m.cefr] = m.n;

  return {
    totalCards: cards.length,
    byState,
    reviewsToday: byDate.get(today)?.count ?? 0,
    streakDays: streak,
    recentAccuracy: total30 ? correct30 / total30 : null,
    averageRetrievability: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    forecast,
    history,
    forgettingCurve: forgettingCurveData,
    masteredByCefr,
  };
}
