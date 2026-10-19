/** ユーザーのタイムゾーンでの日付 (YYYY-MM-DD) */
export function localDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * ユーザーのタイムゾーンで「今日の終わり」(= 翌日 0:00) の UTC 時刻。
 * 日付が変わる瞬間を二分探索で求めるので、+5:30 や +5:45 のような分単位のオフセットや DST にも対応する。
 */
export function endOfLocalDay(now: Date, timezone: string): Date {
  const today = localDate(now, timezone);
  let lo = now.getTime(); // まだ今日
  let hi = lo + 26 * 3600_000; // 確実に明日以降
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(new Date(mid), timezone) === today) lo = mid;
    else hi = mid;
  }
  // 境界 b は lo < b <= hi かつ分単位。hi - lo <= 1 分なので、hi を分に切り捨てると b に一致する
  return new Date(Math.floor(hi / 60_000) * 60_000);
}
