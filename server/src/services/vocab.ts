import type { Cefr, Example, ExpressionGroup, Register, Relation, Word } from "@ivocab/shared";
import { isCefr } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";

interface WordRow {
  id: number;
  lemma: string;
  pos: string;
  cefr: Cefr;
  meaning_ja: string;
  definition_en: string | null;
  ipa: string | null;
  source: string;
}

export interface WordInput {
  lemma: string;
  pos: string;
  cefr: Cefr;
  meaningJa?: string;
  definitionEn?: string | null;
  ipa?: string | null;
  frequencyRank?: number | null;
  examples?: Example[];
  synonyms?: { lemma: string; note?: string | null }[];
  antonyms?: { lemma: string; note?: string | null }[];
  source: string;
  createdBy?: number | null;
}

const POS_ALIASES: Record<string, string> = {
  n: "noun", noun: "noun", 名詞: "noun",
  v: "verb", verb: "verb", 動詞: "verb",
  adj: "adj", adjective: "adj", a: "adj", 形容詞: "adj",
  adv: "adv", adverb: "adv", 副詞: "adv",
  prep: "prep", preposition: "prep", 前置詞: "prep",
  conj: "conj", conjunction: "conj",
  pron: "pron", pronoun: "pron",
  det: "det", determiner: "det",
  phrase: "phrase", phr: "phrase",
};

export function normalizePos(pos: string | undefined | null): string {
  const p = (pos ?? "").trim().toLowerCase().replace(/\.$/, "");
  return POS_ALIASES[p] ?? (p || "other");
}

