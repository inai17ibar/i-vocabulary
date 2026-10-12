import type { Cefr, Example, WordTag } from "@ivocab/shared";
import { isCefr } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";
import { cefrFromRank, parseCsv } from "./importers.ts";
import { inflections } from "./text.ts";
import { normalizePos, upsertWord } from "./vocab.ts";

/**
 * 公開語彙リスト（出典は shared/src/sources.ts）を合成して取り込む。
 *  - 単語と CEFR: CEFR-J Wordlist（A1–B2）+ Octanove Vocabulary Profile（C1–C2）
 *  - 頻度順位: NGSL / 目印: NGSL-Spoken（spoken）・NAWL（academic）
 *  - 日本語訳: EJDict-hand / 例文: Tatoeba の日英対訳
 * 英検・IELTS の公式教材や市販単語帳は著作物なので使わない。レベルは CEFR を介して英検・IELTS に対応づける。
 */

/** 単語カードにしない品詞（冠詞・代名詞・助動詞・数詞など。意味を覚える対象ではない） */
const SKIP_POS = new Set(["det", "pron", "aux", "num", "infinitive-to", "other"]);
/** CEFR-J / Octanove にない NGSL の語のうち、単語カードにしない語（法助動詞など） */
const SKIP_LEMMAS = new Set(["ought", "shall", "okay", "ok"]);
/** 学術語だけのリスト（NAWL）にあって CEFR-J / Octanove にない語のレベル */
const ACADEMIC_ONLY_CEFR: Cefr = "C1";

export interface OpenWord {
  lemma: string;
  pos: string;
  cefr: Cefr;
  frequencyRank: number | null;
  tags: WordTag[];
  source: "cefr-j" | "octanove" | "ngsl" | "nawl";
}

export interface OpenWordlistFiles {
  cefrj: string;
  octanove: string;
  ngsl: string;
  ngslSpoken: string;
  nawl: string;
}

/** "a.m./A.M./am/AM" のような表記ゆれの見出しは先頭を採る */
const headwordOf = (raw: string) => raw.split("/")[0].trim();

/** 各リストを合成する。同じ (lemma, pos) は低いほうの CEFR を採る */
export function mergeWordlists(files: OpenWordlistFiles): OpenWord[] {
  const ngslRank = new Map<string, number>();
  for (const r of parseCsv(files.ngsl)) {
    const rank = Number(r["sfi rank"] ?? r.rank);
    if (r.lemma && Number.isFinite(rank)) ngslRank.set(r.lemma.toLowerCase(), rank);
  }
  const spoken = new Set(parseCsv(files.ngslSpoken).map((r) => r.lemma?.toLowerCase()).filter(Boolean));
  // NAWL の教育用リストはヘッダーなしで「見出し語,活用形…」
  const academic = new Set(files.nawl.split(/\r?\n/).map((l) => l.split(",")[0].trim().toLowerCase()).filter(Boolean));

  const byKey = new Map<string, OpenWord>();
  /** 機能語として除外した語（NGSL 側から名詞などとして入り直さないように） */
  const skipped = new Set<string>();
  const tagsFor = (lemma: string): WordTag[] => {
    const l = lemma.toLowerCase();
    return [...(spoken.has(l) ? ["spoken" as const] : []), ...(academic.has(l) ? ["academic" as const] : [])];
  };
  const add = (lemma: string, pos: string, cefr: Cefr, source: OpenWord["source"]) => {
    const key = `${lemma.toLowerCase()}\t${pos}`;
    const prev = byKey.get(key);
    if (prev && prev.cefr <= cefr) return;
    byKey.set(key, { lemma, pos, cefr, frequencyRank: ngslRank.get(lemma.toLowerCase()) ?? null, tags: tagsFor(lemma), source: prev?.source ?? source });
  };

  for (const [text, source] of [[files.cefrj, "cefr-j"], [files.octanove, "octanove"]] as const) {
    for (const r of parseCsv(text)) {
      const lemma = headwordOf(r.headword ?? "");
      const pos = normalizePos(r.pos);
      const cefr = (r.cefr ?? "").toUpperCase();
      if (!lemma || !isCefr(cefr)) continue;
      if (SKIP_POS.has(pos)) {
        skipped.add(lemma.toLowerCase());
        continue;
      }
      add(lemma, pos, cefr, source);
    }
  }
  const known = new Set([...byKey.values()].map((w) => w.lemma.toLowerCase()));
  // CEFR-J / Octanove にない高頻度語・学術語。品詞は日本語訳から推定するので空にしておく
  for (const [lemma, rank] of ngslRank) {
    if (!known.has(lemma) && !skipped.has(lemma) && !SKIP_LEMMAS.has(lemma)) add(lemma, "", cefrFromRank(rank), "ngsl");
  }
  for (const lemma of academic) {
    if (!known.has(lemma) && !skipped.has(lemma) && !ngslRank.has(lemma)) add(lemma, "", ACADEMIC_ONLY_CEFR, "nawl");
  }
  return [...byKey.values()];
}

