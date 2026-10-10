import type { CamblyLesson, Cefr, CorrectionPair, ItemType, LessonTarget, TranscriptAnalysis, User } from "@ivocab/shared";
import { getLevel } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";
import { ensureCard, headlineFor, NotFoundError, recordReview } from "./cards.ts";
import type { CardRow } from "./srs.ts";
import { retrievability } from "./srs.ts";
import { expressionFragments, inflections, normalizeForMatch, STOPWORDS, tokenize } from "./text.ts";
import { upsertWord } from "./vocab.ts";

/**
 * Cambly 連携。
 * Cambly には公開 API がないため、次の 3 つの導線で連携する:
 *  1. レッスン前: 「今日使いたい単語・表現」リストを作り、Cambly のチャットに貼れる形で出力
 *  2. レッスン後: 実際に使えた語にチェック → 「アウトプット成功」として FSRS に Good で記録
 *  3. レッスン後: チャットログ／文字起こし／講師のメモを貼り付け → 既知語・表現・訂正・新出語候補を抽出してカード化
 */

const CORRECTION_PATTERNS: RegExp[] = [
  // "I go yesterday -> I went yesterday" / → / =>
  /^\s*[-*•]?\s*["'“]?(.+?)["'”]?\s*(?:->|→|=>|⇒)\s*["'“]?(.+?)["'”]?\s*$/,
  // "Instead of 'X', say 'Y'" / "Instead of X, you can say Y"
  /instead of\s+["'“]?(.+?)["'”]?\s*,\s*(?:you (?:can|could|should) )?(?:say|use|try)\s+["'“]?(.+?)["'”]?[.!]?\s*$/i,
  // "Not 'X' but 'Y'"
  /^\s*not\s+["'“](.+?)["'”]\s*,?\s*but\s+["'“](.+?)["'”]/i,
  // "X ✗ ... Y ✓" はレアなので省略。"Correction: X / Y"
  /^\s*correction:\s*(.+?)\s*\/\s*(.+?)\s*$/i,
];

export function extractCorrections(text: string): CorrectionPair[] {
  const out: CorrectionPair[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const re of CORRECTION_PATTERNS) {
      const m = line.match(re);
      if (m && m[1].trim() && m[2].trim() && m[1].trim() !== m[2].trim()) {
        out.push({ original: m[1].trim(), better: m[2].trim() });
        break;
      }
    }
  }
  return out;
}

export function analyzeTranscript(db: DB, user: User, text: string): TranscriptAnalysis {
  const tokens = tokenize(text);
  const tokenSet = new Set(tokens);
  const norm = normalizeForMatch(text);

  const words = db.prepare("SELECT id, lemma, cefr FROM words WHERE created_by IS NULL OR created_by = ?").all(user.id) as { id: number; lemma: string; cefr: Cefr }[];
  const cardKeys = new Set(
    (db.prepare("SELECT item_type, item_id FROM cards WHERE user_id = ?").all(user.id) as { item_type: ItemType; item_id: number }[]).map((r) => `${r.item_type}:${r.item_id}`),
  );
  const knownForms = new Set<string>();
  const knownWords: TranscriptAnalysis["knownWords"] = [];
  const seenLemma = new Set<string>();
  for (const w of words) {
    const forms = inflections(w.lemma);
    forms.forEach((f) => knownForms.add(f));
    if (seenLemma.has(w.lemma)) continue;
    const hit = w.lemma.includes(" ") ? norm.includes(` ${w.lemma.toLowerCase()} `) : forms.some((f) => tokenSet.has(f));
    if (hit && !STOPWORDS.has(w.lemma)) {
      seenLemma.add(w.lemma);
      knownWords.push({ wordId: w.id, lemma: w.lemma, cefr: w.cefr, hasCard: cardKeys.has(`word:${w.id}`) });
    }
  }

  const exprRows = db.prepare(
    "SELECT e.group_id, e.text, g.intent_ja FROM expressions e JOIN expression_groups g ON g.id = e.group_id",
  ).all() as { group_id: number; text: string; intent_ja: string }[];
  const expressions: TranscriptAnalysis["expressions"] = [];
  for (const e of exprRows) {
    const frags = expressionFragments(e.text);
    if (frags.length && frags.every((f) => norm.includes(` ${f} `))) {
      expressions.push({ groupId: e.group_id, text: e.text, intentJa: e.intent_ja, hasCard: cardKeys.has(`expression:${e.group_id}`) });
    }
  }

  // DB にない語のうち、長めで機能語でないものを出現頻度順に候補として出す
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (t.length < 5 || STOPWORDS.has(t) || knownForms.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const unknownCandidates = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 30).map(([t]) => t);

  return { knownWords, expressions, corrections: extractCorrections(text), unknownCandidates };
}

export interface AddFromLessonInput {
  wordIds?: number[];
  groupIds?: number[];
  customWords?: { lemma: string; meaningJa: string; pos?: string; example?: string }[];
  corrections?: { original: string; better: string }[];
}

/** レッスンで出てきた語・表現・訂正をカード化（source = cambly） */
export function addFromLesson(db: DB, user: User, input: AddFromLessonInput): CardRow[] {
  const level = getLevel(user.levelId);
  return tx(db, () => {
    const cards: CardRow[] = [];
    for (const id of input.wordIds ?? []) cards.push(ensureCard(db, user.id, "word", id, "cambly"));
    for (const id of input.groupIds ?? []) cards.push(ensureCard(db, user.id, "expression", id, "cambly"));
    for (const w of input.customWords ?? []) {
      if (!w.lemma.trim()) continue;
      const id = upsertWord(db, {
        lemma: w.lemma,
        pos: w.pos ?? "phrase",
        cefr: level.cefr,
        meaningJa: w.meaningJa,
        examples: w.example ? [{ en: w.example, ja: null }] : [],
        source: "cambly",
        createdBy: user.id,
      });
      cards.push(ensureCard(db, user.id, "word", id, "cambly"));
    }
    // 講師の訂正は「正しい言い方」をフレーズとして登録し、誤用を意味欄に残す
    for (const c of input.corrections ?? []) {
      if (!c.better.trim()) continue;
      const id = upsertWord(db, {
        lemma: c.better.trim(),
        pos: "phrase",
        cefr: level.cefr,
        meaningJa: `✗ ${c.original.trim()}`,
        source: "cambly-correction",
        createdBy: user.id,
      });
      cards.push(ensureCard(db, user.id, "word", id, "cambly"));
    }
    return cards;
  });
}

interface LessonRow {
  id: number;
  lesson_date: string;
  tutor: string | null;
  topic: string | null;
  notes: string | null;
  created_at: string;
}

function lessonTargets(db: DB, lessonId: number): LessonTarget[] {
  const rows = db.prepare(
    "SELECT t.card_id, t.used, c.item_type, c.item_id FROM lesson_targets t JOIN cards c ON c.id = t.card_id WHERE t.lesson_id = ? ORDER BY c.item_type DESC, c.id",
  ).all(lessonId) as { card_id: number; used: number; item_type: ItemType; item_id: number }[];
  return rows.map((r) => ({ cardId: r.card_id, used: !!r.used, itemType: r.item_type, headline: headlineFor(db, r.item_type, r.item_id) }));
}

function toLesson(db: DB, row: LessonRow): CamblyLesson {
  return {
    id: row.id,
    lessonDate: row.lesson_date,
    tutor: row.tutor,
    topic: row.topic,
    notes: row.notes,
    createdAt: row.created_at,
    targets: lessonTargets(db, row.id),
  };
}

export function getLesson(db: DB, userId: number, id: number): CamblyLesson {
  const row = db.prepare("SELECT id, lesson_date, tutor, topic, notes, created_at FROM cambly_lessons WHERE id = ? AND user_id = ?").get(id, userId) as LessonRow | undefined;
  if (!row) throw new NotFoundError(`lesson ${id} not found`);
  return toLesson(db, row);
}

export function listLessons(db: DB, userId: number): CamblyLesson[] {
  const rows = db.prepare("SELECT id, lesson_date, tutor, topic, notes, created_at FROM cambly_lessons WHERE user_id = ? ORDER BY lesson_date DESC, id DESC LIMIT 50").all(userId) as unknown as LessonRow[];
  return rows.map((r) => toLesson(db, r));
}

/**
 * レッスンで使う候補: 覚えたが定着しきっていない（想起確率が下がってきた）語を優先。
 * 「使う」ことで生成効果（generation effect）が働き、受動語彙→能動語彙に移る。
 */
export function suggestTargets(db: DB, user: User, now = new Date()): LessonTarget[] {
  const rows = db.prepare("SELECT * FROM cards WHERE user_id = ? AND state IN (1, 2, 3)").all(user.id) as unknown as CardRow[];
  const scored = rows
    .map((r) => ({ r, ret: retrievability(r, now, user.desiredRetention) ?? 1 }))
    .sort((a, b) => a.ret - b.ret);
  const words = scored.filter((s) => s.r.item_type === "word").slice(0, 6);
  const exprs = scored.filter((s) => s.r.item_type === "expression").slice(0, 2);
  return [...words, ...exprs].map(({ r }) => ({ cardId: r.id, itemType: r.item_type, headline: headlineFor(db, r.item_type, r.item_id), used: false }));
}

export interface LessonInput {
  lessonDate: string;
  tutor?: string | null;
  topic?: string | null;
  notes?: string | null;
  transcript?: string | null;
  targetCardIds?: number[];
}

export function createLesson(db: DB, user: User, input: LessonInput): CamblyLesson {
  const id = tx(db, () => {
    const r = db.prepare("INSERT INTO cambly_lessons (user_id, lesson_date, tutor, topic, notes, transcript, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      user.id, input.lessonDate, input.tutor ?? null, input.topic ?? null, input.notes ?? null, input.transcript ?? null, new Date().toISOString(),
    );
    const lessonId = Number(r.lastInsertRowid);
    setTargets(db, user.id, lessonId, input.targetCardIds ?? []);
    return lessonId;
  });
  return getLesson(db, user.id, id);
}

function setTargets(db: DB, userId: number, lessonId: number, cardIds: number[]) {
  for (const cid of cardIds) {
    const owns = db.prepare("SELECT 1 FROM cards WHERE id = ? AND user_id = ?").get(cid, userId);
    if (!owns) throw new NotFoundError(`card ${cid} not found`);
    db.prepare("INSERT OR IGNORE INTO lesson_targets (lesson_id, card_id) VALUES (?, ?)").run(lessonId, cid);
  }
}

export function updateLesson(db: DB, user: User, id: number, input: Partial<LessonInput>): CamblyLesson {
  getLesson(db, user.id, id);
  tx(db, () => {
    const cur = db.prepare("SELECT * FROM cambly_lessons WHERE id = ?").get(id) as Record<string, string | null>;
    db.prepare("UPDATE cambly_lessons SET lesson_date = ?, tutor = ?, topic = ?, notes = ?, transcript = ? WHERE id = ?").run(
      input.lessonDate ?? cur.lesson_date,
      input.tutor !== undefined ? input.tutor : cur.tutor,
      input.topic !== undefined ? input.topic : cur.topic,
      input.notes !== undefined ? input.notes : cur.notes,
      input.transcript !== undefined ? input.transcript : cur.transcript,
      id,
    );
    if (input.targetCardIds) setTargets(db, user.id, id, input.targetCardIds);
  });
  return getLesson(db, user.id, id);
}

/** レッスン中に使えた → FSRS に Good として記録（1 レッスン 1 回まで） */
export function markTargetUsed(db: DB, user: User, lessonId: number, cardId: number, used: boolean): CamblyLesson {
  getLesson(db, user.id, lessonId);
  const t = db.prepare("SELECT used FROM lesson_targets WHERE lesson_id = ? AND card_id = ?").get(lessonId, cardId) as { used: number } | undefined;
  if (!t) throw new NotFoundError(`target ${cardId} not in lesson ${lessonId}`);
  db.prepare("UPDATE lesson_targets SET used = ? WHERE lesson_id = ? AND card_id = ?").run(used ? 1 : 0, lessonId, cardId);
  if (used && !t.used) {
    recordReview(db, user, { cardId, grade: 3, mode: "lesson", clientReviewId: `lesson-${lessonId}-card-${cardId}` });
  }
  return getLesson(db, user.id, lessonId);
}

/** Cambly のチャットに貼る「今日の練習リスト」 */
export function prepSheet(db: DB, lesson: CamblyLesson): string {
  const words = lesson.targets.filter((t) => t.itemType === "word").map((t) => t.headline);
  const exprs = lesson.targets
    .filter((t) => t.itemType === "expression")
    .map((t) => (db.prepare("SELECT g.intent_en FROM cards c JOIN expression_groups g ON g.id = c.item_id WHERE c.id = ?").get(t.cardId) as { intent_en: string }).intent_en.toLowerCase());
  const lines = [
    "Hi! Today I'd like to practice using these words in conversation:",
    words.length ? words.map((w) => `- ${w}`).join("\n") : "- (none)",
  ];
  if (exprs.length) lines.push(`I'm also practicing different ways to: ${exprs.join(" / ")}`);
  lines.push("Could you correct me if I use them unnaturally, and type corrections in the chat? Thank you!");
  return lines.join("\n");
}
