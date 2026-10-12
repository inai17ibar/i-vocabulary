import type { DB, SqlValue } from "./db.ts";

/**
 * Cloudflare Durable Objects の SQLite（ctx.storage.sql）を DB インターフェースで包む。
 *  - トランザクションは BEGIN/COMMIT が使えないので transactionSync を使う
 *  - 変更件数と最後の rowid は SQLite の changes() / last_insert_rowid() で取る（同じ接続なので直前の文の値）
 *  - カーソルは await をまたぐとスナップショットが保証されないので、その場で読み切る
 */
export function fromDurableObjectStorage(storage: DurableObjectStorage): DB {
  const sql = storage.sql;
  const bind = (params: SqlValue[]) => params.map((v) => (v === undefined ? null : typeof v === "bigint" ? Number(v) : v)) as SqlStorageValue[];
  return {
    prepare(query) {
      return {
        get: (...p) => sql.exec(query, ...bind(p)).toArray()[0],
        all: (...p) => sql.exec(query, ...bind(p)).toArray(),
        run: (...p) => {
          sql.exec(query, ...bind(p)).toArray();
          const r = sql.exec<{ changes: number; id: number }>("SELECT changes() AS changes, last_insert_rowid() AS id").one();
          return { changes: r.changes, lastInsertRowid: r.id };
        },
      };
    },
    exec(query) {
      sql.exec(query).toArray();
    },
    transaction: (fn) => storage.transactionSync(fn),
    canToggleForeignKeys: false,
  };
}
