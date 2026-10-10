import type { Cefr } from "@ivocab/shared";
import { isCefr } from "@ivocab/shared";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";
import { addExample, addRelation, normalizePos, upsertWord } from "./vocab.ts";

/**
 * 単語リストの供給元（取り込みアダプタ）。
 *  - generic : lemma,pos,cefr,meaning_ja,definition_en,example,example_ja,synonyms,antonyms の CSV（区切りは ; ）
 *  - ngsl    : NGSL (New General Service List, CC BY-SA 4.0) / NAWL 等の頻度順リスト。順位から CEFR を推定
 *  - cefrj   : CEFR-J Wordlist（headword, pos, CEFR 列）
 */
export type Preset = "generic" | "ngsl" | "cefrj";

/** RFC 4180 準拠の最小 CSV パーサ（TSV も可） */
export function parseCsv(text: string, delimiter?: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const delim = delimiter ?? (src.split("\n")[0].includes("\t") ? "\t" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function col(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) if (row[n]) return row[n];
  return "";
}

/** 頻度順位から CEFR を推定（NGSL 約 2,800 語 + NAWL/AWL を想定した目安） */
export function cefrFromRank(rank: number): Cefr {
  if (rank <= 500) return "A1";
  if (rank <= 1200) return "A2";
  if (rank <= 2000) return "B1";
  if (rank <= 3000) return "B2";
  if (rank <= 5000) return "C1";
  return "C2";
}

export interface ImportOptions {
  preset: Preset;
  source: string;
  defaultCefr?: Cefr;
}

export function importRows(db: DB, rows: Record<string, string>[], opts: ImportOptions): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;
  tx(db, () => {
    rows.forEach((row, i) => {
      const lemma = col(row, "lemma", "word", "headword", "head word", "見出し語");
      if (!lemma) {
        skipped++;
        return;
      }
      let cefr = col(row, "cefr", "cefr level", "level").toUpperCase();
      const rankStr = col(row, "rank", "frequency", "freq rank");
      const rank = rankStr ? Number(rankStr) : opts.preset === "ngsl" ? i + 1 : NaN;
      if (!isCefr(cefr)) cefr = opts.preset === "ngsl" && Number.isFinite(rank) ? cefrFromRank(rank) : opts.defaultCefr ?? "";
      if (!isCefr(cefr)) {
        skipped++;
        return;
      }
      const split = (s: string) => s.split(/[;|]/).map((x) => x.trim()).filter(Boolean).map((l) => ({ lemma: l }));
      const example = col(row, "example", "example_en");
      upsertWord(db, {
        lemma,
        pos: normalizePos(col(row, "pos", "part of speech", "品詞")),
        cefr,
        meaningJa: col(row, "meaning_ja", "ja", "japanese", "意味"),
        definitionEn: col(row, "definition_en", "definition", "def") || null,
        frequencyRank: Number.isFinite(rank) ? rank : null,
        examples: example ? [{ en: example, ja: col(row, "example_ja") || null }] : [],
        synonyms: split(col(row, "synonyms", "syn")),
        antonyms: split(col(row, "antonyms", "ant")),
        source: opts.source,
      });
      imported++;
    });
  });
  return { imported, skipped };
}

/* ------------------------------------------------------------------ */
/* 外部辞書による補完（Enrichment）                                     */
/* ------------------------------------------------------------------ */

export interface Enrichment {
  definitionEn?: string;
  ipa?: string;
  examples?: string[];
  synonyms?: string[];
  antonyms?: string[];
}

export interface EnrichmentProvider {
  name: string;
  lookup(lemma: string, pos: string): Promise<Enrichment>;
}

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Datamuse API（無料・キー不要）: 類義語 rel_syn / 対義語 rel_ant */
export function datamuseProvider(fetchFn: FetchFn = fetch): EnrichmentProvider {
  const get = async (rel: string, lemma: string) => {
    const res = await fetchFn(`https://api.datamuse.com/words?${rel}=${encodeURIComponent(lemma)}&max=8`);
    if (!res.ok) return [];
    return ((await res.json()) as { word: string }[]).map((w) => w.word);
  };
  return {
    name: "datamuse",
    async lookup(lemma) {
      const [synonyms, antonyms] = await Promise.all([get("rel_syn", lemma), get("rel_ant", lemma)]);
      return { synonyms, antonyms };
    },
  };
}

