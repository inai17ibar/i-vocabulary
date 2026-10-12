import { describe, expect, it } from "vitest";
import type { User } from "@ivocab/shared";
import { introduceNewCards } from "../src/services/cards.ts";
import { ExampleIndex, importOpenWordlist, mergeWordlists, parseEjdict, pickMeaningJa, usageScore } from "../src/services/open-wordlists.ts";
import { getWord } from "../src/services/vocab.ts";
import { setup } from "./helpers.ts";

const EJDICT = [
  "available\t『利用できる』,『役に立つ』 / (品物・情報などが)『手にはいる』 / (人が)手があいている,暇である",
  "run\t『走る』,駆ける / 〈人が〉(…に)『急ぐ』,突進する《+『for』+『名』》 / 〈C〉『走ること』",
  "light\t〈U〉『光,光線』;明るさ / 〈C〉『明かり』 / 『明るい』 / 『軽い』 / …‘に'『火をつける』 / …‘を'照らす",
  "a.m.,am\t午前,antemeridiem / =ante meridiem",
  "happy\t幸福な",
  "reluctant\t気が進まない,いやいやながらの",
  "hesitate\tためらう,ちゅうちょする",
].join("\n");

describe("pickMeaningJa", () => {
  const dict = parseEjdict(EJDICT);
  it("picks translations that fit the part of speech, primary ones first", () => {
    expect(pickMeaningJa(dict.get("available")!, "adj")).toBe("利用できる、手があいている、暇である");
    expect(pickMeaningJa(dict.get("run")!, "verb")).toBe("走る、急ぐ、駆ける");
    expect(pickMeaningJa(dict.get("run")!, "noun")).toBe("走ること");
    expect(pickMeaningJa(dict.get("light")!, "noun")).toBe("光、光線、明かり");
    expect(pickMeaningJa(dict.get("light")!, "adj")).toBe("明るい、軽い");
  });
  it("drops grammar notes and Latin-letter fragments", () => {
    expect(pickMeaningJa(dict.get("am")!, "adv")).toBe("午前");
  });
  it("falls back to any sense when none fits the part of speech", () => {
    expect(pickMeaningJa("ためらう", "noun")).toBe("ためらう");
    expect(pickMeaningJa("", "noun")).toBe("");
  });
});

const CEFRJ = "headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold\na,determiner,A1,,,\nthe,determiner,A1,,,\na.m./A.M./am/AM,adverb,A1,,,\nrun,verb,A1,,,\nrun,noun,B1,,,\nhesitate,verb,B1,,,\nlight,noun,A1,,,\n";
const OVP = "headword,pos,CEFR,notes\nreluctant,adjective,C1,\nhesitate,verb,C1,\n";
const NGSL = "Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nthe,1,87,60000\na,5,80,20000\nrun,300,60,500\nprotein,2400,40,10\n";
const NGSL_S = "Lemma,Rank,SFI,U\nrun,100,60,400\n";
const NAWL = "hypothesis,hypotheses\nreluctant\n";

describe("mergeWordlists", () => {
  const words = mergeWordlists({ cefrj: CEFRJ, octanove: OVP, ngsl: NGSL, ngslSpoken: NGSL_S, nawl: NAWL });
  const find = (lemma: string, pos?: string) => words.find((w) => w.lemma === lemma && (pos === undefined || w.pos === pos));

  it("keeps content words with CEFR, frequency and tags; skips function words", () => {
    expect(find("a")).toBeUndefined();
    expect(find("the")).toBeUndefined();
    expect(find("a.m.", "adv")).toMatchObject({ cefr: "A1" });
    expect(find("run", "verb")).toMatchObject({ cefr: "A1", frequencyRank: 300, tags: ["spoken"], source: "cefr-j" });
    expect(find("run", "noun")).toMatchObject({ cefr: "B1" });
    expect(find("reluctant", "adj")).toMatchObject({ cefr: "C1", tags: ["academic"], source: "octanove" });
  });
  it("takes the lower level when lists disagree", () => {
    expect(find("hesitate", "verb")).toMatchObject({ cefr: "B1" });
  });
  it("adds frequent and academic words missing from the CEFR lists", () => {
    expect(find("protein")).toMatchObject({ pos: "", cefr: "B2", source: "ngsl" });
    expect(find("hypothesis")).toMatchObject({ pos: "", cefr: "C1", source: "nawl", tags: ["academic"] });
  });
});

const PAIRS = [
  "Run!\t走れ！\tCC-BY 2.0 (France) Attribution: tatoeba.org #1 (u1) & #2 (u2)",
  "I run every morning before work.\t私は毎朝仕事の前に走ります。\tCC-BY 2.0 (France) Attribution: tatoeba.org #3 (CK) & #4 (bunbuku)",
  "That was a long run for a beginner.\t初心者には長い距離だった。\tCC-BY 2.0 (France) Attribution: tatoeba.org #5 (CK) & #6 (x)",
  "Tom is reluctant to talk about his past.\tトムは過去について話したがらない。\tCC-BY 2.0 (France) Attribution: tatoeba.org #7 (CK) & #8 (y)",
].join("\n");

