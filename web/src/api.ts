import type {
  AuthResponse, CamblyLesson, Card, DailyTasks, ExpressionGroup, LessonTarget, LevelDef, ReviewRequest, ReviewResult,
  Stats, StudySession, TranscriptAnalysis, User, Word,
} from "@ivocab/shared";

/** API クライアント。iOS 版も同じエンドポイントを叩く（docs/api.md） */
const BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";
const TOKEN_KEY = "ivocab.token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(null); window.dispatchEvent(new Event("ivocab:logout")); }
    throw new ApiError(res.status, data.message ?? data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
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
  analyze: (text: string) => req<TranscriptAnalysis>("POST", "/cambly/analyze", { text }),
  addLessonCards: (b: { wordIds?: number[]; groupIds?: number[]; customWords?: { lemma: string; meaningJa: string }[]; corrections?: { original: string; better: string }[] }) =>
    req<{ cards: Card[] }>("POST", "/cambly/cards", b),
  suggestions: () => req<{ targets: LessonTarget[] }>("GET", "/cambly/suggestions"),
  lessons: () => req<{ lessons: CamblyLesson[] }>("GET", "/cambly/lessons"),
  lesson: (id: number) => req<{ lesson: CamblyLesson; prepSheet: string }>("GET", `/cambly/lessons/${id}`),
  createLesson: (b: { lessonDate: string; tutor?: string; topic?: string; targetCardIds: number[] }) =>
    req<{ lesson: CamblyLesson; prepSheet: string }>("POST", "/cambly/lessons", b),
  updateLesson: (id: number, b: { notes?: string; tutor?: string; topic?: string }) => req<{ lesson: CamblyLesson; prepSheet: string }>("PATCH", `/cambly/lessons/${id}`, b),
  markUsed: (lessonId: number, cardId: number, used: boolean) => req<{ lesson: CamblyLesson }>("PUT", `/cambly/lessons/${lessonId}/targets/${cardId}`, { used }),
};

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
