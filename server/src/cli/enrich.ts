/**
 * 外部辞書 (Datamuse + Free Dictionary API) で定義・発音・例文・類義語・対義語を補完
 *   npm run enrich -- [--limit 100] [--force]
 */
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { openDb } from "../db-node.ts";
import { datamuseProvider, enrichWords, freeDictionaryProvider } from "../services/importers.ts";

const { values } = parseArgs({ options: { limit: { type: "string", default: "100" }, force: { type: "boolean", default: false } } });
const db = openDb(config.dbPath);
const n = await enrichWords(db, [freeDictionaryProvider(), datamuseProvider()], {
  limit: Number(values.limit),
  force: values.force,
  delayMs: 300,
  log: console.log,
});
console.log(`enriched ${n} words`);