/* ------------------------------------------------------------------ */
/* 日本語訳（EJDict-hand）                                              */
/* ------------------------------------------------------------------ */

/** EJDict の「見出し語<TAB>訳」の行を引ける形にする（表記ゆれ "colour,color" はそれぞれで引ける） */
export function parseEjdict(text: string): Map<string, string> {
  const dict = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const meaning = line.slice(tab + 1).trim();
    for (const head of line.slice(0, tab).split(",")) {
      const k = head.trim().toLowerCase();
      if (k && !dict.has(k)) dict.set(k, meaning);
    }
  }
  return dict;
}

type SenseClass = "noun" | "verb" | "adj" | "adv";

/** 訳語 1 つ（"走る"、"利用できる" など） */
interface Term {
  text: string;
  /** 『』で囲まれた主要な訳 */
  primary: boolean;
  classes: Set<SenseClass>;
}

/** 訳語の語尾から品詞の候補を推定する（EJDict は語義に品詞を付けていないため） */
function classify(text: string, nounMarked: boolean): Set<SenseClass> {
  const c = new Set<SenseClass>();
  if (nounMarked) c.add("noun");
  // 「利用できる」「信じられる」は形は動詞だが形容詞の訳にもなる
  else if (/(できる|られる|れる)$/.test(text)) { c.add("adj"); c.add("verb"); }
  else if (/(ている|でいる|である|ある|な|の|的|た|しい)$/.test(text)) c.add("adj");
  else if (/い$/.test(text)) { c.add("adj"); c.add("noun"); }
  else if (/[るうすつぬむぶぐ]$/.test(text)) c.add("verb");
  else if (/く$/.test(text)) { c.add("verb"); c.add("adv"); }
  else if (/[にてと]$/.test(text)) c.add("adv");
  else c.add("noun");
  return c;
}

/** 語義 1 つ（" / " 区切りの 1 区画）を訳語に分ける */
function parseTerms(raw: string): Term[] {
  const nounMarked = /〈[UC]〉|《(the|a|an)[~～]/.test(raw);
  const body = raw
    .replace(/《[^》]*》/g, "")
    .replace(/〈[^〉]*〉/g, "")
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/\{[^}]*\}|\[[^\]]*\]/g, "")
    .replace(/[^()（）]*[)）]/g, "") // 閉じ括弧だけ残った注記（")ある場所…に)"）は注記ごと消す
    .replace(/[()（）]/g, "")
    .split(/[;；]/)[0];
  // 『光,光線』のように『』の中が「,」で区切られていることがあるので、括弧の内外を追いながら分ける
  let inside = false;
  return body.split(/[,、，]/).flatMap((piece) => {
    const primary = inside || piece.includes("『");
    inside = (inside || piece.includes("『")) && !piece.includes("』");
    const text = piece.replace(/[『』]/g, "").replace(/\s+/g, "").replace(/^[、。=＝]+|[、。…]+$/g, "");
    return text && text !== "…" ? [{ text, primary, classes: classify(text, nounMarked) }] : [];
  });
}

const MEANING_MAX_LEN = 28;

/**
 * 品詞に合う訳語を、主要なもの（『』）から 3 つまで選んで「、」でつなぐ。
 * 合う訳語がない（推定が外れた）ときは品詞を問わず先頭から使う
 */
