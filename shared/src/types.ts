/**
 * API の入出力型（Web クライアントと将来の iOS クライアントの共通契約）。
 * iOS 側はこのファイルと docs/api.md を元に Codable 構造体を定義する。
 * 日時はすべて ISO 8601 文字列 (UTC)。
 */
import type { Cefr, ExamType } from "./levels.ts";

export type ItemType = "word" | "expression";
export type CardState = "new" | "learning" | "review" | "relearning";
export type Register = "casual" | "neutral" | "formal";
export type RelationType = "synonym" | "antonym";
export type CardSource = "level" | "cambly" | "manual";

/** FSRS の 4 段階評価。1=Again 2=Hard 3=Good 4=Easy */
export type Grade = 1 | 2 | 3 | 4;

export type QuizMode =
  | "flashcard"   // 単語→意味（自己評価）
  | "meaning"     // 日本語の意味→英単語を選ぶ
  | "synonym"     // 類義語を選ぶ
  | "antonym"     // 対義語を選ぶ
  | "cloze"       // 例文の穴埋め
  | "paraphrase"; // 同じ意図の別の言い方を選ぶ

export interface User {
  id: number;
  email: string;
  displayName: string;
  exam: ExamType;
  levelId: string;
  /** FSRS の目標保持率 (0.7〜0.97) */
  desiredRetention: number;
  timezone: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Relation {
  type: RelationType;
  lemma: string;
  /** DB 内に単語がある場合の ID */
  wordId: number | null;
  /** ニュアンスの違いなどのメモ */
  note: string | null;
}

export interface Example {
  en: string;
  ja: string | null;
}

export interface Word {
  id: number;
  lemma: string;
  pos: string;
  cefr: Cefr;
  meaningJa: string;
  definitionEn: string | null;
  ipa: string | null;
  examples: Example[];
  synonyms: Relation[];
  antonyms: Relation[];
  source: string;
}

export interface Expression {
  id: number;
  text: string;
  register: Register;
  note: string | null;
  example: string | null;
}

/** 同じ意図を表す「いろんな言い方」のグループ */
export interface ExpressionGroup {
  id: number;
  intentJa: string;
  intentEn: string;
  scene: string;
  cefr: Cefr;
  expressions: Expression[];
}

export interface Card {
  id: number;
  itemType: ItemType;
  itemId: number;
  /** 表示用の見出し（単語なら lemma、表現なら意図） */
  headline: string;
  state: CardState;
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
  /** 現在の想起確率 (0〜1)。未学習なら null */
  retrievability: number | null;
  source: CardSource;
}

export interface QuizChoice {
  text: string;
  /** 補足（類義語のニュアンス、レジスターなど） */
  hint?: string;
}

export interface QuizQuestion {
  /** 回答時に POST /reviews へ渡す */
  cardId: number;
  mode: QuizMode;
  /** 問題文（例: 単語、意味、穴埋め例文） */
  prompt: string;
  /** 問題の補足説明 */
  instruction: string;
  /** flashcard モードでは空 */
  choices: QuizChoice[];
  /** 正解のインデックス（flashcard は -1）。オフライン採点できるようクライアントに渡す */
  answerIndex: number;
  /** 回答後に見せる解説 */
  explanation: string;
  word?: Word;
  group?: ExpressionGroup;
}

export interface StudySession {
  questions: QuizQuestion[];
  dueCount: number;
  newCount: number;
}

export interface ReviewRequest {
  cardId: number;
  /** 自己評価（flashcard）。quiz の場合は correct から自動算出してもよい */
  grade?: Grade;
  correct?: boolean;
  mode: QuizMode;
  durationMs?: number;
  /** クライアントで回答した時刻（オフライン同期用） */
  reviewedAt?: string;
  /** 冪等キー: 同じ ID の二重送信は無視される（iOS のオフライン再送用） */
  clientReviewId?: string;
}

export interface ReviewResult {
  card: Card;
  grade: Grade;
  /** 次回までの日数 */
  intervalDays: number;
  duplicate: boolean;
}

export interface DailyTask {
  key: "review" | "new" | "synonym" | "antonym" | "paraphrase" | "output" | "cambly";
  title: string;
  description: string;
  target: number;
  done: number;
  /** 学習画面へ渡すクイズモード */
  modes: QuizMode[];
}

export interface DailyTasks {
  date: string;
  levelId: string;
  levelLabel: string;
  tasks: DailyTask[];
  outputPrompt: string;
}

export interface CurvePoint {
  day: number;
  retention: number;
}

export interface Stats {
  totalCards: number;
  byState: Record<CardState, number>;
  reviewsToday: number;
  streakDays: number;
  /** 直近30日の正答率（Again 以外の割合） */
  recentAccuracy: number | null;
  /** 保持カードの平均想起確率 */
  averageRetrievability: number | null;
  /** 今後14日の復習予定数 */
  forecast: { date: string; count: number }[];
  /** 日別のレビュー数（過去30日） */
  history: { date: string; count: number; correct: number }[];
  /** ユーザーの平均的なカードの忘却曲線（安定度の中央値から計算） */
  forgettingCurve: { stabilityDays: number; points: CurvePoint[] } | null;
  /** CEFR 別の習得語数（state=review かつ安定度 21 日以上を「定着」とみなす） */
  masteredByCefr: Record<Cefr, number>;
}

export interface CamblyLesson {
  id: number;
  lessonDate: string;
  tutor: string | null;
  topic: string | null;
  notes: string | null;
  createdAt: string;
  targets: LessonTarget[];
}

export interface LessonTarget {
  cardId: number;
  headline: string;
  itemType: ItemType;
  /** レッスン中に実際に使えたか */
  used: boolean;
}

export interface CorrectionPair {
  original: string;
  better: string;
}

export interface TranscriptAnalysis {
  /** DB に存在し、カード化できる単語 */
  knownWords: { wordId: number; lemma: string; cefr: Cefr; hasCard: boolean }[];
  /** DB に存在する表現 */
  expressions: { groupId: number; text: string; intentJa: string; hasCard: boolean }[];
  /** 講師の訂正と思われる行 */
  corrections: CorrectionPair[];
  /** DB にない、学習候補になりそうな語 */
  unknownCandidates: string[];
}
