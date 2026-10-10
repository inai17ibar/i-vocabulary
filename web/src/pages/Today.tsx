import { useEffect, useState } from "react";
import type { DailyTasks } from "@ivocab/shared";
import { api } from "../api.ts";

export function Today({ onStart }: { onStart: (task: string) => void }) {
  const [data, setData] = useState<DailyTasks | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.tasks().then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <div className="row spread">
        <h2 style={{ margin: 0 }}>今日のタスク</h2>
        <span className="tag">{data.levelLabel}</span>
      </div>
      {data.tasks.map((t) => {
        const pct = t.target ? Math.min(100, Math.round((t.done / t.target) * 100)) : 100;
        const finished = t.target > 0 && t.done >= t.target;
        const empty = t.key === "review" && t.target === 0;
        return (
          <div className="card" key={t.key}>
            <div className="row spread">
              <div>
                <strong>{t.title}</strong>
                <div className="muted">{t.description}</div>
              </div>
              <div className="row">
                <span className="sub">{t.done} / {t.target}</span>
                <button className={finished || empty ? "ghost" : "btn"} disabled={empty} onClick={() => onStart(t.key)}>
                  {empty ? "なし" : finished ? "もう一度" : "開始"}
                </button>
              </div>
            </div>
            <div className="progress" aria-label={`${pct}%`}><div style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
      <div className="card">
        <strong>アウトプット課題</strong>
        <p style={{ margin: "6px 0" }}>{data.outputPrompt}</p>
        <p className="muted">今日覚えた単語・表現を 2〜3 個使って声に出して答えてみましょう。Cambly のレッスンで講師に投げかけるのもおすすめです。</p>
      </div>
    </div>
  );
}
