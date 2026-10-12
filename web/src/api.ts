import type {
  AuthResponse, Lesson, Card, CardDetail, DailyTasks, HistoryResponse, ReviewLogPage, ScheduleResponse, ExpressionGroup, LessonTarget, LevelDef, ReviewRequest, ReviewResult,
  PhraseRequest, PhraseSuggestion, SavePhraseRequest, Stats, StudySession, TranscriptAnalysis, User, Word,
} from "@ivocab/shared";
import { defaultApiBase, displayBase, getApiBase } from "./server.ts";

/** API クライアント。iOS 版も同じエンドポイントを叩く（docs/api.md）。接続先は server.ts で切り替える */
const LEGACY_TOKEN_KEY = "ivocab.token";
/** トークンは接続先ごとに保存する（サーバーを行き来してもそれぞれのログインが残る） */
const tokenKey = () => `ivocab.token@${getApiBase()}`;

export function getToken(): string | null {
  try {
    const t = localStorage.getItem(tokenKey());
    if (t) return t;
    // 接続先ごとに分ける前のトークンは既定のサーバーのもの
    return getApiBase() === defaultApiBase() ? localStorage.getItem(LEGACY_TOKEN_KEY) : null;
  } catch { return null; }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(tokenKey(), t);
    else localStorage.removeItem(tokenKey());
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const base = getApiBase();
  let res: Response;
  try {
    res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, `サーバー（${displayBase(base)}）に接続できません`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(null); window.dispatchEvent(new Event("ivocab:logout")); }
    throw new ApiError(res.status, data.message ?? data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

function qs(q: Record<string, string | number | undefined>): string {
  const p = Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
}

export const api = {
  register: (b: { email: string; password: string; displayName?: string; levelId?: string; timezone?: string }) => req<AuthResponse>("POST", "/auth/register", b),
  login: (email: string, password: string) => req<AuthResponse>("POST", "/auth/login", { email, password }),
  logout: () => req<{ ok: true }>("POST", "/auth/logout"),
  me: () => req<{ user: User }>("GET", "/me"),
  updateMe: (b: Partial<Pick<User, "displayName" | "levelId" | "desiredRetention" | "timezone">>) => req<{ user: User }>("PATCH", "/me", b),
  levels: () => req<{ levels: LevelDef[] }>("GET", "/levels"),
  tasks: () => req<DailyTasks>("GET", "/tasks/today"),
  session: (task: string) => req<StudySession>("GET", `/study/session?task=${task}`),
  review: (r: ReviewRequest) => req<ReviewResult>("POST", "/reviews", r),
  stats: () => req<Stats>("GET", "/stats"),
  history: (q: { from?: string; to?: string } = {}) => req<HistoryResponse>("GET", `/history${qs(q)}`),
  reviewLogs: (q: { date?: string; cardId?: number; limit?: number; before?: number } = {}) => req<ReviewLogPage>("GET", `/reviews${qs(q)}`),
  schedule: (days = 14) => req<ScheduleResponse>("GET", `/schedule?days=${days}`),
  card: (id: number) => req<CardDetail>("GET", `/cards/${id}`),
  words: (q: { q?: string; cefr?: string; offset?: number }) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.cefr) p.set("cefr", q.cefr);
    if (q.offset) p.set("offset", String(q.offset));
    return req<{ items: Word[]; total: number }>("GET", `/words?${p}`);
  },
  expressions: () => req<{ groups: ExpressionGroup[] }>("GET", "/expressions"),
  cards: () => req<{ cards: Card[] }>("GET", "/cards?limit=500"),
  addCard: (itemType: "word" | "expression", itemId: number) => req<{ card: Card }>("POST", "/cards", { itemType, itemId }),
  deleteCard: (id: number) => req<{ ok: true }>("DELETE", `/cards/${id}`),
  suggestPhrases: (b: PhraseRequest) => req<PhraseSuggestion>("POST", "/phrases/suggest", b),
  savePhrase: (b: SavePhraseRequest) => req<{ word: Word; card: Card }>("POST", "/phrases", b),
  phrases: () => req<{ phrases: Word[] }>("GET", "/phrases"),
  analyze: (text: string) => req<TranscriptAnalysis>("POST", "/capture/analyze", { text }),
  addLessonCards: (b: { wordIds?: number[]; groupIds?: number[]; customWords?: { lemma: string; meaningJa: string }[]; corrections?: { original: string; better: string }[] }) =>
    req<{ cards: Card[] }>("POST", "/capture/cards", b),
  suggestions: () => req<{ targets: LessonTarget[] }>("GET", "/lessons/suggestions"),
  lessons: () => req<{ lessons: Lesson[] }>("GET", "/lessons"),
  lesson: (id: number) => req<{ lesson: Lesson; prepSheet: string }>("GET", `/lessons/${id}`),
  createLesson: (b: { lessonDate: string; tutor?: string; topic?: string; targetCardIds: number[] }) =>
    req<{ lesson: Lesson; prepSheet: string }>("POST", "/lessons", b),
  updateLesson: (id: number, b: { notes?: string; tutor?: string; topic?: string }) => req<{ lesson: Lesson; prepSheet: string }>("PATCH", `/lessons/${id}`, b),
  markUsed: (lessonId: number, cardId: number, used: boolean) => req<{ lesson: Lesson }>("PUT", `/lessons/${lessonId}/targets/${cardId}`, { used }),
};

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
