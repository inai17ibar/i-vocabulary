/**
 * データベースの抽象。サービス層はこのインターフェースだけを使うので、
 * Node.js（node:sqlite、db-node.ts）と Cloudflare Durable Objects の SQLite（db-do.ts）の両方で動く。
 * スキーマは素直な SQL なので、PostgreSQL などに移す場合も型を合わせればそのまま移植できる。
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface Statement {
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface DB {
  prepare(sql: string): Statement;
  /** 複数文をまとめて実行（結果は返さない） */
  exec(sql: string): void;
  /** fn を 1 トランザクションで実行。例外なら巻き戻す */
  transaction<T>(fn: () => T): T;
  /**
   * PRAGMA foreign_keys を切り替えられるか（テーブルを作り直すマイグレーション用）。
   * Durable Objects では使えないが、マイグレーションは空の DB に対して流れるので問題ない
   */
  readonly canToggleForeignKeys: boolean;
  close?(): void;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    exam TEXT NOT NULL DEFAULT 'eiken',
    level_id TEXT NOT NULL DEFAULT 'eiken-2',
    desired_retention REAL NOT NULL DEFAULT 0.9,
    timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE words (
    id INTEGER PRIMARY KEY,
    lemma TEXT NOT NULL,
    pos TEXT NOT NULL,
    cefr TEXT NOT NULL,
    meaning_ja TEXT NOT NULL DEFAULT '',
    definition_en TEXT,
    ipa TEXT,
    frequency_rank INTEGER,
    source TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
    enriched_at TEXT,
    UNIQUE (lemma, pos)
  );
  CREATE INDEX words_cefr ON words(cefr);
  CREATE TABLE examples (
    id INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    sentence TEXT NOT NULL,
    translation_ja TEXT,
    UNIQUE (word_id, sentence)
  );
  CREATE TABLE word_relations (
    id INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('synonym','antonym')),
    related_lemma TEXT NOT NULL,
    note TEXT,
    source TEXT NOT NULL,
    UNIQUE (word_id, type, related_lemma)
  );
  CREATE TABLE expression_groups (
    id INTEGER PRIMARY KEY,
    intent_ja TEXT NOT NULL UNIQUE,
    intent_en TEXT NOT NULL,
    scene TEXT NOT NULL,
    cefr TEXT NOT NULL
  );
  CREATE TABLE expressions (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES expression_groups(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    register TEXT NOT NULL CHECK (register IN ('casual','neutral','formal')),
    note TEXT,
    example TEXT,
    UNIQUE (group_id, text)
  );
  CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('word','expression')),
    item_id INTEGER NOT NULL,
    due TEXT NOT NULL,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    elapsed_days REAL NOT NULL DEFAULT 0,
    scheduled_days REAL NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state INTEGER NOT NULL DEFAULT 0,
    last_review TEXT,
    source TEXT NOT NULL DEFAULT 'level',
    created_at TEXT NOT NULL,
    UNIQUE (user_id, item_type, item_id)
  );
  CREATE INDEX cards_due ON cards(user_id, due);
  CREATE TABLE review_logs (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grade INTEGER NOT NULL,
    mode TEXT NOT NULL,
    state_before INTEGER NOT NULL,
    stability_after REAL NOT NULL,
    scheduled_days REAL NOT NULL,
    duration_ms INTEGER,
    reviewed_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    client_review_id TEXT,
    UNIQUE (user_id, client_review_id)
  );
  CREATE INDEX review_logs_user_date ON review_logs(user_id, local_date);
  CREATE TABLE cambly_lessons (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_date TEXT NOT NULL,
    tutor TEXT,
    topic TEXT,
    notes TEXT,
    transcript TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE lesson_targets (
    lesson_id INTEGER NOT NULL REFERENCES cambly_lessons(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (lesson_id, card_id)
  );
  `,
  // v2: 単語の一意性を「所有者ごと」にする。ユーザー追加語（レッスンの訂正など）が
  // 共有語や他ユーザーの語と同じ (lemma, pos) でも衝突・上書きしないように。
  // SQLite はテーブル制約を変更できないので作り直す（外部キーは一時的に無効化）
  `
  CREATE TABLE words_new (
    id INTEGER PRIMARY KEY,
    lemma TEXT NOT NULL,
    pos TEXT NOT NULL,
    cefr TEXT NOT NULL,
    meaning_ja TEXT NOT NULL DEFAULT '',
    definition_en TEXT,
    ipa TEXT,
    frequency_rank INTEGER,
    source TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
    enriched_at TEXT
  );
  INSERT INTO words_new SELECT id, lemma, pos, cefr, meaning_ja, definition_en, ipa, frequency_rank, source, created_by, enriched_at FROM words;
  DROP TABLE words;
  ALTER TABLE words_new RENAME TO words;
  CREATE INDEX words_cefr ON words(cefr);
  CREATE INDEX words_lemma ON words(lemma);
  CREATE UNIQUE INDEX words_lemma_pos_owner ON words(lemma, pos, IFNULL(created_by, 0));
  `,
  // v3: 学習記録の一覧（時刻順）とカードごとの履歴を引くための索引
  `
  CREATE INDEX IF NOT EXISTS review_logs_user_time ON review_logs(user_id, reviewed_at, id);
  CREATE INDEX IF NOT EXISTS review_logs_card ON review_logs(card_id, reviewed_at);
  `,
  // v4: 公開語彙リストの取り込み。単語の目印（spoken / academic、カンマ区切り）と例文の出典表示
  `
  ALTER TABLE words ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  ALTER TABLE examples ADD COLUMN attribution TEXT;
  `,
  // v5: 特定サービス名をやめた出どころの名前に揃える / AI 機能の 1 日あたりの利用回数（費用の上限）
  // v4 の ALTER TABLE は列があると失敗するので、ここから先も「足すだけ」の変更にする
  `
  UPDATE cards SET source = 'capture' WHERE source = 'cambly';
  UPDATE words SET source = 'capture' WHERE source = 'cambly';
  UPDATE words SET source = 'capture-correction' WHERE source = 'cambly-correction';
  CREATE TABLE IF NOT EXISTS llm_usage (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, local_date)
  );
  `,
];

/** 最新のスキーマバージョン */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** テーブルを作り直すマイグレーション（外部キー無効化が必要なもの） */
const REBUILD_MIGRATIONS = new Set([1]);

export function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    // PRAGMA foreign_keys はトランザクション外でしか切り替えられない
    const rebuild = REBUILD_MIGRATIONS.has(version) && db.canToggleForeignKeys;
    if (rebuild) db.exec("PRAGMA foreign_keys = OFF");
    try {
      tx(db, () => {
        db.exec(MIGRATIONS[version]);
        if (rebuild) {
          const broken = db.prepare("PRAGMA foreign_key_check").all();
          if (broken.length) throw new Error(`migration ${version + 1} left ${broken.length} broken foreign keys`);
        }
        db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
      });
    } finally {
      if (rebuild) db.exec("PRAGMA foreign_keys = ON");
    }
    version++;
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn);
}
