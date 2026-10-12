import { useEffect, useState } from "react";
import type { LevelDef, User } from "@ivocab/shared";
import { api } from "../api.ts";
import { MicCheck } from "../components/Pronounce.tsx";
import { ServerPicker } from "../components/ServerPicker.tsx";
import { canSwitchServer } from "../server.ts";
import { type Accent, speak, sttSupported, ttsSupported, useSpeechPrefs } from "../speech.ts";

export function Settings({ user, onChange, onLogout }: { user: User; onChange: (u: User) => void; onLogout: () => void }) {
  const [levels, setLevels] = useState<LevelDef[]>([]);
  const [saved, setSaved] = useState("");
  const [prefs, setPrefs] = useSpeechPrefs();
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
        <h2>発音</h2>
        {!ttsSupported() && <p className="error">このブラウザは読み上げに対応していません</p>}
        <label>アクセント</label>
        <div className="seg">
          {(["en-US", "en-GB"] as Accent[]).map((a) => (
            <button key={a} className={prefs.accent === a ? "on" : ""} onClick={() => { setPrefs({ ...prefs, accent: a }); speak("pronunciation"); }}>
              {a === "en-US" ? "アメリカ英語" : "イギリス英語"}
            </button>
          ))}
        </div>
        <label>読み上げ速度 {prefs.rate.toFixed(2)}×</label>
        <input type="range" min={0.6} max={1.2} step={0.05} value={prefs.rate} onChange={(e) => setPrefs({ ...prefs, rate: Number(e.target.value) })}
          onPointerUp={() => speak("How are you doing today?")} />
        <div className="switch-row">
          <span>新しい単語を自動で読み上げる</span>
          <input type="checkbox" checked={prefs.autoplay} onChange={(e) => setPrefs({ ...prefs, autoplay: e.target.checked })} />
        </div>
        <label>発音チェックのテスト</label>
        {sttSupported() ? <MicCheck target="vocabulary" label="“vocabulary” と言ってみる" /> : (
          <p className="muted">このブラウザは音声認識に対応していません（iPhone の Safari、Android / PC の Chrome で利用できます）</p>
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
      {canSwitchServer() && (
        <div className="card">
          <h2>接続先サーバー</h2>
          <p className="sub">ローカルの Mac・デプロイ版などを切り替えます。ログイン状態は接続先ごとに保存されます。</p>
          <ServerPicker />
        </div>
      )}
      <div className="card">
        <h2>アカウント</h2>
        <p className="sub">{user.email} · タイムゾーン {user.timezone}</p>
        <button className="ghost" onClick={onLogout}>ログアウト</button>
      </div>
      {saved && <p className="muted" role="status">{saved}</p>}
    </div>
  );
}
