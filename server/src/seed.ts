import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "./db.ts";
import { importSeedExpressions, importSeedWords, type SeedExpressionsFile, type SeedWordsFile } from "./services/vocab.ts";

export const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");

export function seedDatabase(db: DB) {
  const words = JSON.parse(readFileSync(resolve(DATA_DIR, "seed/words.json"), "utf8")) as SeedWordsFile;
  const exprs = JSON.parse(readFileSync(resolve(DATA_DIR, "seed/expressions.json"), "utf8")) as SeedExpressionsFile;
  return { words: importSeedWords(db, words), expressionGroups: importSeedExpressions(db, exprs) };
}

/** 単語が 1 つもなければシードを投入 */
export function seedIfEmpty(db: DB) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM words").get() as { n: number };
  return n === 0 ? seedDatabase(db) : null;
}
