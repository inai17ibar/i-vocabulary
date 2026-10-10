import { describe, expect, it } from "vitest";
import { CEFR_LEVELS, getLevel, LEVELS } from "./levels.ts";

describe("levels", () => {
  it("has unique ids and valid CEFR bands", () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    for (const l of LEVELS) {
      expect(CEFR_LEVELS).toContain(l.cefr);
      for (const b of l.vocabBands) expect(CEFR_LEVELS).toContain(b);
      expect(l.outputPrompts.length).toBeGreaterThan(0);
    }
  });
  it("falls back to default level", () => {
    expect(getLevel("unknown").id).toBe("eiken-2");
  });
});
