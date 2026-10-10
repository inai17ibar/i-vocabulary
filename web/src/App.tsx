import { useEffect, useState } from "react";
import type { User } from "@ivocab/shared";
import { api, getToken, setToken } from "./api.ts";
import { Login } from "./pages/Login.tsx";
import { Today } from "./pages/Today.tsx";
import { Study } from "./pages/Study.tsx";
import { Words } from "./pages/Words.tsx";
import { Cambly } from "./pages/Cambly.tsx";
import { StatsPage } from "./pages/Stats.tsx";
import { Settings } from "./pages/Settings.tsx";

const TABS = [
  { id: "today", label: "今日" },
  { id: "words", label: "単語・表現" },
  { id: "cambly", label: "Cambly" },
  { id: "stats", label: "学習曲線" },
  { id: "settings", label: "設定" },
] as const;

function parseHash() {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  return { page: page || "today", arg };
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    const onLogout = () => setUser(null);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("ivocab:logout", onLogout);
    if (getToken()) api.me().then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("ivocab:logout", onLogout);
    };
  }, []);

  if (loading) return <div className="app"><p className="muted">読み込み中…</p></div>;
  if (!user) return <Login onLogin={(t, u) => { setToken(t); setUser(u); }} />;

  const go = (h: string) => { location.hash = `#/${h}`; };
  return (
    <div className="app">
      <header className="top">
        <h1>i-vocabulary</h1>
        <span className="muted">{user.displayName}</span>
      </header>
      {route.page !== "study" && (
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={route.page === t.id ? "active" : ""} onClick={() => go(t.id)}>{t.label}</button>
          ))}
        </nav>
      )}
      {route.page === "today" && <Today onStart={(task) => go(`study/${task}`)} />}
      {route.page === "study" && <Study task={route.arg ?? "review"} onExit={() => go("today")} />}
      {route.page === "words" && <Words />}
      {route.page === "cambly" && <Cambly />}
      {route.page === "stats" && <StatsPage />}
      {route.page === "settings" && <Settings user={user} onChange={setUser} onLogout={async () => { await api.logout().catch(() => {}); setToken(null); setUser(null); }} />}
    </div>
  );
}
