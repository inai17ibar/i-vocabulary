import { useEffect, useState } from "react";
import type { Stats } from "@ivocab/shared";
import { CEFR_LEVELS } from "@ivocab/shared";
import { api } from "../api.ts";
import { BarChart, CurveChart } from "../components/Charts.tsx";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function StatsPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [target, setTarget] = useState(0.9);
  useEffect(() => {
    api.stats().then(setS);
    api.me().then((r) => setTarget(r.user.desiredRetention));
  }, []);
  if (!s) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <div className="stat-tiles">
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
        <h2>過去30日の学習量</h2>
        <BarChart data={s.history.map((h) => ({ x: h.date.slice(5), y: h.count, sub: h.count ? `正答 ${Math.round((h.correct / h.count) * 100)}%` : undefined }))} label="日別の回答数" valueLabel="問" />
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