/** 単語を追加・更新する。既存の値は空でない入力で上書きし、関係語・例文は追記する */
export function upsertWord(db: DB, w: WordInput): number {
  const lemma = w.lemma.trim();
  const pos = normalizePos(w.pos);
  if (!lemma) throw new Error("lemma is required");
  if (!isCefr(w.cefr)) throw new Error(`invalid CEFR level: ${w.cefr}`);
  // 一意性は所有者ごと: 共有語（created_by NULL）と各ユーザーの語は別の行になり、互いに上書きしない
  const owner = w.createdBy ?? null;
  const existing = db.prepare("SELECT id FROM words WHERE lemma = ? AND pos = ? AND created_by IS ?").get(lemma, pos, owner) as { id: number } | undefined;
  let id: number;
  if (existing) {
    id = existing.id;
    db.prepare(
      `UPDATE words SET
         meaning_ja = CASE WHEN ? <> '' THEN ? ELSE meaning_ja END,
         definition_en = COALESCE(?, definition_en),
         ipa = COALESCE(?, ipa),
         frequency_rank = COALESCE(?, frequency_rank)
       WHERE id = ?`,
    ).run(w.meaningJa ?? "", w.meaningJa ?? "", w.definitionEn ?? null, w.ipa ?? null, w.frequencyRank ?? null, id);
  } else {
    const r = db.prepare(
      `INSERT INTO words (lemma, pos, cefr, meaning_ja, definition_en, ipa, frequency_rank, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(lemma, pos, w.cefr, w.meaningJa ?? "", w.definitionEn ?? null, w.ipa ?? null, w.frequencyRank ?? null, w.source, owner);
    id = Number(r.lastInsertRowid);
  }
  for (const ex of w.examples ?? []) addExample(db, id, ex);
  for (const s of w.synonyms ?? []) addRelation(db, id, "synonym", s.lemma, s.note ?? null, w.source);
  for (const a of w.antonyms ?? []) addRelation(db, id, "antonym", a.lemma, a.note ?? null, w.source);
  return id;
}

export function addExample(db: DB, wordId: number, ex: Example) {
  db.prepare("INSERT OR IGNORE INTO examples (word_id, sentence, translation_ja) VALUES (?, ?, ?)").run(wordId, ex.en, ex.ja ?? null);
}

export function addRelation(db: DB, wordId: number, type: "synonym" | "antonym", lemma: string, note: string | null, source: string) {
  const l = lemma.trim();
  if (!l) return;
  const self = db.prepare("SELECT lemma FROM words WHERE id = ?").get(wordId) as { lemma: string } | undefined;
  if (self && self.lemma.toLowerCase() === l.toLowerCase()) return;
  db.prepare("INSERT OR IGNORE INTO word_relations (word_id, type, related_lemma, note, source) VALUES (?, ?, ?, ?, ?)").run(wordId, type, l, note, source);
}

function relationsFor(db: DB, wordId: number, type: "synonym" | "antonym"): Relation[] {
  // 関連語のリンク先は共有語のみ（他ユーザーの追加語の ID を露出させない）
  const lemmaId = (lemma: string) =>
    (db.prepare("SELECT id FROM words WHERE lemma = ? AND created_by IS NULL ORDER BY id LIMIT 1").get(lemma) as { id: number } | undefined)?.id ?? null;
  const forward = db.prepare("SELECT related_lemma AS lemma, note FROM word_relations WHERE word_id = ? AND type = ? ORDER BY id").all(wordId, type) as {
    lemma: string;
    note: string | null;
  }[];
  // 関係は対称なので、他の単語側に登録された関係も拾う（メモは相手側の説明なので付けない）。
  // 品詞が違う語は除外（solution(名詞) の類義語 answer を answer(動詞) 側に出さない）
  const reverse = db.prepare(
    `SELECT w.lemma AS lemma FROM word_relations r JOIN words w ON w.id = r.word_id
     JOIN words self ON self.id = ?
     WHERE r.type = ? AND r.related_lemma = self.lemma AND w.pos = self.pos
       AND (w.created_by IS NULL OR w.created_by IS self.created_by) ORDER BY r.id`,
  ).all(wordId, type) as { lemma: string }[];
  const seen = new Set<string>();
  const out: Relation[] = [];
  for (const r of [...forward, ...reverse.map((x) => ({ lemma: x.lemma, note: null }))]) {
    const key = r.lemma.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, lemma: r.lemma, wordId: lemmaId(r.lemma), note: r.note });
  }
  return out;
}

/** 共有語、または本人が追加した語なら見える */
export function canSeeWord(db: DB, id: number, userId: number): boolean {
  return !!db.prepare("SELECT 1 FROM words WHERE id = ? AND (created_by IS NULL OR created_by = ?)").get(id, userId);
}

export function getWord(db: DB, id: number): Word | null {
  const row = db.prepare("SELECT id, lemma, pos, cefr, meaning_ja, definition_en, ipa, source FROM words WHERE id = ?").get(id) as WordRow | undefined;
  return row ? hydrateWord(db, row) : null;
}

function hydrateWord(db: DB, row: WordRow): Word {
  const examples = db.prepare("SELECT sentence AS en, translation_ja AS ja FROM examples WHERE word_id = ? ORDER BY id").all(row.id) as unknown as Example[];
  return {
    id: row.id,
    lemma: row.lemma,
    pos: row.pos,
    cefr: row.cefr,
    meaningJa: row.meaning_ja,
    definitionEn: row.definition_en,
    ipa: row.ipa,
    examples: examples.map((e) => ({ en: e.en, ja: e.ja })),
    synonyms: relationsFor(db, row.id, "synonym"),
    antonyms: relationsFor(db, row.id, "antonym"),
    source: row.source,
  };
}

export function searchWords(db: DB, opts: { q?: string; cefr?: Cefr; userId?: number; limit?: number; offset?: number }): { items: Word[]; total: number } {
  const where: string[] = ["(created_by IS NULL OR created_by = ?)"];
  const params: (string | number)[] = [opts.userId ?? -1];
  if (opts.q) {
    where.push("(lemma LIKE ? OR meaning_ja LIKE ?)");
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.cefr) {
    where.push("cefr = ?");
    params.push(opts.cefr);
  }
  const w = where.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM words WHERE ${w}`).get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT id, lemma, pos, cefr, meaning_ja, definition_en, ipa, source FROM words WHERE ${w}
     ORDER BY CASE cefr WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END, lemma
     LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit ?? 50, opts.offset ?? 0) as unknown as WordRow[];
  return { items: rows.map((r) => hydrateWord(db, r)), total };
}