describe("ExampleIndex", () => {
  const idx = ExampleIndex.fromManythings(PAIRS);
  it("picks a sentence using the word in the right part of speech, with attribution", () => {
    expect(idx.find("run", "verb", 1)).toEqual([{ en: "I run every morning before work.", ja: "私は毎朝仕事の前に走ります。", attribution: "Tatoeba #3 (CK) & #4 (bunbuku)" }]);
    expect(idx.find("run", "noun", 1)[0].en).toBe("That was a long run for a beginner.");
  });
  it("skips sentences that are too short", () => {
    expect(idx.find("run", "verb").map((e) => e.en)).not.toContain("Run!");
  });
  it("scores usage by the words around the headword", () => {
    expect(usageScore("I want to run.", "run", "verb")).toBeGreaterThan(usageScore("I want to run.", "run", "noun"));
  });
});

describe("importOpenWordlist", () => {
  it("adds new words with meanings, tags and credited examples, and never overwrites curated seed words", async () => {
    const { db } = await setup();
    const seeded = db.prepare("SELECT id, meaning_ja FROM words WHERE lemma = 'happy' AND source = 'seed'").get() as { id: number; meaning_ja: string };
    const words = [
      ...mergeWordlists({ cefrj: CEFRJ, octanove: OVP, ngsl: NGSL, ngslSpoken: NGSL_S, nawl: NAWL }),
      { lemma: "happy", pos: "adj", cefr: "A1" as const, frequencyRank: 400, tags: ["spoken" as const], source: "cefr-j" as const },
    ];
    const r = importOpenWordlist(db, words, parseEjdict(EJDICT), ExampleIndex.fromManythings(PAIRS));
    expect(r.words).toBe(words.length);

    const happy = getWord(db, seeded.id)!;
    expect(happy.meaningJa).toBe(seeded.meaning_ja);
    expect(happy.source).toBe("seed");
    expect(happy.tags).toEqual(["spoken"]);
    expect(happy.examples.every((e) => !e.attribution)).toBe(true);

    const runId = (db.prepare("SELECT id FROM words WHERE lemma = 'run' AND pos = 'verb'").get() as { id: number }).id;
    const run = getWord(db, runId)!;
    expect(run).toMatchObject({ meaningJa: "走る、急ぐ、駆ける", cefr: "A1", tags: ["spoken"], source: "cefr-j" });
    expect(run.examples[0]).toMatchObject({ en: "I run every morning before work.", attribution: "Tatoeba #3 (CK) & #4 (bunbuku)" });

    // 2 回目は追加されず、訳も変わらない
    const again = importOpenWordlist(db, words, parseEjdict(EJDICT), ExampleIndex.fromManythings(PAIRS));
    expect(again.added).toBe(0);
    expect(getWord(db, runId)!.examples).toHaveLength(run.examples.length);
  });
});

describe("new card order", () => {
  it("introduces curated words first, then the exam's preferred tag, then by frequency", async () => {
    const { db, user } = await setup();
    db.exec("DELETE FROM words WHERE source = 'seed'");
    const add = (lemma: string, rank: number, tags: string) =>
      db.prepare("INSERT INTO words (lemma, pos, cefr, meaning_ja, frequency_rank, tags, source) VALUES (?, 'noun', 'B1', '訳', ?, ?, 'cefr-j')").run(lemma, rank, tags);
    add("common", 100, "");
    add("chat", 900, "spoken");
    add("thesis", 800, "academic");
    const order = (u: User) => introduceNewCards(db, u, "word", 3).map((c) => (db.prepare("SELECT lemma FROM words WHERE id = ?").get(c.item_id) as { lemma: string }).lemma);
    expect(order(user)).toEqual(["chat", "common", "thesis"]);

    const reg = await setup();
    reg.db.exec("DELETE FROM words WHERE source = 'seed'");
    const add2 = (lemma: string, rank: number, tags: string) =>
      reg.db.prepare("INSERT INTO words (lemma, pos, cefr, meaning_ja, frequency_rank, tags, source) VALUES (?, 'noun', 'B1', '訳', ?, ?, 'cefr-j')").run(lemma, rank, tags);
    add2("common", 100, "");
    add2("chat", 900, "spoken");
    add2("thesis", 800, "academic");
    const ielts = { ...reg.user, levelId: "ielts-4.0", exam: "ielts" } as User;
    expect(introduceNewCards(reg.db, ielts, "word", 3).map((c) => (reg.db.prepare("SELECT lemma FROM words WHERE id = ?").get(c.item_id) as { lemma: string }).lemma)).toEqual(["thesis", "common", "chat"]);
  });
});
