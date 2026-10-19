import { useEffect, useState } from "react";
import type { LevelDef, User } from "@ivocab/shared";
import { DATA_SOURCES, DERIVED_DATA_NOTICE } from "@ivocab/shared";
import { api } from "../api.ts";
import { MicCheck } from "../components/Pronounce.tsx";
import { ServerPicker } from "../components/ServerPicker.tsx";
import { canSwitchServer } from "../server.ts";
import { type Accent, speak, sttSupported, ttsSupported, useSpeechPrefs } from "../speech.ts";

export function Settings({ user, onChange, onLogout, onDeleted }: { user: User; onChange: (u: User) => void; onLogout: () => void; onDeleted: () => void }) {
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
      <DeleteAccount onDeleted={onDeleted} />
      <details className="card credits">
        <summary><h2 style={{ display: "inline" }}>データの出典とライセンス</h2></summary>
        <p className="muted">英検・IELTS の公式教材や市販の単語帳は使っていません。レベルは CEFR を介して英検・IELTS に対応づけています。</p>
        <ul>
          {DATA_SOURCES.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> — {s.usage}
              <div className="muted">{s.credit} · {s.licenseUrl ? <a href={s.licenseUrl} target="_blank" rel="noreferrer">{s.license}</a> : s.license}</div>
            </li>
          ))}
        </ul>
        <p className="muted">{DERIVED_DATA_NOTICE}</p>
      </details>
      {saved && <p className="muted" role="status">{saved}</p>}
    </div>
  );
}

/** アカウント削除。誤操作を防ぐため、開いてパスワードを入れてから実行する */
function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount(password);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>アカウントの削除</h2>
      {!open ? (
        <>
          <p className="sub">アカウントと、学習記録・保存したフレーズ・追加した単語などのデータをすべて削除します。元に戻せません。</p>
          <button className="ghost danger" onClick={() => setOpen(true)}>アカウントを削除…</button>
        </>
      ) : (
        <>
          <p className="error">削除すると学習記録やフレーズは復元できません。続けるにはパスワードを入力してください。</p>
          <input type="password" autoComplete="current-password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button className="ghost" onClick={() => { setOpen(false); setPassword(""); setError(""); }} disabled={busy}>やめる</button>
            <button className="ghost danger" onClick={submit} disabled={busy || !password}>{busy ? "削除しています…" : "完全に削除する"}</button>
          </div>
        </>
      )}
    </div>
  );
}
