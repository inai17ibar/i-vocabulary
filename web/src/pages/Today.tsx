import { useEffect, useState } from "react";
import type { DailyTasks } from "@ivocab/shared";
import { api } from "../api.ts";
import { SpeakButtons } from "../components/Pronounce.tsx";

export function Today({ onStart }: { onStart: (task: string) => void }) {
  const [data, setData] = useState<DailyTasks | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.tasks().then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const review = data.tasks.find((t) => t.key === "review")!;
  const remaining = review.target - review.done;
  const rest = data.tasks.filter((t) => t.key !== "review");
  const next = remaining > 0 ? "review" : rest.find((t) => t.done < t.target)?.key;

  return (
    <div>
      <div className="hero">
        <div className="row spread">
          <span style={{ opacity: .9, fontSize: 14 }}>{data.levelLabel} · {data.date}</span>
        </div>
        {remaining > 0 ? (
          <><div className="big">{remaining}<small style={{ fontSize: 16 }}> 枚</small></div><div style={{ opacity: .9 }}>いま復習すると最も効率よく記憶に残ります</div></>
        ) : (
          <><div className="big" style={{ fontSize: 24 }}>復習はすべて完了</div><div style={{ opacity: .9 }}>新しい単語やドリルに進みましょう</div></>
        )}
        {next && <button className="btn block" onClick={() => onStart(next)}>{next === "review" ? "復習を始める" : "次のタスクを始める"}</button>}
      </div>

      {rest.map((t) => {
        const pct = t.target ? Math.min(100, Math.round((t.done / t.target) * 100)) : 100;
        const finished = t.target > 0 && t.done >= t.target;
        return (
          <button className={`task ${finished ? "done" : ""}`} key={t.key} onClick={() => onStart(t.key)}>
            <div className="body">
              <div className="row spread" style={{ flexWrap: "nowrap" }}>
                <strong>{t.title}</strong>
                <span className="count">{t.done}/{t.target}</span>
              </div>
              <div className="muted">{t.description}</div>
              <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            </div>
            <span className="go" aria-hidden="true">{finished ? "✓" : "›"}</span>
          </button>
        );
      })}

      <div className="card">
        <div className="row spread" style={{ flexWrap: "nowrap" }}>
          <strong>アウトプット課題</strong>
          <SpeakButtons text={data.outputPrompt} compact />
        </div>
        <p style={{ margin: "6px 0" }}>{data.outputPrompt}</p>
        <p className="muted">今日覚えた単語・表現を 2〜3 個使って声に出して答えてみましょう。英会話レッスンで講師に投げかけるのもおすすめです。言えなかったことは「フレーズ」タブで言い方を調べられます。</p>
      </div>
    </div>
  );
}
