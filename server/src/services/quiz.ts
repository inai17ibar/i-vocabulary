import type { ExpressionGroup, QuizChoice, QuizMode, QuizQuestion, Word } from "@ivocab/shared";
import type { DB } from "../db.ts";
import type { CardRow } from "./srs.ts";
import { getExpressionGroup, getWord } from "./vocab.ts";
import { makeCloze } from "./text.ts";

/** 乱数源（テストで差し替え可能） */
export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 正解 + 誤答から選択肢を作る */
function buildChoices(correct: QuizChoice, distractors: QuizChoice[], rng: Rng): { choices: QuizChoice[]; answerIndex: number } {
  const seen = new Set([correct.text.toLowerCase()]);
  const uniq: QuizChoice[] = [];
  for (const d of distractors) {
    const k = d.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(d);
    if (uniq.length === 3) break;
  }
  const choices = shuffle([correct, ...uniq], rng);
  return { choices, answerIndex: choices.indexOf(correct) };
}

/** 誤答候補: 同じ品詞・近い CEFR の単語（除外リスト以外） */
function distractorLemmas(db: DB, word: Word, exclude: string[], n: number, rng: Rng): string[] {
  const ex = new Set([word.lemma, ...exclude].map((s) => s.toLowerCase()));
  const rows = db.prepare(
    `SELECT lemma FROM words WHERE pos = ? AND id <> ? AND created_by IS NULL
     ORDER BY ABS((CASE cefr WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END)
                - (CASE ? WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END)), RANDOM()
     LIMIT 40`,
  ).all(word.pos, word.id, word.cefr) as { lemma: string }[];
  const pool = shuffle(rows.map((r) => r.lemma).filter((l) => !ex.has(l.toLowerCase())), rng);
  return pool.slice(0, n);
}

function wordExplanation(w: Word): string {
  const parts = [`${w.lemma} (${w.pos}) = ${w.meaningJa || w.definitionEn || ""}`];
  if (w.synonyms.length) parts.push(`類義語: ${w.synonyms.map((s) => (s.note ? `${s.lemma}（${s.note}）` : s.lemma)).join(", ")}`);
  if (w.antonyms.length) parts.push(`対義語: ${w.antonyms.map((a) => a.lemma).join(", ")}`);
  if (w.examples[0]) parts.push(`例: ${w.examples[0].en}${w.examples[0].ja ? ` — ${w.examples[0].ja}` : ""}`);
  return parts.join("\n");
}

export function flashcardQuestion(cardId: number, w: Word): QuizQuestion {
  return {
    cardId,
    mode: "flashcard",
    prompt: w.lemma,
    instruction: "意味を思い出してから答えを表示し、どれくらい覚えていたかを評価してください",
    choices: [],
    answerIndex: -1,
    explanation: wordExplanation(w),
    word: w,
  };
}

export function meaningQuestion(db: DB, cardId: number, w: Word, rng: Rng): QuizQuestion | null {
  const meaning = w.meaningJa || w.definitionEn;
  if (!meaning) return null;
  const distractors = distractorLemmas(db, w, w.synonyms.map((s) => s.lemma), 6, rng);
  if (distractors.length < 2) return null;
  const { choices, answerIndex } = buildChoices({ text: w.lemma }, distractors.map((text) => ({ text })), rng);
  return {
    cardId, mode: "meaning", prompt: meaning, instruction: "この意味の英単語はどれ？", choices, answerIndex, explanation: wordExplanation(w), word: w,
  };
}

