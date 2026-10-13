import type { DailyTask, DailyTasks, QuizMode, QuizQuestion, StudySession, User } from "@ivocab/shared";
import { getLevel } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { introduceNewCards, introducedToday } from "./cards.ts";
import { expressionFlashcard, flashcardQuestion, questionForCard, reviewModesFor, type Rng, shuffle } from "./quiz.ts";
import type { CardRow } from "./srs.ts";
import { endOfLocalDay, localDate } from "./time.ts";
import { getExpressionGroup, getWord } from "./vocab.ts";

export type TaskKey = "review" | "new" | "synonym" | "antonym" | "paraphrase";

function dueCards(db: DB, user: User, until: Date, limit: number): CardRow[] {
  return db.prepare("SELECT * FROM cards WHERE user_id = ? AND state <> 0 AND due <= ? ORDER BY due LIMIT ?").all(user.id, until.toISOString(), limit) as unknown as CardRow[];
}

function countDue(db: DB, user: User, until: Date): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND state <> 0 AND due <= ?").get(user.id, until.toISOString()) as { n: number }).n;
}

/** 今日そのモードで回答した数 */
function doneToday(db: DB, user: User, modes: string[], now: Date): number {
  const today = localDate(now, user.timezone);
  const ph = modes.map(() => "?").join(",");
  return (db.prepare(`SELECT COUNT(*) AS n FROM review_logs WHERE user_id = ? AND local_date = ? AND mode IN (${ph})`).get(user.id, today, ...modes) as { n: number }).n;
}

function reviewedTodayCount(db: DB, user: User, now: Date): number {
  const today = localDate(now, user.timezone);
  return (db.prepare(
    `SELECT COUNT(DISTINCT l.card_id) AS n FROM review_logs l WHERE l.user_id = ? AND l.local_date = ? AND l.state_before <> 0`,
  ).get(user.id, today) as { n: number }).n;
}

/** 日替わりで出題プロンプトを選ぶ */
function dailyPick<T>(arr: T[], date: string): T {
  let h = 0;
  for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return arr[h % arr.length];
}

export function dailyTasks(db: DB, user: User, now = new Date()): DailyTasks {
  const level = getLevel(user.levelId);
  const today = localDate(now, user.timezone);
  const eod = endOfLocalDay(now, user.timezone);
  const remainingDue = countDue(db, user, eod);
  const reviewedToday = reviewedTodayCount(db, user, now);
  const newWordsToday = introducedToday(db, user, "word", now);
  const newExprToday = introducedToday(db, user, "expression", now);
  const examNote = level.exam === "ielts"
    ? "IELTS の Lexical Resource では言い換えの幅が評価されます"
    : "英検の語彙問題・英作文で使える語を増やします";

  const tasks: DailyTask[] = [
    {
      key: "review",
      title: "今日の復習",
      description: "忘却曲線上で想起確率が目標値まで下がったカード。今やるのが最も効率的です",
      target: reviewedToday + remainingDue,
      done: reviewedToday,
      modes: ["flashcard", "meaning", "cloze", "listening", "synonym", "antonym", "paraphrase"],
    },
    {
      key: "new",
      title: `新しい単語・表現（${level.label}）`,
      description: `${level.vocabBands.join("/")} レベルの単語 ${level.plan.newWords} 語と「いろんな言い方」${level.plan.newExpressions} セット`,
      target: level.plan.newWords + level.plan.newExpressions,
      done: Math.min(newWordsToday, level.plan.newWords) + Math.min(newExprToday, level.plan.newExpressions),
      modes: ["flashcard"],
    },
    {
      key: "synonym",
      title: "類義語ドリル",
      description: `ニュアンスの違いも確認。${examNote}`,
      target: level.plan.synonymDrill,
      done: Math.min(doneToday(db, user, ["synonym"], now), level.plan.synonymDrill),
      modes: ["synonym"],
    },
    {
      key: "antonym",
      title: "対義語ドリル",
      description: "反対の意味をセットで覚えると記憶が強化されます",
      target: level.plan.antonymDrill,
      done: Math.min(doneToday(db, user, ["antonym"], now), level.plan.antonymDrill),
      modes: ["antonym"],
    },
    {
      key: "paraphrase",
      title: "言い換えドリル（いろんな言い方）",
      description: "同じ意図をカジュアル〜フォーマルで言い分ける練習",
      target: level.plan.paraphraseDrill,
      done: Math.min(doneToday(db, user, ["paraphrase"], now), level.plan.paraphraseDrill),
      modes: ["paraphrase"],
    },
  ];
  return { date: today, levelId: level.id, levelLabel: level.label, tasks, outputPrompt: dailyPick(level.outputPrompts, today) };
}

