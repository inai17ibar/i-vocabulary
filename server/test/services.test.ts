import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { applyEnrichment, cefrFromRank, datamuseProvider, enrichWords, freeDictionaryProvider, importRows, parseCsv } from "../src/services/importers.ts";
import { forgettingCurve, gradeFromQuiz } from "../src/services/srs.ts";
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
