import { describe, expect, it } from "vitest";
import { openDb, SCHEMA_VERSION } from "../src/db.ts";
import { applyEnrichment, cefrFromRank, datamuseProvider, enrichWords, freeDictionaryProvider, importRows, parseCsv } from "../src/services/importers.ts";
import { type CardRow, forgettingCurve, gradeFromQuiz, retrievability } from "../src/services/srs.ts";
import { inflections, makeCloze } from "../src/services/text.ts";
import { getWord, upsertWord } from "../src/services/vocab.ts";
import { extractCorrections } from "../src/services/cambly.ts";
import { endOfLocalDay, localDate } from "../src/services/time.ts";

describe("text", () => {
  it("generates inflections", () => {
    expect(inflections("buy")).toContain("bought");
    expect(inflections("study")).toEqual(expect.arrayContaining(["studies", "studied"]));
    expect(inflections("stop")).toEqual(expect.arrayContaining(["stopped", "stopping"]));
    expect(inflections("arrive")).toEqual(expect.arrayContaining(["arrived", "arriving"]));
  });
  it("makes cloze sentences from inflected forms", () => {
    expect(makeCloze("I bought a new phone last week.", "buy")).toBe("I _____ a new phone last week.");
    expect(makeCloze("Prices have increased a lot.", "increase")).toBe("Prices have _____ a lot.");
    expect(makeCloze("Nothing here.", "buy")).toBeNull();
  });
});

describe("srs", () => {
  it("forgetting curve hits 90% at t = S", () => {
    expect(forgettingCurve(10, 0)).toBeCloseTo(1);
    expect(forgettingCurve(10, 10)).toBeCloseTo(0.9, 5);
    expect(forgettingCurve(10, 30)).toBeLessThan(0.9);
  });
  it("lowers retrievability within the same day instead of rounding elapsed time to whole days", () => {
    const reviewed = new Date("2026-10-11T00:00:00Z");
    const row = { state: 2, stability: 1, last_review: reviewed.toISOString(), due: reviewed.toISOString() } as CardRow;
    const at = (hours: number) => retrievability(row, new Date(reviewed.getTime() + hours * 3600_000))!;
    expect(at(0)).toBeCloseTo(1);
    expect(at(12)).toBeLessThan(at(1));
    expect(at(24)).toBeCloseTo(0.9, 2);
    expect(retrievability({ ...row, state: 0 }, reviewed)).toBeNull();
  });
  it("maps quiz results to grades", () => {
    expect(gradeFromQuiz(false)).toBe(1);
    expect(gradeFromQuiz(true, 3000)).toBe(3);
    expect(gradeFromQuiz(true, 15000)).toBe(2);
  });
});

