/**
 * 単語リストの取り込み
 *   npm run import:words -- --file path/to/list.csv [--preset generic|ngsl|cefrj] [--source NAME] [--cefr B1]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isCefr } from "@ivocab/shared";
import { config } from "../config.ts";
import { openDb } from "../db.ts";
import { importRows, parseCsv, type Preset } from "../services/importers.ts";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    preset: { type: "string", default: "generic" },
    source: { type: "string" },
    cefr: { type: "string" },
  },
});
if (!values.file) {
  console.error("usage: npm run import:words -- --file list.csv [--preset generic|ngsl|cefrj] [--source NAME] [--cefr B1]");
  process.exit(1);
}
const preset = values.preset as Preset;
if (!["generic", "ngsl", "cefrj"].includes(preset)) throw new Error(`unknown preset ${preset}`);
const cefr = values.cefr?.toUpperCase();
const db = openDb(config.dbPath);
// npm workspaces は server/ で実行されるので、呼び出し元のディレクトリ基準で解決する
const file = resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
const rows = parseCsv(readFileSync(file, "utf8"));
const r = importRows(db, rows, { preset, source: values.source ?? preset, defaultCefr: isCefr(cefr) ? cefr : undefined });
console.log(`imported ${r.imported} rows, skipped ${r.skipped}`);