interface FreeDictEntry {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: {
    partOfSpeech: string;
    synonyms?: string[];
    antonyms?: string[];
    definitions: { definition: string; example?: string; synonyms?: string[]; antonyms?: string[] }[];
  }[];
}

const FREE_DICT_POS: Record<string, string> = { noun: "noun", verb: "verb", adjective: "adj", adverb: "adv" };

/** Free Dictionary API (dictionaryapi.dev, Wiktionary 由来・CC BY-SA): 定義・発音記号・例文・関係語 */
export function freeDictionaryProvider(fetchFn: FetchFn = fetch): EnrichmentProvider {
  return {
    name: "freedictionary",
    async lookup(lemma, pos) {
      const res = await fetchFn(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`);
      if (!res.ok) return {};
      const entries = (await res.json()) as FreeDictEntry[];
      const out: Enrichment = { examples: [], synonyms: [], antonyms: [] };
      for (const e of entries) {
        out.ipa ??= e.phonetic ?? e.phonetics?.find((p) => p.text)?.text;
        for (const m of e.meanings ?? []) {
          if (pos !== "other" && pos !== "phrase" && FREE_DICT_POS[m.partOfSpeech] && FREE_DICT_POS[m.partOfSpeech] !== pos) continue;
          out.synonyms!.push(...(m.synonyms ?? []));
          out.antonyms!.push(...(m.antonyms ?? []));
          for (const d of m.definitions) {
            out.definitionEn ??= d.definition;
            if (d.example) out.examples!.push(d.example);
            out.synonyms!.push(...(d.synonyms ?? []));
            out.antonyms!.push(...(d.antonyms ?? []));
          }
        }
      }
      return out;
    },
  };
}

export interface EnrichOptions {
  limit?: number;
  /** 既に補完済みの単語も再取得する */
  force?: boolean;
  delayMs?: number;
  log?: (msg: string) => void;
}

/** 定義・関係語が不足している単語を外部辞書で補完する。結果は DB にキャッシュされる */
export async function enrichWords(db: DB, providers: EnrichmentProvider[], opts: EnrichOptions = {}): Promise<number> {
  const rows = db.prepare(
    `SELECT id, lemma, pos FROM words WHERE ${opts.force ? "1=1" : "enriched_at IS NULL"} AND lemma NOT LIKE '% %' ORDER BY COALESCE(frequency_rank, 1000000), id LIMIT ?`,
  ).all(opts.limit ?? 100) as { id: number; lemma: string; pos: string }[];
  let n = 0;
  for (const w of rows) {
    let succeeded = 0;
    for (const p of providers) {
      try {
        const e = await p.lookup(w.lemma, w.pos);
        applyEnrichment(db, w.id, e, p.name);
        succeeded++;
      } catch (err) {
        opts.log?.(`${p.name}: ${w.lemma} failed: ${(err as Error).message}`);
      }
    }
    // 全プロバイダが失敗（ネットワーク断など）した語は次回に再試行する
    if (!succeeded) continue;
    db.prepare("UPDATE words SET enriched_at = ? WHERE id = ?").run(new Date().toISOString(), w.id);
    n++;
    opts.log?.(`enriched ${w.lemma}`);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return n;
}

export function applyEnrichment(db: DB, wordId: number, e: Enrichment, source: string) {
  tx(db, () => {
    db.prepare("UPDATE words SET definition_en = COALESCE(definition_en, ?), ipa = COALESCE(ipa, ?) WHERE id = ?").run(e.definitionEn ?? null, e.ipa ?? null, wordId);
    const existingExamples = (db.prepare("SELECT COUNT(*) AS n FROM examples WHERE word_id = ?").get(wordId) as { n: number }).n;
    for (const ex of (e.examples ?? []).slice(0, Math.max(0, 3 - existingExamples))) addExample(db, wordId, { en: ex, ja: null });
    for (const s of dedupe(e.synonyms).slice(0, 8)) addRelation(db, wordId, "synonym", s, null, source);
    for (const a of dedupe(e.antonyms).slice(0, 6)) addRelation(db, wordId, "antonym", a, null, source);
  });
}

function dedupe(arr: string[] | undefined): string[] {
  return [...new Set((arr ?? []).map((s) => s.trim()).filter(Boolean))];
}
