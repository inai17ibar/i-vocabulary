import { useEffect, useState } from "react";
import type { CardDetail, CardState, Grade, HistoryDay, HistoryResponse, ReviewLogEntry, ScheduleDay, ScheduledCard, ScheduleResponse, Stats } from "@ivocab/shared";
import { CEFR_LEVELS } from "@ivocab/shared";
import { api } from "../api.ts";
import { BarChart, CurveChart } from "../components/Charts.tsx";
import { IconClose } from "../components/Icons.tsx";
import { SpeakButtons } from "../components/Pronounce.tsx";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

const VIEWS = [
  { id: "overview", label: "概要" },
  { id: "history", label: "履歴" },
  { id: "schedule", label: "予定" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const MODE_JA: Record<ReviewLogEntry["mode"], string> = {
  flashcard: "単語カード", meaning: "意味", synonym: "類義語", antonym: "対義語", cloze: "穴埋め",
  listening: "リスニング", paraphrase: "言い換え", lesson: "Cambly",
};
const GRADE_JA: Record<Grade, string> = { 1: "もう一度", 2: "難しい", 3: "正解", 4: "簡単" };
const STATE_JA: Record<CardState, string> = { new: "未学習", learning: "学習中", review: "定着", relearning: "覚え直し中" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-10-14" → 今日 / 昨日 / 明日 / 10/14(水) */
function dayLabel(date: string, today: string): string {
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (diff === 0) return "今日";
  if (diff === -1) return "昨日";
  if (diff === 1) return "明日";
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
const dateTimeOf = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))}分後`;
  if (days < 1) return `${Math.round(days * 24)}時間後`;
  if (days < 30) return `${Math.round(days)}日後`;
  return `${Math.round(days / 30)}か月後`;
}
function formatMinutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`;
}

export function StatsPage({ view, onView, onStudy }: { view?: string; onView: (v: View) => void; onStudy: () => void }) {
  const current: View = VIEWS.some((v) => v.id === view) ? (view as View) : "overview";
  const [openCard, setOpenCard] = useState<number | null>(null);
  return (
    <div>
      <div className="seg" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={current === v.id} className={current === v.id ? "on" : ""} onClick={() => onView(v.id)}>{v.label}</button>
        ))}
      </div>
      {current === "overview" && <Overview />}
      {current === "history" && <HistoryView onOpenCard={setOpenCard} />}
      {current === "schedule" && <ScheduleView onOpenCard={setOpenCard} onStudy={onStudy} />}
      {openCard !== null && <CardSheet cardId={openCard} onClose={() => setOpenCard(null)} />}
    </div>
  );
}

// ---- 概要 -------------------------------------------------------------