describe("time", () => {
  it("computes local dates and end of day", () => {
    const now = new Date("2026-10-10T16:30:00Z"); // JST 01:30 on 10/11
    expect(localDate(now, "Asia/Tokyo")).toBe("2026-10-11");
    expect(endOfLocalDay(now, "Asia/Tokyo").toISOString()).toBe("2026-10-11T15:00:00.000Z");
    // 分単位のオフセット（インド +5:30 / ネパール +5:45）
    expect(endOfLocalDay(new Date("2026-10-10T10:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-10-10T18:30:00.000Z");
    expect(endOfLocalDay(new Date("2026-10-10T10:00:00Z"), "Asia/Kathmandu").toISOString()).toBe("2026-10-10T18:15:00.000Z");
    // DST 切替日（米国東部 2026-11-01 は 25 時間）
    expect(endOfLocalDay(new Date("2026-11-01T12:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("importers", () => {
  it("parses CSV with quotes", () => {
    const rows = parseCsv('lemma,meaning_ja,example\n"resilient","回復力のある","She is ""very"" resilient, truly."\n');
    expect(rows).toEqual([{ lemma: "resilient", meaning_ja: "回復力のある", example: 'She is "very" resilient, truly.' }]);
  });
  it("imports generic and ngsl presets", () => {
    const db = openDb(":memory:");
    const r = importRows(db, parseCsv("lemma,pos,cefr,meaning_ja,synonyms,antonyms\nresilient,adj,C1,回復力のある,tough;hardy,fragile\nbadrow,adj,Z9,x,,\n"), { preset: "generic", source: "test" });
    expect(r).toEqual({ imported: 1, skipped: 1 });
    const w = getWord(db, 1)!;
    expect(w.synonyms.map((s) => s.lemma)).toEqual(["tough", "hardy"]);
    expect(w.antonyms.map((s) => s.lemma)).toEqual(["fragile"]);
    const n = importRows(db, parseCsv("Lemma\nthe\nbe\n"), { preset: "ngsl", source: "ngsl" });
    expect(n.imported).toBe(2);
    expect(cefrFromRank(1)).toBe("A1");
    expect(cefrFromRank(2500)).toBe("B2");
  });
  it("relations are symmetric when read", () => {
    const db = openDb(":memory:");
    const hot = upsertWord(db, { lemma: "hot", pos: "adj", cefr: "A1", source: "t", antonyms: [{ lemma: "cold" }] });
    const cold = upsertWord(db, { lemma: "cold", pos: "adj", cefr: "A1", source: "t" });
    expect(getWord(db, cold)!.antonyms.map((a) => a.lemma)).toEqual(["hot"]);
    expect(getWord(db, hot)!.antonyms[0].wordId).toBe(cold);
    // 品詞が違う逆方向の関係は出さない
    upsertWord(db, { lemma: "solution", pos: "noun", cefr: "B1", source: "t", synonyms: [{ lemma: "answer" }] });
    const answerVerb = upsertWord(db, { lemma: "answer", pos: "verb", cefr: "A1", source: "t" });
    expect(getWord(db, answerVerb)!.synonyms).toEqual([]);
  });
  it("enriches words from dictionary providers (mocked)", async () => {
    const db = openDb(":memory:");
    const id = upsertWord(db, { lemma: "brave", pos: "adj", cefr: "B1", source: "t" });
    const fakeFetch = async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("datamuse")
          ? url.includes("rel_syn") ? [{ word: "courageous" }, { word: "bold" }] : [{ word: "cowardly" }]
          : [{ phonetic: "/breɪv/", meanings: [{ partOfSpeech: "adjective", synonyms: ["valiant"], definitions: [{ definition: "showing courage", example: "a brave soldier" }] }, { partOfSpeech: "verb", definitions: [{ definition: "to face" }] }] }],
    });
    const n = await enrichWords(db, [freeDictionaryProvider(fakeFetch), datamuseProvider(fakeFetch)]);
    expect(n).toBe(1);
    const w = getWord(db, id)!;
    expect(w.ipa).toBe("/breɪv/");
    expect(w.definitionEn).toBe("showing courage");
    expect(w.examples[0].en).toBe("a brave soldier");
    expect(w.synonyms.map((s) => s.lemma)).toEqual(["valiant", "courageous", "bold"]);
    expect(w.antonyms.map((s) => s.lemma)).toEqual(["cowardly"]);
    // 通信失敗は補完済みにしない
    const failing = upsertWord(db, { lemma: "calm", pos: "adj", cefr: "B1", source: "t" });
    const broken = { name: "x", lookup: async () => { throw new Error("offline"); } };
    expect(await enrichWords(db, [broken])).toBe(0);
    expect((db.prepare("SELECT enriched_at FROM words WHERE id = ?").get(failing) as { enriched_at: string | null }).enriched_at).toBeNull();
    // 補完済みの語はスキップ
    db.prepare("UPDATE words SET enriched_at = 'x' WHERE id = ?").run(failing);
    expect(await enrichWords(db, [datamuseProvider(fakeFetch)])).toBe(0);
    applyEnrichment(db, id, { synonyms: ["brave"] }, "x");
    expect(getWord(db, id)!.synonyms.map((s) => s.lemma)).not.toContain("brave");
  });
});

describe("cambly corrections", () => {
  it("extracts several correction formats", () => {
    const text = [
      "- I am agree → I agree",
      "Correction: He don't like it / He doesn't like it",
      "Not 'make a photo' but 'take a photo'",
      "Just a normal line",
    ].join("\n");
    expect(extractCorrections(text)).toEqual([
      { original: "I am agree", better: "I agree" },
      { original: "He don't like it", better: "He doesn't like it" },
      { original: "make a photo", better: "take a photo" },
    ]);
  });
});

describe("listening quiz", () => {
  it("asks to pick the spoken word among similar-looking words", async () => {
    const { seedDatabase } = await import("../src/seed.ts");
    const { listeningQuestion } = await import("../src/services/quiz.ts");
    const db = openDb(":memory:");
    seedDatabase(db);
    const id = (db.prepare("SELECT id FROM words WHERE lemma = 'expand'").get() as { id: number }).id;
    const w = getWord(db, id)!;
    expect(w.ipa).toBe("/ɪkˈspænd/");
    const q = listeningQuestion(db, 1, w, () => 0.3)!;
    expect(q.mode).toBe("listening");
    expect(q.choices[q.answerIndex].text).toBe("expand");
    expect(new Set(q.choices.map((c) => c.text)).size).toBe(q.choices.length);
    expect(q.choices.some((c) => c.text !== "expand" && (c.text.startsWith("ex") || c.text.endsWith("and")))).toBe(true);
  });
});

describe("migration v2", () => {
  it("rebuilds the words table without losing rows or child records", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(mkdtempSync(join(tmpdir(), "ivocab-")), "v1.db");
    // v1 スキーマの DB を作る（v2 の直前の状態）
    const v1 = openDb(path);
    upsertWord(v1, { lemma: "brave", pos: "adj", cefr: "B1", source: "t", examples: [{ en: "a brave act", ja: null }], synonyms: [{ lemma: "bold" }] });
    v1.close();
    const raw = new DatabaseSync(path);
    expect((raw.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
    raw.exec("UPDATE schema_version SET version = 1");
    raw.exec("DROP INDEX words_lemma_pos_owner; DROP INDEX words_lemma");
    // v3 以降で足したものも外して、本当に v1 の状態に戻す
    raw.exec("DROP INDEX review_logs_user_time; DROP INDEX review_logs_card; ALTER TABLE examples DROP COLUMN attribution");
    raw.close();
    const db = openDb(path);
    const w = getWord(db, 1)!;
    expect(w.examples).toHaveLength(1);
    expect(w.synonyms.map((s) => s.lemma)).toEqual(["bold"]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });
});
