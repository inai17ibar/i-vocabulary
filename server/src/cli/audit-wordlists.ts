/** Read-only: no migrations, seeding, API requests, or environment/config loading. */
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { auditWordlists } from "../services/wordlist-audit.ts";

const { values } = parseArgs({ options: { database: { type: "string" } } });
if (!values.database) throw new Error("--database <existing SQLite file> is required (opened read-only)");
const path = resolve(process.env.INIT_CWD ?? process.cwd(), values.database);
const db = new DatabaseSync(path, { readOnly: true });
try {
  console.log(JSON.stringify({ database: path, auditedAt: new Date().toISOString(), ...auditWordlists(db) }, null, 2));
} finally {
  db.close();
}