export function pickMeaningJa(raw: string, pos: string): string {
  const all = raw.split(/\s*\/\s*/).flatMap(parseTerms);
  // 英字が続く訳語（"antemeridiem"、"CocaColaの略称"）は日本語訳として使いにくいので、他に候補があれば外す
  const japanese = all.filter((t) => !/[A-Za-z]{3,}/.test(t.text));
  const terms = japanese.length ? japanese : all;
  if (!terms.length) return "";
  const target = (["noun", "verb", "adj", "adv"] as string[]).includes(pos) ? (pos as SenseClass) : null;
  const matching = target ? terms.filter((t) => t.classes.has(target)) : terms;
  const pool = matching.length ? matching : terms;
  // 主要な訳語（『』）を先に、それぞれ辞書の掲載順で
  const ordered = [...pool.filter((t) => t.primary), ...pool.filter((t) => !t.primary)];
  const picked: string[] = [];
  for (const { text } of ordered) {
    if (picked.includes(text)) continue;
    if (picked.length >= 3 || (picked.length && [...picked, text].join("、").length > MEANING_MAX_LEN)) break;
    picked.push(text);
  }
  return picked.join("、");
}

/** 品詞が不明な語（NGSL / NAWL だけにある語）の品詞を、主要な語義から推定する */
export function guessPos(raw: string): string {
  const terms = raw.split(/\s*\/\s*/).flatMap(parseTerms);
  const first = terms.find((t) => t.primary) ?? terms[0];
  if (!first) return "noun";
  return [...first.classes][0] ?? "noun";
}

/* ------------------------------------------------------------------ */
/* 例文（Tatoeba の日英対訳）                                           */
/* ------------------------------------------------------------------ */

interface SentencePair { en: string; ja: string; attribution: string; words: number }

export class ExampleIndex {
  private pairs: SentencePair[] = [];
  private byToken = new Map<string, number[]>();

