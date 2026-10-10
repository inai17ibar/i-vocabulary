/**
 * レベル体系。内部的には CEFR を共通の物差しにし、英検・IELTS をそれにマッピングする。
 * 英検の CEFR 対応は日本英語検定協会の公表値、IELTS は British Council / IDP の公表対応表に準拠。
 */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

export type ExamType = "eiken" | "ielts";

export interface TaskPlan {
  /** 1日に新しく導入する単語数 */
  newWords: number;
  /** 新しく導入する「いろんな言い方」グループ数 */
  newExpressions: number;
  /** 類義語ドリルの問題数 */
  synonymDrill: number;
  /** 対義語ドリルの問題数 */
  antonymDrill: number;
  /** 言い換えドリルの問題数 */
  paraphraseDrill: number;
}

export interface LevelDef {
  id: string;
  exam: ExamType;
  label: string;
  /** 目安となる CEFR */
  cefr: Cefr;
  /** 新出語を出題する CEFR 帯（下のレベルの取りこぼしも拾う） */
  vocabBands: Cefr[];
  /** 目安の語彙サイズ（参考値） */
  vocabSize: string;
  plan: TaskPlan;
  /** アウトプット課題（英会話/スピーキング/英作文向け） */
  outputPrompts: string[];
}

const EIKEN_PROMPTS_BASIC = [
  "What do you usually do on weekends?",
  "Tell me about your favorite food.",
  "What did you do yesterday?",
  "Describe your best friend.",
];
const EIKEN_PROMPTS_MID = [
  "Do you think students should study abroad? Why or why not?",
  "Should people use public transportation more often?",
  "What are the good points of living in a big city?",
  "Do you think more people will work from home in the future?",
];
const EIKEN_PROMPTS_HIGH = [
  "Agree or disagree: Japan should accept more foreign workers.",
  "Should governments do more to reduce food waste?",
  "Is technology making people less social?",
  "Should companies be required to offer flexible working hours?",
];
const IELTS_PART1 = [
  "Part 1: Do you work or are you a student? What do you like about it?",
  "Part 1: How do you usually spend your free time?",
  "Part 1: Do you prefer living in a house or an apartment?",
];
const IELTS_PART2 = [
  "Part 2: Describe a skill you learned that took a long time. You should say what it was, how you learned it, and why it was difficult.",
  "Part 2: Describe a place you visited that was more crowded than you expected.",
  "Part 2: Describe a piece of advice that changed your opinion.",
];
const IELTS_PART3 = [
  "Part 3: How has technology changed the way people communicate?",
  "Part 3: Should governments invest more in public transport or roads? Why?",
  "Part 3: What are the long-term effects of tourism on local communities?",
];