function wordCardsWithRelation(db: DB, user: User, type: "synonym" | "antonym", limit: number, excludeIds: number[]): CardRow[] {
  // 関係語を持つ単語カード。想起確率が低い（＝忘れかけ）順の近似として due の早い順
  const ex = excludeIds.length ? `AND c.id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  return db.prepare(
    `SELECT c.* FROM cards c JOIN words w ON w.id = c.item_id
     WHERE c.user_id = ? AND c.item_type = 'word' ${ex}
       AND (EXISTS (SELECT 1 FROM word_relations r WHERE r.word_id = w.id AND r.type = ?)
            OR EXISTS (SELECT 1 FROM word_relations r WHERE r.related_lemma = w.lemma AND r.type = ?))
     ORDER BY c.state = 0, c.due LIMIT ?`,
  ).all(user.id, ...excludeIds, type, type, limit) as unknown as CardRow[];
}

/** 学習セッション（問題リスト）を作る */
export function buildSession(db: DB, user: User, task: TaskKey, opts: { limit?: number; rng?: Rng; now?: Date } = {}): StudySession {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;
  const level = getLevel(user.levelId);
  const questions: QuizQuestion[] = [];
  const push = (q: QuizQuestion | null) => q && questions.push(q);

  if (task === "review") {
    // ダッシュボードと同じく「今日中（ユーザーのタイムゾーン）に期限が来るカード」を対象にする。
    // 数分後の学習ステップも先取りで出題する（1 日単位で復習する運用に合わせる）
    const cards = dueCards(db, user, endOfLocalDay(now, user.timezone), opts.limit ?? 30);
    for (const c of cards) push(questionForCard(db, c, reviewModesFor(c, rng), rng));
  } else if (task === "new") {
    const wordsLeft = Math.max(0, level.plan.newWords - introducedToday(db, user, "word", now));
    const exprLeft = Math.max(0, level.plan.newExpressions - introducedToday(db, user, "expression", now));
    // 導入済みで未学習（state=New）のカードも含める。自分で保存したフレーズ・取り込んだ語を先に
    const pending = db.prepare("SELECT * FROM cards WHERE user_id = ? AND state = 0 ORDER BY source IN ('phrase', 'capture', 'manual') DESC, id LIMIT 50").all(user.id) as unknown as CardRow[];
    const fresh = [...introduceNewCards(db, user, "word", wordsLeft, now), ...introduceNewCards(db, user, "expression", exprLeft, now)];
    const seen = new Set<number>();
    for (const c of [...pending, ...fresh]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.item_type === "word") {
        const w = getWord(db, c.item_id);
        if (w) push(flashcardQuestion(c.id, w));
      } else {
        const g = getExpressionGroup(db, c.item_id);
        if (g) push(expressionFlashcard(c.id, g));
      }
      if (questions.length >= (opts.limit ?? 30)) break;
    }
  } else if (task === "synonym" || task === "antonym") {
    const n = opts.limit ?? (task === "synonym" ? level.plan.synonymDrill : level.plan.antonymDrill);
    let cards = wordCardsWithRelation(db, user, task, n * 2, []);
    if (cards.length < n) {
      introduceNewCards(db, user, "word", n - cards.length, now);
      cards = wordCardsWithRelation(db, user, task, n * 2, []);
    }
    for (const c of shuffle(cards, rng)) {
      push(questionForCard(db, c, [task], rng));
      if (questions.length >= n) break;
    }
    // 関係語が作れなかった分のフォールバック（別モード）は除外して、ドリルの趣旨を保つ
    for (let i = questions.length - 1; i >= 0; i--) if (questions[i].mode !== task) questions.splice(i, 1);
  } else if (task === "paraphrase") {
    const n = opts.limit ?? level.plan.paraphraseDrill;
    let cards = db.prepare("SELECT * FROM cards WHERE user_id = ? AND item_type = 'expression' ORDER BY state = 0, due LIMIT ?").all(user.id, n) as unknown as CardRow[];
    if (cards.length < n) {
      introduceNewCards(db, user, "expression", n - cards.length, now);
      cards = db.prepare("SELECT * FROM cards WHERE user_id = ? AND item_type = 'expression' ORDER BY state = 0, due LIMIT ?").all(user.id, n) as unknown as CardRow[];
    }
    // グループ数が少ない場合は同じグループから別パターンで出題
    for (let i = 0; questions.length < n && i < n * 3 && cards.length; i++) push(questionForCard(db, cards[i % cards.length], ["paraphrase"], rng));
  }

  const eod = endOfLocalDay(now, user.timezone);
  return {
    questions,
    dueCount: countDue(db, user, eod),
    newCount: (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND state = 0").get(user.id) as { n: number }).n,
  };
}

export const TASK_KEYS: TaskKey[] = ["review", "new", "synonym", "antonym", "paraphrase"];
export function isTaskKey(v: unknown): v is TaskKey {
  return typeof v === "string" && (TASK_KEYS as string[]).includes(v);
}
export type { QuizMode };