function Overview() {
  const [s, setS] = useState<Stats | null>(null);
  const [target, setTarget] = useState(0.9);
  useEffect(() => {
    api.stats().then(setS);
    api.me().then((r) => setTarget(r.user.desiredRetention));
  }, []);
  if (!s) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <div className="stat-tiles" style={{ marginTop: 12 }}>
        <div className="tile"><div className="v">{s.streakDays}<small style={{ fontSize: 14 }}> 日</small></div><div className="k">連続学習</div></div>
        <div className="tile"><div className="v">{s.reviewsToday}</div><div className="k">今日の回答数</div></div>
        <div className="tile"><div className="v">{pct(s.averageRetrievability)}</div><div className="k">現在の平均記憶率</div></div>
        <div className="tile"><div className="v">{pct(s.recentAccuracy)}</div><div className="k">30日の正答率</div></div>
        <div className="tile"><div className="v">{s.totalCards}</div><div className="k">学習カード（定着 {s.byState.review} / 学習中 {s.byState.learning + s.byState.relearning}）</div></div>
      </div>

      <div className="card">
        <h2>あなたの忘却曲線</h2>
        {s.forgettingCurve ? (
          <>
            <p className="muted">
              定着カードの記憶の安定度（中央値）は <strong>{s.forgettingCurve.stabilityDays} 日</strong>。
              曲線が目標ラインまで下がった時点で復習が出題され、復習のたびに曲線はゆるやかになります。
            </p>
            <CurveChart points={s.forgettingCurve.points} target={target} label="経過日数ごとの想起確率" />
          </>
        ) : <p className="sub">復習を重ねて「定着」したカードができると表示されます。</p>}
      </div>

      <div className="card">
        <h2>今後14日の復習予定</h2>
        <BarChart data={s.forecast.map((f) => ({ x: f.date.slice(5), y: f.count }))} label="日別の復習予定数" valueLabel="枚" />
      </div>

      <div className="card">
        <h2>CEFR 別の定着語数</h2>
        <p className="muted">安定度 21 日以上（3週間後も 90% 覚えている）の単語</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {CEFR_LEVELS.map((c) => (
              <tr key={c}><td style={{ padding: "4px 0", width: 60 }}>{c}</td><td><strong>{s.masteredByCefr[c]}</strong> 語</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- 履歴 -------------------------------------------------------------

function HistoryView({ onOpenCard }: { onOpenCard: (id: number) => void }) {
  const [h, setH] = useState<HistoryResponse | null>(null);
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.history().then((r) => {
      setH(r);
      setDays(r.days);
      // 今日学習していればその日を開いておく
      const last = r.days.at(-1);
      if (last && last.reviews > 0) setOpen(last.date);
    }).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!h) return <p className="muted">読み込み中…</p>;

  const loadEarlier = async () => {
    setLoadingMore(true);
    const to = new Date(Date.parse(days[0].date) - 86_400_000).toISOString().slice(0, 10);
    const from = new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
    try {
      const r = await api.history({ from, to });
      setDays((d) => [...r.days, ...d]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const recent = h.days;
  const active = [...days].reverse().filter((d) => d.reviews > 0);
  const t = h.totals;

  return (
    <div>
      <div className="stat-tiles" style={{ marginTop: 12 }}>
        <div className="tile"><div className="v">{t.activeDays}<small style={{ fontSize: 14 }}> 日</small></div><div className="k">30日のうち学習した日</div></div>
        <div className="tile"><div className="v">{t.reviews}</div><div className="k">回答数（正答 {t.reviews ? Math.round((t.correct / t.reviews) * 100) : 0}%）</div></div>
        <div className="tile"><div className="v">{t.newCards}</div><div className="k">新しく学んだ単語・表現</div></div>
        <div className="tile"><div className="v">{formatMinutes(t.studyMs)}</div><div className="k">学習時間</div></div>
      </div>

      <div className="card">
        <h2>過去30日の学習量</h2>
        <p className="muted">棒をタップするとその日の記録を開きます</p>
        <BarChart
          data={recent.map((d) => ({ x: d.date.slice(5), y: d.reviews, sub: d.reviews ? `正答 ${Math.round((d.correct / d.reviews) * 100)}%` : undefined }))}
          label="日別の回答数" valueLabel="問"
          onSelect={(i) => {
            const d = recent[i];
            if (!d.reviews) return;
            setOpen(d.date);
            document.getElementById(`day-${d.date}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      </div>

      {active.length === 0 && <p className="sub">まだ学習の記録がありません。今日のタスクから始めましょう。</p>}
      {active.map((d) => (
        <div className="card day-card" key={d.date} id={`day-${d.date}`}>
          <button className="day-head" aria-expanded={open === d.date} onClick={() => setOpen(open === d.date ? null : d.date)}>
            <span className="day-title">{dayLabel(d.date, h.to)}<span className="muted"> {d.date.slice(5).replace("-", "/")}</span></span>
            <span className="day-meta">
              {d.reviews}問 · 正答 {Math.round((d.correct / d.reviews) * 100)}%{d.newCards > 0 && ` · 新規 ${d.newCards}`}{d.studyMs > 0 && ` · ${formatMinutes(d.studyMs)}`}
            </span>
            <span className="chev" aria-hidden="true">{open === d.date ? "▾" : "▸"}</span>
          </button>
          {open === d.date && <DayLog date={d.date} onOpenCard={onOpenCard} />}
        </div>
      ))}
      <button className="ghost" style={{ width: "100%", marginTop: 4 }} onClick={loadEarlier} disabled={loadingMore}>
        {loadingMore ? "読み込み中…" : "さらに前の30日を表示"}
      </button>
    </div>
  );
}

function DayLog({ date, onOpenCard }: { date: string; onOpenCard: (id: number) => void }) {
  const [logs, setLogs] = useState<ReviewLogEntry[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => {
    api.reviewLogs({ date, limit: 100 }).then((r) => { setLogs(r.reviews); setCursor(r.nextCursor); });
  }, [date]);
  if (!logs) return <p className="muted">読み込み中…</p>;
  const more = async () => {
    const r = await api.reviewLogs({ date, limit: 100, before: cursor! });
    setLogs((l) => [...(l ?? []), ...r.reviews]);
    setCursor(r.nextCursor);
  };
  return (
    <div className="log-list">
      {logs.map((l) => <LogRow key={l.id} l={l} onClick={() => onOpenCard(l.cardId)} />)}
      {cursor && <button className="ghost" style={{ width: "100%", marginTop: 8 }} onClick={more}>もっと見る</button>}
    </div>
  );
}

function LogRow({ l, onClick, showDate = false }: { l: ReviewLogEntry; onClick?: () => void; showDate?: boolean }) {
  const body = (
    <>
      <span className="log-time">{showDate ? dateTimeOf(l.reviewedAt) : timeOf(l.reviewedAt)}</span>
      <span className="log-main">
        <span className="log-headline">{l.headline}{l.stateBefore === "new" && <span className="tag new-tag">初学習</span>}</span>
        <span className="muted">{MODE_JA[l.mode]} → 次は{formatInterval(l.intervalDays)}</span>
      </span>
      <span className={`grade-badge g${l.grade}`}>{GRADE_JA[l.grade]}</span>
    </>
  );
  return onClick ? <button className="log-row" onClick={onClick}>{body}</button> : <div className="log-row">{body}</div>;
}

// ---- 予定 -------------------------------------------------------------

function ScheduleView({ onOpenCard, onStudy }: { onOpenCard: (id: number) => void; onStudy: () => void }) {
  const [s, setS] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.schedule(14).then(setS).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">読み込み中…</p>;

  const today = s.days[0].date;
  const now = Date.now();
  const dueNow = s.overdue.count + s.days[0].cards.filter((c) => Date.parse(c.due) <= now).length;
  const upcoming = s.days.filter((d) => d.count > 0);
  const total = s.overdue.count + s.days.reduce((a, d) => a + d.count, 0);

  return (
    <div>
      <div className="card schedule-hero">
        {dueNow > 0 ? (
          <>
            <div><strong style={{ fontSize: 20 }}>いま復習できるカード {dueNow} 枚</strong></div>
            <p className="muted" style={{ margin: "4px 0 10px" }}>想起確率が目標まで下がったカードです。今やると最も効率よく記憶に残ります。</p>
            <button className="btn block" onClick={onStudy}>復習を始める</button>
          </>
        ) : (
          <>
            <div><strong style={{ fontSize: 18 }}>いま復習が必要なカードはありません</strong></div>
            <p className="muted" style={{ margin: "4px 0 0" }}>忘れかけたタイミングで自動的に出題されます。下の予定で次がいつか確認できます。</p>
          </>
        )}
      </div>

      {total === 0 && <p className="sub">学習を始めると、ここに単語ごとの復習予定が表示されます。</p>}
      {s.overdue.count > 0 && <ScheduleSection title="期限切れ" note="前日までに復習するはずだったカード" day={s.overdue} onOpenCard={onOpenCard} overdue />}
      {upcoming.map((d) => (
        <ScheduleSection key={d.date} title={dayLabel(d.date, today)} note={d.date === today ? undefined : d.date.slice(5).replace("-", "/")} day={d} onOpenCard={onOpenCard} showTime={d.date === today} />
      ))}
      {(s.later > 0 || s.unstarted > 0) && (
        <p className="muted" style={{ textAlign: "center" }}>
          {s.later > 0 && `15日以降に予定: ${s.later} 枚`}{s.later > 0 && s.unstarted > 0 && " · "}{s.unstarted > 0 && `まだ学習していないカード: ${s.unstarted} 枚`}
        </p>
      )}
    </div>
  );
}

function ScheduleSection({ title, note, day, onOpenCard, overdue = false, showTime = false }: {
  title: string; note?: string; day: ScheduleDay; onOpenCard: (id: number) => void; overdue?: boolean; showTime?: boolean;
}) {
  return (
    <div className={`card day-card ${overdue ? "overdue" : ""}`}>
      <div className="day-head static">
        <span className="day-title">{title}{note && <span className="muted"> {note}</span>}</span>
        <span className="day-meta">{day.count} 枚</span>
      </div>
      <div className="log-list">
        {day.cards.map((c) => <ScheduledRow key={c.cardId} c={c} showTime={showTime} onClick={() => onOpenCard(c.cardId)} />)}
        {day.count > day.cards.length && <p className="muted">ほか {day.count - day.cards.length} 枚</p>}
      </div>
    </div>
  );
}

function ScheduledRow({ c, showTime, onClick }: { c: ScheduledCard; showTime: boolean; onClick: () => void }) {
  const r = c.retrievability;
  return (
    <button className="log-row" onClick={onClick}>
      <span className="log-time">{showTime ? timeOf(c.due) : ""}</span>
      <span className="log-main">
        <span className="log-headline">{c.headline}</span>
        <span className="muted">{STATE_JA[c.state]}{c.state === "review" && ` · 安定度 ${c.stability < 1 ? "1日未満" : `${Math.round(c.stability)}日`}`}{!showTime && c.state !== "review" ? ` · ${timeOf(c.due)}` : ""}</span>
      </span>
      {c.state === "review" ? (
        <span className="recall" title="現在の想起確率（覚えている確率）">
          <span className="recall-bar"><span style={{ width: `${Math.round((r ?? 0) * 100)}%` }} /></span>
          <small>記憶 {pct(r)}</small>
        </span>
      ) : (
        // 学習中のカードは記憶率ではなく決まった短い間隔（数分〜）で再確認するので、率は出さない
        <span className="recall"><small>短い間隔で確認</small></span>
      )}
    </button>
  );
}

// ---- カード詳細 ---------------------------------------------------------

function CardSheet({ cardId, onClose }: { cardId: number; onClose: () => void }) {
  const [d, setD] = useState<CardDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.card(cardId).then(setD).catch((e) => setError(e.message)); }, [cardId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const c = d?.card;
  const dueIn = c ? (Date.parse(c.due) - Date.now()) / 86_400_000 : 0;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="bottom-sheet" role="dialog" aria-modal="true" aria-label="カードの記録" onClick={(e) => e.stopPropagation()}>
        <div className="row spread" style={{ flexWrap: "nowrap" }}>
          <h2 style={{ margin: 0 }}>{c?.headline ?? "…"}</h2>
          <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            {c?.itemType === "word" && <SpeakButtons text={c.headline} compact />}
            <button className="icon-btn" aria-label="閉じる" onClick={onClose}><IconClose /></button>
          </span>
        </div>
        {error && <p className="error">{error}</p>}
        {!d && !error && <p className="muted">読み込み中…</p>}
        {c && d && (
          <>
            <div className="sheet-stats">
              <div><span className="k">状態</span><strong>{STATE_JA[c.state]}</strong></div>
              <div><span className="k">次の復習</span><strong>{c.state === "new" ? "—" : dueIn <= 0 ? "いま" : formatInterval(dueIn)}</strong></div>
              <div><span className="k">記憶率</span><strong>{c.state === "review" ? pct(c.retrievability) : "—"}</strong></div>
              <div><span className="k">安定度</span><strong>{c.state === "new" ? "—" : c.stability < 1 ? "1日未満" : `${Math.round(c.stability)}日`}</strong></div>
              <div><span className="k">回答回数</span><strong>{c.reps}回</strong></div>
              <div><span className="k">忘れた回数</span><strong>{c.lapses}回</strong></div>
            </div>
            <h3 className="sheet-sub">回答の記録</h3>
            {d.reviews.length === 0 ? <p className="muted">まだ回答していません。</p> : (
              <div className="log-list">{d.reviews.map((l) => <LogRow key={l.id} l={l} showDate />)}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
