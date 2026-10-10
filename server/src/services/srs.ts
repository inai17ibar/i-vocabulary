import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  type Card as FsrsCard,
  type Grade as FsrsGrade,
} from "ts-fsrs";
import type { CardState, Grade } from "@ivocab/shared";

/**
 * 学習曲線（忘却曲線）を考慮したスケジューリング。
 * FSRS (Free Spaced Repetition Scheduler) を採用：各カードの「安定度 S」と「難易度 D」を推定し、
 * 想起確率 R(t) = (1 + F·t/S)^C が目標保持率（既定 90%）まで下がるタイミングで復習を出す。
 * SM-2（Anki 旧方式）より少ない復習回数で同じ保持率を達成できることが知られている。
 */

export interface CardRow {
  id: number;
  user_id: number;
  item_type: "word" | "expression";
  item_id: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  source: string;
  created_at: string;
}

const STATE_NAMES: Record<number, CardState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

export function stateName(state: number): CardState {
  return STATE_NAMES[state] ?? "new";
}

export function scheduler(desiredRetention = 0.9) {
  return fsrs(
    generatorParameters({
      request_retention: desiredRetention,
      maximum_interval: 3650,
      enable_fuzz: true,
      enable_short_term: true,
    }),
  );
}

export function rowToFsrs(row: CardRow): FsrsCard {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function emptyCardFields(now: Date) {
  const c = createEmptyCard(now);
  return fsrsToFields(c);
}

export function fsrsToFields(c: FsrsCard) {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as number,
    last_review: c.last_review ? c.last_review.toISOString() : null,
  };
}

export function review(row: CardRow, grade: Grade, now: Date, desiredRetention: number) {
  const f = scheduler(desiredRetention);
  const { card, log } = f.next(rowToFsrs(row), now, grade as FsrsGrade);
  return { fields: fsrsToFields(card), log };
}

/** 現在の想起確率。未学習カードは null */
export function retrievability(row: CardRow, now: Date, desiredRetention = 0.9): number | null {
  if (row.state === State.New || !row.last_review) return null;
  return scheduler(desiredRetention).get_retrievability(rowToFsrs(row), now, false);
}

/**
 * クイズの正誤と回答時間から FSRS の評価を決める。
 * 正解かつ速い → Good、正解だが時間がかかった → Hard、不正解 → Again。
 */
export function gradeFromQuiz(correct: boolean, durationMs?: number): Grade {
  if (!correct) return 1;
  if (durationMs !== undefined && durationMs > 10_000) return 2;
  return 3;
}

/** 安定度 S のカードの忘却曲線（FSRS-5 以降の式）。t 日後の想起確率 */
export function forgettingCurve(stabilityDays: number, days: number, decay = -0.5): number {
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return Math.pow(1 + (factor * days) / stabilityDays, decay);
}
