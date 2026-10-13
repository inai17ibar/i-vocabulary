import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type DB, migrate } from "./db.ts";

/** Node.js 組み込みの SQLite（node:sqlite）で開く。ローカル開発・テスト・CLI 用 */
export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const db: DB = {
    prepare: (sql) => raw.prepare(sql),
    exec: (sql) => raw.exec(sql),
    transaction<T>(fn: () => T): T {
      raw.exec("BEGIN");
      try {
        const result = fn();
        raw.exec("COMMIT");
        return result;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    canToggleForeignKeys: true,
    close: () => raw.close(),
  };
  migrate(db);
  return db;
}