export function relationQuestion(db: DB, cardId: number, w: Word, type: "synonym" | "antonym", rng: Rng): QuizQuestion | null {
  const targets = type === "synonym" ? w.synonyms : w.antonyms;
  const opposite = type === "synonym" ? w.antonyms : w.synonyms;
  // 複数語のフレーズより単語の方が選択肢として公平
  const singles = targets.filter((t) => !t.lemma.includes(" "));
  const correctRel = pick(singles.length ? singles : targets, rng);
  if (!correctRel) return null;
  // 紛らわしい誤答として「逆の関係の語」を 1 つ混ぜる（類義語問題なら対義語）
  const tricky = opposite.length ? [pick(opposite, rng).lemma] : [];
  const others = distractorLemmas(db, w, targets.map((t) => t.lemma), 6, rng);
  const distractors = [...tricky, ...others];
  if (distractors.length < 2) return null;
  const { choices, answerIndex } = buildChoices(
    { text: correctRel.lemma, hint: correctRel.note ?? undefined },
    distractors.map((text) => ({ text })),
    rng,
  );
  return {
    cardId,
    mode: type,
    prompt: w.lemma,
    instruction: type === "synonym" ? `「${w.lemma}」に意味が近い語（類義語）はどれ？` : `「${w.lemma}」の反対の意味の語（対義語）はどれ？`,
    choices,
    answerIndex,
    explanation: wordExplanation(w),
    word: w,
  };
}

/** リスニング: 発音を聞いて単語を選ぶ。綴りが似た語を誤答にして「音と綴り」の結びつきを鍛える */
export function listeningQuestion(db: DB, cardId: number, w: Word, rng: Rng): QuizQuestion | null {
  if (w.lemma.includes(" ")) return null;
  const similar = (
    db.prepare("SELECT lemma FROM words WHERE id <> ? AND created_by IS NULL AND lemma NOT LIKE '% %' AND (substr(lemma, 1, 2) = substr(?, 1, 2) OR substr(lemma, -3) = substr(?, -3)) LIMIT 10").all(w.id, w.lemma, w.lemma) as { lemma: string }[]
  ).map((r) => r.lemma);
  const distractors = [...shuffle(similar, rng), ...distractorLemmas(db, w, [], 6, rng)];
  if (distractors.length < 2) return null;
  const { choices, answerIndex } = buildChoices({ text: w.lemma }, distractors.map((text) => ({ text })), rng);
  return {
    cardId,
    mode: "listening",
    prompt: w.lemma,
    instruction: "音声を聞いて、聞こえた単語を選んでください",
    choices,
    answerIndex,
    explanation: wordExplanation(w) + (w.ipa ? `\n発音記号: ${w.ipa}` : ""),
    word: w,
  };
}

export function clozeQuestion(db: DB, cardId: number, w: Word, rng: Rng): QuizQuestion | null {
  for (const ex of shuffle(w.examples, rng)) {
    const cloze = makeCloze(ex.en, w.lemma);
    if (!cloze) continue;
    const distractors = distractorLemmas(db, w, w.synonyms.map((s) => s.lemma), 6, rng);
    if (distractors.length < 2) return null;
    const { choices, answerIndex } = buildChoices({ text: w.lemma }, distractors.map((text) => ({ text })), rng);
    return {
      cardId,
      mode: "cloze",
      prompt: cloze,
      instruction: `空欄に入る語は？（原形で表示）${ex.ja ? `\nヒント: ${ex.ja}` : ""}`,
      choices,
      answerIndex,
      explanation: `${ex.en}\n${wordExplanation(w)}`,
      word: w,
    };
  }
  return null;
}

const REGISTER_JA = { casual: "カジュアル", neutral: "標準", formal: "丁寧・フォーマル" } as const;

/**
 * 「いろんな言い方」問題。
 * パターン1: 表現 A と同じ意図の別の言い方を選ぶ
 * パターン2: よりフォーマル／カジュアルな言い方を選ぶ（レジスターの使い分け）
 */
