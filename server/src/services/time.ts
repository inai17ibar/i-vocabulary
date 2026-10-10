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

/** ユーザーのタイムゾーンで「今日の終わり」(= 明日 0:00) の UTC 時刻 */
export function endOfLocalDay(now: Date, timezone: string): Date {
  // 1時間刻みで日付が変わる時刻を探す（DST にも対応できる簡易実装）
  const today = localDate(now, timezone);
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 26; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    if (localDate(t, timezone) !== today) return t;
  }
  return t;
}
