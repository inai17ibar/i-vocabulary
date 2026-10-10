import { useEffect, useState } from "react";
import type { User } from "@ivocab/shared";
import { api, getToken, setToken } from "./api.ts";
import { IconBook, IconChart, IconChat, IconGear, IconHome } from "./components/Icons.tsx";
import { Login } from "./pages/Login.tsx";
import { Today } from "./pages/Today.tsx";
import { Study } from "./pages/Study.tsx";
import { Words } from "./pages/Words.tsx";
import { Cambly } from "./pages/Cambly.tsx";
import { StatsPage } from "./pages/Stats.tsx";
import { Settings } from "./pages/Settings.tsx";

const TABS = [
  { id: "today", label: "今日", title: "今日の学習", icon: IconHome },
  { id: "words", label: "単語", title: "単語・表現", icon: IconBook },
  { id: "cambly", label: "Cambly", title: "Cambly 連携", icon: IconChat },
  { id: "stats", label: "記録", title: "学習曲線", icon: IconChart },
  { id: "settings", label: "設定", title: "設定", icon: IconGear },
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
    const onHash = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
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
  if (route.page === "study") return <Study task={route.arg ?? "review"} onExit={() => go("today")} />;

  const tab = TABS.find((t) => t.id === route.page) ?? TABS[0];
  return (
    <div className="app">
      <header className="top">
        <h1>{tab.title}</h1>
        <span className="muted">{user.displayName}</span>
      </header>
      {tab.id === "today" && <Today onStart={(task) => go(`study/${task}`)} />}
      {tab.id === "words" && <Words />}
      {tab.id === "cambly" && <Cambly />}
      {tab.id === "stats" && <StatsPage />}
      {tab.id === "settings" && <Settings user={user} onChange={setUser} onLogout={async () => { await api.logout().catch(() => {}); setToken(null); setUser(null); }} />}
      <nav className="bottom" aria-label="メイン">
        {TABS.map((t) => (
          <button key={t.id} className={tab.id === t.id ? "active" : ""} aria-current={tab.id === t.id ? "page" : undefined} onClick={() => go(t.id)}>
            <t.icon />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
