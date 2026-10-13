import { useState } from "react";
import { checkServer, displayBase, getApiBase, normalizeApiBase, serverPresets, setApiBase } from "../server.ts";

const CUSTOM = "__custom__";

/**
 * 接続先サーバーの選択。候補から選ぶか URL を入力し、接続テストが通ったら保存して再読み込みする
 * （トークンは接続先ごとに保存しているので、切り替え後はその接続先のログイン状態になる）
 */
export function ServerPicker({ compact = false }: { compact?: boolean }) {
  const presets = serverPresets();
  const current = getApiBase();
  const currentIsPreset = presets.some((p) => p.base === current);
  const [open, setOpen] = useState(!compact);
  const [choice, setChoice] = useState(currentIsPreset ? current : CUSTOM);
  const [custom, setCustom] = useState(currentIsPreset ? "" : current);
  const [status, setStatus] = useState<{ kind: "idle" | "checking" | "ok" | "error"; message?: string }>({ kind: "idle" });

  const target = choice === CUSTOM ? normalizeApiBase(custom) : choice;

  const apply = async () => {
    if (!target) {
      setStatus({ kind: "error", message: "URL を入力してください（例: 192.168.0.10:8787 / https://example.com）" });
      return;
    }
    setStatus({ kind: "checking" });
    const r = await checkServer(target);
    if (!r.ok) {
      setStatus({ kind: "error", message: r.error });
      return;
    }
    if (target === current) {
      setStatus({ kind: "ok", message: "接続できました（変更はありません）" });
      return;
    }
    setApiBase(target);
    setStatus({ kind: "ok", message: "接続できました。切り替えます…" });
    location.reload();
  };

  if (!open) {
    return (
      <div className="server-line">
        <span className="muted">接続先: <strong>{displayBase(current)}</strong></span>
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>変更</button>
      </div>
    );
  }

  return (
    <div className="server-picker">
      <div className="choices compact" role="radiogroup" aria-label="接続先サーバー">
        {presets.map((p) => (
          <label key={p.base} className={`server-option ${choice === p.base ? "on" : ""}`}>
            <input type="radio" name="server" checked={choice === p.base} onChange={() => { setChoice(p.base); setStatus({ kind: "idle" }); }} />
            <span><strong>{p.label}</strong>{p.base === current && <span className="tag" style={{ marginLeft: 6 }}>使用中</span>}<small>{p.base}</small></span>
          </label>
        ))}
        <label className={`server-option ${choice === CUSTOM ? "on" : ""}`}>
          <input type="radio" name="server" checked={choice === CUSTOM} onChange={() => { setChoice(CUSTOM); setStatus({ kind: "idle" }); }} />
          <span>
            <strong>URL を入力</strong>{!currentIsPreset && <span className="tag" style={{ marginLeft: 6 }}>使用中</span>}
            <small>同じ Wi-Fi の Mac（192.168.x.x:8787）やデプロイ先の URL</small>
          </span>
        </label>
      </div>
      {choice === CUSTOM && (
        <input
          type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="192.168.0.10:8787 または https://example.com" value={custom}
          onChange={(e) => { setCustom(e.target.value); setStatus({ kind: "idle" }); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
          style={{ marginTop: 8 }}
        />
      )}
      {choice === CUSTOM && target && <p className="muted" style={{ margin: "4px 0 0" }}>→ {target}</p>}
      {status.message && <p className={status.kind === "error" ? "error" : "ok-text"} role="status">{status.message}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={apply} disabled={status.kind === "checking"}>
          {status.kind === "checking" ? "接続を確認中…" : "接続テストして切り替える"}
        </button>
        {compact && <button type="button" className="ghost" onClick={() => setOpen(false)}>閉じる</button>}
      </div>
    </div>
  );
}
