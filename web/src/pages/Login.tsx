import { useEffect, useState } from "react";
import type { LevelDef, User } from "@ivocab/shared";
import { api } from "../api.ts";

export function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [levelId, setLevelId] = useState("eiken-2");
  const [levels, setLevels] = useState<LevelDef[]>([]);
  const [error, setError] = useState("");

  useEffect(() => { api.levels().then((r) => setLevels(r.levels)).catch(() => {}); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const r = mode === "login"
        ? await api.login(email, password)
        : await api.register({ email, password, levelId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      onLogin(r.token, r.user);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="app">
      <header className="top"><h1>i-vocabulary</h1></header>
      <div className="card">
        <h2>{mode === "login" ? "ログイン" : "はじめる"}</h2>
        <p className="sub">英会話で「使える」語彙を、忘却曲線に合わせて最短で。</p>
        <form onSubmit={submit}>
          <label>メールアドレス</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>パスワード（8文字以上）</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          {mode === "register" && (
            <>
              <label>目標レベル（英検 / IELTS）</label>
              <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
                {levels.map((l) => <option key={l.id} value={l.id}>{l.label}（CEFR {l.cefr}）</option>)}
              </select>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" type="submit">{mode === "login" ? "ログイン" : "登録して始める"}</button>
            <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "新規登録はこちら" : "ログインはこちら"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