export const LEVELS: LevelDef[] = [
  {
    id: "eiken-5", exam: "eiken", label: "英検5級", cefr: "A1", vocabBands: ["A1"], vocabSize: "~600語",
    plan: { newWords: 5, newExpressions: 1, synonymDrill: 2, antonymDrill: 3, paraphraseDrill: 2 },
    outputPrompts: EIKEN_PROMPTS_BASIC,
  },
  {
    id: "eiken-4", exam: "eiken", label: "英検4級", cefr: "A1", vocabBands: ["A1"], vocabSize: "~1,300語",
    plan: { newWords: 6, newExpressions: 1, synonymDrill: 2, antonymDrill: 3, paraphraseDrill: 2 },
    outputPrompts: EIKEN_PROMPTS_BASIC,
  },
  {
    id: "eiken-3", exam: "eiken", label: "英検3級", cefr: "A1", vocabBands: ["A1", "A2"], vocabSize: "~2,100語",
    plan: { newWords: 8, newExpressions: 2, synonymDrill: 3, antonymDrill: 3, paraphraseDrill: 3 },
    outputPrompts: EIKEN_PROMPTS_BASIC,
  },
  {
    id: "eiken-p2", exam: "eiken", label: "英検準2級", cefr: "A2", vocabBands: ["A2", "B1"], vocabSize: "~3,600語",
    plan: { newWords: 10, newExpressions: 2, synonymDrill: 4, antonymDrill: 3, paraphraseDrill: 4 },
    outputPrompts: EIKEN_PROMPTS_MID,
  },
  {
    id: "eiken-p2plus", exam: "eiken", label: "英検準2級プラス", cefr: "B1", vocabBands: ["A2", "B1"], vocabSize: "~4,000語",
    plan: { newWords: 10, newExpressions: 2, synonymDrill: 4, antonymDrill: 4, paraphraseDrill: 4 },
    outputPrompts: EIKEN_PROMPTS_MID,
  },
  {
    id: "eiken-2", exam: "eiken", label: "英検2級", cefr: "B1", vocabBands: ["B1", "B2"], vocabSize: "~5,100語",
    plan: { newWords: 12, newExpressions: 3, synonymDrill: 5, antonymDrill: 4, paraphraseDrill: 5 },
    outputPrompts: EIKEN_PROMPTS_MID,
  },
  {
    id: "eiken-p1", exam: "eiken", label: "英検準1級", cefr: "B2", vocabBands: ["B2", "C1"], vocabSize: "~7,500語",
    plan: { newWords: 15, newExpressions: 3, synonymDrill: 6, antonymDrill: 4, paraphraseDrill: 6 },
    outputPrompts: EIKEN_PROMPTS_HIGH,
  },
  {
    id: "eiken-1", exam: "eiken", label: "英検1級", cefr: "C1", vocabBands: ["C1", "C2"], vocabSize: "~10,000語+",
    plan: { newWords: 15, newExpressions: 3, synonymDrill: 8, antonymDrill: 4, paraphraseDrill: 6 },
    outputPrompts: EIKEN_PROMPTS_HIGH,
  },
  // IELTS は Lexical Resource（言い換え力）が採点基準なので paraphrase / synonym を厚めにする
  {
    id: "ielts-4", exam: "ielts", label: "IELTS 4.0–5.0", cefr: "B1", vocabBands: ["A2", "B1"], vocabSize: "~3,500語",
    plan: { newWords: 10, newExpressions: 3, synonymDrill: 5, antonymDrill: 3, paraphraseDrill: 6 },
    outputPrompts: [...IELTS_PART1, ...IELTS_PART2],
  },
  {
    id: "ielts-5.5", exam: "ielts", label: "IELTS 5.5–6.5", cefr: "B2", vocabBands: ["B1", "B2"], vocabSize: "~5,500語",
    plan: { newWords: 12, newExpressions: 3, synonymDrill: 6, antonymDrill: 4, paraphraseDrill: 8 },
    outputPrompts: [...IELTS_PART2, ...IELTS_PART3],
  },
  {
    id: "ielts-7", exam: "ielts", label: "IELTS 7.0–8.0", cefr: "C1", vocabBands: ["B2", "C1"], vocabSize: "~8,000語",
    plan: { newWords: 15, newExpressions: 4, synonymDrill: 8, antonymDrill: 4, paraphraseDrill: 10 },
    outputPrompts: IELTS_PART3,
  },
  {
    id: "ielts-8.5", exam: "ielts", label: "IELTS 8.5–9.0", cefr: "C2", vocabBands: ["C1", "C2"], vocabSize: "~10,000語+",
    plan: { newWords: 15, newExpressions: 4, synonymDrill: 8, antonymDrill: 5, paraphraseDrill: 10 },
    outputPrompts: IELTS_PART3,
  },
];

export const DEFAULT_LEVEL_ID = "eiken-2";

export function getLevel(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL_ID)!;
}

export function cefrIndex(c: Cefr): number {
  return CEFR_LEVELS.indexOf(c);
}

export function isCefr(v: unknown): v is Cefr {
  return typeof v === "string" && (CEFR_LEVELS as readonly string[]).includes(v);
}

/** CEFR から英検・IELTS の目安ラベルを返す（単語カードの表示用） */
export function examLabelsForCefr(c: Cefr): { eiken: string; ielts: string } {
  const eiken: Record<Cefr, string> = {
    A1: "5級〜3級", A2: "準2級", B1: "2級", B2: "準1級", C1: "1級", C2: "1級+",
  };
  const ielts: Record<Cefr, string> = {
    A1: "—", A2: "3.0–3.5", B1: "4.0–5.0", B2: "5.5–6.5", C1: "7.0–8.0", C2: "8.5–9.0",
  };
  return { eiken: eiken[c], ielts: ielts[c] };
}
