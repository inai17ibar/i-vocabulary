import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { applyGenerated, buildParams, costUsd, type GeneratedEntry, keyOf, LLM_ATTRIBUTION, parseEntries, selectTargets, type TargetWord } from "../src/services/llm-enrich.ts";
import { getWord, upsertWord } from "../src/services/vocab.ts";
import { setup } from "./helpers.ts";

const word = (lemma: string, pos = "verb"): TargetWord => ({ lemma, pos, cefr: "B1", tags: "", meaningJa: "" });
const message = (text: string, stop: Anthropic.Message["stop_reason"] = "end_turn") =>
  ({ model: "claude-opus-5-5", stop_reason: stop, content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message;

describe("parseEntries", () => {
  const words = [word("hesitate"), word("reluctant", "adj")];
  it("keeps entries for requested words only, trimmed and capped", () => {
    const out = parseEntries(message(JSON.stringify({ entries: [
      { key: "hesitate|verb", meaning_ja: " ためらう ", examples: [{ en: "Don't hesitate to ask.", ja: "遠慮なく聞いて。" }, { en: "a", ja: "b" }, { en: "c", ja: "d" }],
        synonyms: [{ lemma: "hesitate", note_ja: "自分" }, { lemma: "waver", note_ja: "決心が揺らぐ" }], antonyms: ["decide", "", "act", "go"] },
      { key: "unknown|noun", meaning_ja: "?", examples: [], synonyms: [], antonyms: [] },
      { key: "reluctant|adj", meaning_ja: "", examples: [], synonyms: [], antonyms: [] },
    ] })), words, new Date("2026-10-12T00:00:00Z"));
    expect(out).toEqual([{
      lemma: "hesitate", pos: "verb", meaning_ja: "ためらう",
      examples: [{ en: "Don't hesitate to ask.", ja: "遠慮なく聞いて。" }, { en: "a", ja: "b" }],
      synonyms: [{ lemma: "waver", note_ja: "決心が揺らぐ" }], antonyms: ["decide", "act"],
      model: "claude-opus-5-5", generated_at: "2026-10-12T00:00:00.000Z",
    }]);
  });
  it("ignores truncated, refused or broken responses", () => {
    expect(parseEntries(message("{\"entries\": [", "max_tokens"), words)).toEqual([]);
    expect(parseEntries(message("", "refusal"), words)).toEqual([]);
    expect(parseEntries(message("not json"), words)).toEqual([]);
  });
});

describe("buildParams / costUsd", () => {
  it("asks for structured JSON at low effort and lists each word with its key", () => {
    const p = buildParams([word("hesitate")], "claude-opus-5-5");
    expect(p.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(JSON.stringify(p.messages)).toContain("hesitate|verb");
  });
  it("halves the price for batches", () => {
    expect(costUsd("claude-opus-5-5", { input: 1e6, output: 1e6 }, false)).toBe(24);
    expect(costUsd("claude-opus-5-5", { input: 1e6, output: 1e6 }, true)).toBe(12);
    expect(costUsd("unknown", { input: 1, output: 1 }, true)).toBeNull();
  });
});

describe("selectTargets / applyGenerated", () => {
  it("targets imported shared words not yet generated, and applies results without touching curated words", async () => {
    const { db } = await setup();
    const id = upsertWord(db, { lemma: "hesitate", pos: "verb", cefr: "B1", meaningJa: "ためらう、口ごもる", source: "cefr-j",
      examples: [{ en: "Tom said that Mary hesitated.", ja: "トムは言った。", attribution: "Tatoeba #1 (CK)" }] });
    upsertWord(db, { lemma: "ponder", pos: "verb", cefr: "C1", meaningJa: "熟考する", source: "octanove" });

    const targets = selectTargets(db, new Set(["ponder|verb"]));
    expect(targets.map(keyOf)).toEqual(["hesitate|verb"]);
    expect(targets.every((t) => t.lemma !== "happy")).toBe(true); // 同梱データは対象外

    const entries: GeneratedEntry[] = [
      { lemma: "hesitate", pos: "verb", meaning_ja: "ためらう、迷う", examples: [{ en: "Don't hesitate to ask me.", ja: "遠慮なく聞いてね。" }],
        synonyms: [{ lemma: "waver", note_ja: "決心が揺らぐ" }], antonyms: ["decide"], model: "m", generated_at: "t" },
      { lemma: "happy", pos: "adj", meaning_ja: "上書きされない", examples: [], synonyms: [], antonyms: [], model: "m", generated_at: "t" },
    ];
    expect(applyGenerated(db, entries)).toEqual({ applied: 1, missing: 1 });
    expect(applyGenerated(db, entries)).toEqual({ applied: 1, missing: 1 }); // 2 回目も重複しない

    const w = getWord(db, id)!;
    expect(w.meaningJa).toBe("ためらう、迷う");
    expect(w.examples.map((e) => e.attribution)).toEqual([LLM_ATTRIBUTION, "Tatoeba #1 (CK)"]);
    expect(w.synonyms).toEqual([expect.objectContaining({ lemma: "waver", note: "決心が揺らぐ" })]);
    expect(w.antonyms.map((a) => a.lemma)).toEqual(["decide"]);
    const happy = db.prepare("SELECT meaning_ja FROM words WHERE lemma = 'happy' AND source = 'seed'").get() as { meaning_ja: string };
    expect(happy.meaning_ja).not.toBe("上書きされない");
  });
});
