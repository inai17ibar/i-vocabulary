import { useEffect, useState } from "react";
import type { LevelDef, User } from "@ivocab/shared";
import { api } from "../api.ts";

export function Settings({ user, onChange, onLogout }: { user: User; onChange: (u: User) => void; onLogout: () => void }) {
  const [levels, setLevels] = useState<LevelDef[]>([]);
  const [saved, setSaved] = useState("");
  useEffect(() => { api.levels().then((r) => setLevels(r.levels)); }, []);
  const update = async (patch: Partial<User>) => {
    const r = await api.updateMe(patch);
    onChange(r.user);
    setSaved("保存しました");
    setTimeout(() => setSaved(""), 1500);
  };
  const current = levels.find((l) => l.id === user.levelId);

  return (
    <div>
      <div className="card">
        <h2>目標レベル</h2>
        <select value={user.levelId} onChange={(e) => update({ levelId: e.target.value })}>
          <optgroup label="英検">
            {levels.filter((l) => l.exam === "eiken").map((l) => <option key={l.id} value={l.id}>{l.label}（CEFR {l.cefr}）</option>)}
          </optgroup>
          <optgroup label="IELTS">
            {levels.filter((l) => l.exam === "ielts").map((l) => <option key={l.id} value={l.id}>{l.label}（CEFR {l.cefr}）</option>)}
          </optgroup>
        </select>
        {current && (
          <p className="muted">
            出題帯: CEFR {current.vocabBands.join(" / ")}（目安 {current.vocabSize}）· 1日: 新出 {current.plan.newWords} 語 + 表現 {current.plan.newExpressions} セット,
            類義語 {current.plan.synonymDrill} / 対義語 {current.plan.antonymDrill} / 言い換え {current.plan.paraphraseDrill} 問
          </p>
        )}
      </div>
      <div className="card">
        <h2>目標保持率</h2>
        <p className="muted">復習時点で覚えていたい確率。高くすると復習回数が増え、低くすると減ります（推奨 90%）。</p>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input type="range" min={0.8} max={0.95} step={0.01} value={user.desiredRetention} onChange={(e) => onChange({ ...user, desiredRetention: Number(e.target.value) })}
            onPointerUp={(e) => update({ desiredRetention: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => update({ desiredRetention: Number((e.target as HTMLInputElement).value) })} />
          <strong style={{ minWidth: 48 }}>{Math.round(user.desiredRetention * 100)}%</strong>
        </div>
      </div>
      <div className="card">
        <h2>アカウント</h2>
        <p className="sub">{user.email} · タイムゾーン {user.timezone}</p>
        <button className="ghost" onClick={onLogout}>ログアウト</button>
      </div>
      {saved && <p className="muted">{saved}</p>}
    </div>
  );
}