export interface ExpressionGroupInput {
  intentJa: string;
  intentEn: string;
  scene: string;
  cefr: Cefr;
  expressions: { text: string; register: Register; note?: string | null; example?: string | null }[];
}

export function upsertExpressionGroup(db: DB, g: ExpressionGroupInput): number {
  db.prepare(
    `INSERT INTO expression_groups (intent_ja, intent_en, scene, cefr) VALUES (?, ?, ?, ?)
     ON CONFLICT (intent_ja) DO UPDATE SET intent_en = excluded.intent_en, scene = excluded.scene, cefr = excluded.cefr`,
  ).run(g.intentJa, g.intentEn, g.scene, g.cefr);
  const { id } = db.prepare("SELECT id FROM expression_groups WHERE intent_ja = ?").get(g.intentJa) as { id: number };
  for (const e of g.expressions) {
    db.prepare(
      `INSERT INTO expressions (group_id, text, register, note, example) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (group_id, text) DO UPDATE SET register = excluded.register, note = excluded.note, example = excluded.example`,
    ).run(id, e.text, e.register, e.note ?? null, e.example ?? null);
  }
  return id;
}

export function getExpressionGroup(db: DB, id: number): ExpressionGroup | null {
  const g = db.prepare("SELECT id, intent_ja, intent_en, scene, cefr FROM expression_groups WHERE id = ?").get(id) as
    | { id: number; intent_ja: string; intent_en: string; scene: string; cefr: Cefr }
    | undefined;
  if (!g) return null;
  const exps = db.prepare("SELECT id, text, register, note, example FROM expressions WHERE group_id = ? ORDER BY id").all(id) as unknown as ExpressionGroup["expressions"];
  return { id: g.id, intentJa: g.intent_ja, intentEn: g.intent_en, scene: g.scene, cefr: g.cefr, expressions: exps.map((e) => ({ ...e })) };
}

export function listExpressionGroups(db: DB): ExpressionGroup[] {
  const ids = db.prepare("SELECT id FROM expression_groups ORDER BY id").all() as { id: number }[];
  return ids.map((r) => getExpressionGroup(db, r.id)!);
}

/** data/seed の JSON 形式を取り込む */
export interface SeedWordsFile {
  source: string;
  words: { lemma: string; pos: string; cefr: Cefr; ja: string; ipa?: string; def?: string; ex?: [string, string | null][]; syn?: string[]; ant?: string[] }[];
}
export interface SeedExpressionsFile {
  groups: { intentJa: string; intentEn: string; scene: string; cefr: Cefr; expressions: [string, Register, string | null, string | null][] }[];
}

function parseRel(s: string) {
  const [lemma, note] = s.split("|");
  return { lemma, note: note ?? null };
}

export function importSeedWords(db: DB, file: SeedWordsFile): number {
  return tx(db, () => {
    for (const w of file.words) {
      upsertWord(db, {
        lemma: w.lemma,
        pos: w.pos,
        cefr: w.cefr,
        meaningJa: w.ja,
        definitionEn: w.def ?? null,
        ipa: w.ipa ?? null,
        examples: (w.ex ?? []).map(([en, ja]) => ({ en, ja })),
        synonyms: (w.syn ?? []).map(parseRel),
        antonyms: (w.ant ?? []).map(parseRel),
        source: "seed",
      });
    }
    return file.words.length;
  });
}

export function importSeedExpressions(db: DB, file: SeedExpressionsFile): number {
  return tx(db, () => {
    for (const g of file.groups) {
      upsertExpressionGroup(db, {
        intentJa: g.intentJa,
        intentEn: g.intentEn,
        scene: g.scene,
        cefr: g.cefr,
        expressions: g.expressions.map(([text, register, note, example]) => ({ text, register, note, example })),
      });
    }
    return file.groups.length;
  });
}