  /**
   * manythings.org の jpn.txt（"英文<TAB>和文<TAB>CC-BY 2.0 (France) Attribution: tatoeba.org #1 (user) & #2 (user)"）を読む
   */
  static fromManythings(text: string): ExampleIndex {
    const idx = new ExampleIndex();
    const seen = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      const [en, ja, license] = line.split("\t");
      if (!en || !ja || seen.has(en)) continue;
      seen.add(en);
      const m = license?.match(/tatoeba\.org (#\d+ \([^)]*\)(?: & #\d+ \([^)]*\))?)/);
      const tokens = en.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
      const i = idx.pairs.push({ en, ja, attribution: `Tatoeba ${m ? m[1] : ""}`.trim(), words: tokens.length }) - 1;
      for (const t of new Set(tokens)) {
        const list = idx.byToken.get(t);
        if (list) list.push(i);
        else idx.byToken.set(t, [i]);
      }
    }
    return idx;
  }

  get size() { return this.pairs.length; }

  /** 見出し語（またはその活用形）を含む、短すぎず長すぎない文を選ぶ */
  find(lemma: string, pos: string, limit = 2): Example[] {
    const l = lemma.toLowerCase();
    let ids: number[];
    if (l.includes(" ")) {
      const re = new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      ids = (this.byToken.get(l.split(" ")[0]) ?? []).filter((i) => re.test(this.pairs[i].en.toLowerCase()));
    } else {
      // -ly / -er / -est は別の語になりやすい（friend → friendly）ので形容詞・副詞以外では使わない
      const forms = inflections(l).filter((f) => pos === "adj" || pos === "adv" || !/(ly|er|est)$/.test(f) || f === l);
      ids = [...new Set(forms.flatMap((f) => this.byToken.get(f) ?? []))];
    }
    const score = (i: number) => usageScore(this.pairs[i].en, l, pos);
    return ids
      .filter((i) => this.pairs[i].words >= 4 && this.pairs[i].words <= 14)
      .map((i) => ({ i, s: score(i) }))
      // 品詞に合った使われ方の文を優先し、同点なら 8 語前後の文
      .sort((a, b) => b.s - a.s || Math.abs(this.pairs[a.i].words - 8) - Math.abs(this.pairs[b.i].words - 8) || a.i - b.i)
      .slice(0, limit)
      .map(({ i }) => i)
      .map((i) => ({ en: this.pairs[i].en, ja: this.pairs[i].ja, attribution: this.pairs[i].attribution }));
  }
}

const DETERMINERS = /\b(a|an|the|my|your|his|her|its|our|their|this|that|these|those|some|any|no|every)\s+$/;
const VERB_LEAD = /\b(to|will|would|can|could|should|must|might|may|did|do|does|don't|didn't|doesn't|won't|can't|i|you|we|they|please|let's)\s+$/;
const ADJ_LEAD = /\b(is|are|was|were|be|been|very|so|too|quite|really|more|most|look|looks|looked|feel|feels|felt|seem|seems|seemed)\s+$/;

/**
 * 文中での見出し語の使われ方が品詞に合っていそうか（簡易判定）。
 * light（名詞・形容詞・動詞）のような語に、別の品詞の用法の例文を付けないため
 */
export function usageScore(sentence: string, lemma: string, pos: string): number {
  const s = sentence.toLowerCase();
  if (lemma.includes(" ")) return 0;
  const m = new RegExp(`\\b(${inflections(lemma).map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`).exec(s);
  if (!m) return 0;
  const before = s.slice(0, m.index);
  const form = m[1];
  const inflected = form !== lemma;
  switch (pos) {
    case "noun": return DETERMINERS.test(before) ? 2 : VERB_LEAD.test(before) ? -1 : 0;
    case "verb": return VERB_LEAD.test(before) || (inflected && /(ed|ing)$/.test(form)) ? 2 : DETERMINERS.test(before) ? -1 : 0;
    case "adj": return ADJ_LEAD.test(before) ? 2 : DETERMINERS.test(before) && !inflected ? 1 : 0;
    case "adv": return inflected ? -1 : 0;
    default: return 0;
  }
}

/* ------------------------------------------------------------------ */
/* 取り込み                                                             */
/* ------------------------------------------------------------------ */

export interface OpenImportResult {
  words: number;
  added: number;
  withMeaning: number;
  withExamples: number;
  bySource: Record<string, number>;
  byCefr: Record<string, number>;
}

/**
 * 合成した語を DB に入れる。既存語（同梱の厳選データなど）の訳・例文・レベルは上書きせず、
 * 空のところだけ埋めて目印と頻度順位を足す
 */
export function importOpenWordlist(db: DB, words: OpenWord[], dict: Map<string, string>, examples: ExampleIndex | null): OpenImportResult {
  const result: OpenImportResult = { words: 0, added: 0, withMeaning: 0, withExamples: 0, bySource: {}, byCefr: {} };
  const findExisting = db.prepare("SELECT id, meaning_ja, (SELECT COUNT(*) FROM examples e WHERE e.word_id = words.id) AS n FROM words WHERE lemma = ? AND pos = ? AND created_by IS NULL");
  tx(db, () => {
    for (const w of words) {
      const raw = dict.get(w.lemma.toLowerCase()) ?? "";
      const pos = w.pos || (raw ? guessPos(raw) : "noun");
      const existing = findExisting.get(w.lemma, pos) as { id: number; meaning_ja: string; n: number } | undefined;
      const meaningJa = existing?.meaning_ja ? undefined : raw ? pickMeaningJa(raw, pos) : "";
      const exs = (existing?.n ?? 0) > 0 || !examples ? [] : examples.find(w.lemma, pos);
      upsertWord(db, { lemma: w.lemma, pos, cefr: w.cefr, meaningJa, frequencyRank: w.frequencyRank, tags: w.tags, examples: exs, source: w.source });
      result.words++;
      if (!existing) result.added++;
      if (existing?.meaning_ja || meaningJa) result.withMeaning++;
      if ((existing?.n ?? 0) > 0 || exs.length) result.withExamples++;
      result.bySource[w.source] = (result.bySource[w.source] ?? 0) + 1;
      result.byCefr[w.cefr] = (result.byCefr[w.cefr] ?? 0) + 1;
    }
  });
  return result;
}