export function paraphraseQuestion(db: DB, cardId: number, g: ExpressionGroup, rng: Rng): QuizQuestion | null {
  if (g.expressions.length < 2) return null;
  const otherGroupExprs = (
    db.prepare("SELECT text FROM expressions WHERE group_id <> ? ORDER BY RANDOM() LIMIT 12").all(g.id) as { text: string }[]
  ).map((r) => ({ text: r.text }));
  const explanation = `${g.intentJa}（${g.intentEn}）\n` + g.expressions.map((e) => `・${e.text} [${REGISTER_JA[e.register]}]${e.note ? ` — ${e.note}` : ""}`).join("\n");

  const formal = g.expressions.filter((e) => e.register === "formal");
  const casual = g.expressions.filter((e) => e.register === "casual");
  if (formal.length && casual.length && rng() < 0.35) {
    const wantFormal = rng() < 0.5;
    const correct = pick(wantFormal ? formal : casual, rng);
    const wrong = g.expressions.filter((e) => e.register !== correct.register).map((e) => ({ text: e.text, hint: REGISTER_JA[e.register] }));
    const { choices, answerIndex } = buildChoices({ text: correct.text, hint: REGISTER_JA[correct.register] }, shuffle(wrong, rng), rng);
    if (choices.length < 2) return null;
    return {
      cardId,
      mode: "paraphrase",
      prompt: g.intentJa,
      instruction: wantFormal ? "最も丁寧・フォーマルな言い方はどれ？（上司・試験官・初対面向け）" : "最もカジュアルな言い方はどれ？（友達・同僚向け）",
      choices,
      answerIndex,
      explanation,
      group: g,
    };
  }

  const [shown, correct] = shuffle(g.expressions, rng);
  const { choices, answerIndex } = buildChoices({ text: correct.text, hint: correct.note ?? undefined }, shuffle(otherGroupExprs, rng), rng);
  if (choices.length < 2) return null;
  return {
    cardId,
    mode: "paraphrase",
    prompt: `"${shown.text}"`,
    instruction: `「${g.intentJa}」— 同じ意図の別の言い方はどれ？`,
    choices,
    answerIndex,
    explanation,
    group: g,
  };
}

/** カードと希望モードから問題を作る。作れないモードは他のモードにフォールバック */
export function questionForCard(db: DB, card: CardRow, preferred: QuizMode[], rng: Rng = Math.random): QuizQuestion | null {
  if (card.item_type === "expression") {
    const g = getExpressionGroup(db, card.item_id);
    return g ? paraphraseQuestion(db, card.id, g, rng) : null;
  }
  const w = getWord(db, card.item_id);
  if (!w) return null;
  const order: QuizMode[] = [...preferred, "meaning", "flashcard"];
  for (const mode of order) {
    let q: QuizQuestion | null = null;
    if (mode === "flashcard") q = flashcardQuestion(card.id, w);
    else if (mode === "meaning") q = meaningQuestion(db, card.id, w, rng);
    else if (mode === "synonym" || mode === "antonym") q = relationQuestion(db, card.id, w, mode, rng);
    else if (mode === "cloze") q = clozeQuestion(db, card.id, w, rng);
    else if (mode === "listening") q = listeningQuestion(db, card.id, w, rng);
    if (q) return q;
  }
  return null;
}

/**
 * 復習カードのモード選択。学習初期は認識（意味→単語）、定着してきたら
 * 文脈（穴埋め）や関係語（類義・対義）で「使える語彙」へ広げる。
 */
export function reviewModesFor(card: CardRow, rng: Rng = Math.random): QuizMode[] {
  if (card.state <= 1 || card.stability < 3) return shuffle<QuizMode>(["flashcard", "meaning", "listening"], rng);
  if (card.stability < 14) return shuffle<QuizMode>(["meaning", "cloze", "synonym", "listening"], rng);
  return shuffle<QuizMode>(["cloze", "synonym", "antonym", "flashcard", "listening"], rng);
}

/** 新出の表現グループを「覚える」ためのカード（自己評価） */
export function expressionFlashcard(cardId: number, g: ExpressionGroup): QuizQuestion {
  return {
    cardId,
    mode: "flashcard",
    prompt: g.intentJa,
    instruction: `英語でいくつ言えますか？（${g.intentEn}）思い浮かべてから答えを表示`,
    choices: [],
    answerIndex: -1,
    explanation: g.expressions.map((e) => `・${e.text} [${REGISTER_JA[e.register]}]${e.note ? ` — ${e.note}` : ""}`).join("\n"),
    group: g,
  };
}
