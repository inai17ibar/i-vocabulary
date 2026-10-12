/**
 * 接続先 API サーバーの切り替え。
 *
 * 決まり方（上ほど優先）:
 *  1. アプリ内で選んだ接続先（localStorage。端末ごと）
 *  2. ビルド時の既定 VITE_API_BASE（未指定なら同一オリジンの /api/v1）
 *
 * 候補一覧は「既定」+ VITE_API_SERVERS（`名前=URL;名前=URL`）。本番 URL などはここに入れ、
 * 自宅の LAN IP のような個人の値は `.env.*.local`（git 管理外）かアプリ内の入力で渡す。
 */
import { Capacitor } from "@capacitor/core";

export interface ServerPreset {
  label: string;
  base: string;
}

const STORAGE_KEY = "ivocab.apiBase";
const API_PATH = "/api/v1";

/**
 * 入力を API のベース URL に整える。"192.168.0.10:8787" → "http://192.168.0.10:8787/api/v1"。
 * パスを省略したら /api/v1 を補う。相対パス（/api/v1）はそのまま。解釈できなければ null
 */
export function normalizeApiBase(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (s.startsWith("/")) return s.replace(/\/+$/, "") || null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path || API_PATH}`;
}

/** "本番=https://a.example.com;ステージング=https://b.example.com" を候補に */
export function parsePresets(raw: string | undefined): ServerPreset[] {
  if (!raw) return [];
  return raw.split(";").flatMap((part) => {
    const i = part.indexOf("=");
    if (i <= 0) return [];
    const base = normalizeApiBase(part.slice(i + 1));
    return base ? [{ label: part.slice(0, i).trim(), base }] : [];
  });
}

export function defaultApiBase(): string {
  return normalizeApiBase(import.meta.env.VITE_API_BASE ?? "") ?? API_PATH;
}

/** URL を人が読める形に（"http://192.168.0.10:8787/api/v1" → "192.168.0.10:8787"） */
export function displayBase(base: string): string {
  if (base.startsWith("/")) return "このサイトのサーバー";
  try {
    const u = new URL(base);
    return u.pathname === API_PATH ? u.host : `${u.host}${u.pathname}`;
  } catch {
    return base;
  }
}

export function serverPresets(): ServerPreset[] {
  const def = defaultApiBase();
  const extras = parsePresets(import.meta.env.VITE_API_SERVERS).filter((p) => p.base !== def);
  return [{ label: `既定（${displayBase(def)}）`, base: def }, ...extras];
}

export function getApiBase(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  return defaultApiBase();
}

/** 接続先を保存する。null か既定と同じなら既定に戻す */
export function setApiBase(base: string | null) {
  try {
    if (!base || base === defaultApiBase()) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, base);
  } catch { /* ignore */ }
}

/**
 * 接続先を切り替えられる環境か。アプリ（iOS）と開発中、候補が設定されたビルドで出す。
 * 同一オリジン配信の Web 版では出さない（利用者が触る必要がないため）
 */
export function canSwitchServer(): boolean {
  return Capacitor.isNativePlatform() || import.meta.env.DEV || !!import.meta.env.VITE_API_SERVERS;
}

/** その URL が i-vocabulary の API として応答するか確かめる */
export async function checkServer(base: string, timeoutMs = 5000): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return { ok: false, error: `応答はありましたが i-vocabulary のサーバーではないようです（HTTP ${res.status}）` };
    return { ok: true };
  } catch {
    return { ok: false, error: ctrl.signal.aborted ? "時間内に応答がありませんでした" : "接続できませんでした（URL・同じ Wi-Fi か・サーバーが起動しているかを確認）" };
  } finally {
    clearTimeout(timer);
  }
}
