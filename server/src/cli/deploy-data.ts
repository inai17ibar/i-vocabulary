/**
 * ローカルの DB にある共有の単語データ（npm run wordlists / enrich:llm の結果）をデプロイ先に入れる
 *   npm run deploy:data                       # 本番（IVOCAB_DEPLOY_URL、未設定なら DEFAULT_URL）に送る
 *   npm run deploy:data -- --url http://localhost:8790   # 送り先を指定
 * 管理用トークンは IVOCAB_ADMIN_TOKEN（リポジトリ直下の .env にも書ける）。デプロイ先には
 * `npx wrangler secret put ADMIN_TOKEN` で同じ値を設定しておく。
 *
 * Cloudflare の無料枠は書き込みが 1 日 10 万行まで。途中で止まったら、翌日にもう一度実行すると続きから送る
 * （進み具合は data/external/deploy-progress.json に記録）。--restart で最初から送り直す。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { openDb } from "../db-node.ts";
import { DATA_DIR } from "../seed.ts";
import { parseTags } from "../services/vocab.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    batch: { type: "string", default: "200" },
    restart: { type: "boolean", default: false },
  },
});
/** 本番（docs/deploy.md） */
const DEFAULT_URL = "https://i-vocabulary.inai17ibar.workers.dev";
const ENV_FILE = resolve(DATA_DIR, "../.env");
if (!process.env.IVOCAB_ADMIN_TOKEN && existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const url = values.url ?? process.env.IVOCAB_DEPLOY_URL ?? DEFAULT_URL;
const token = process.env.IVOCAB_ADMIN_TOKEN;
if (!token) {
  console.error("IVOCAB_ADMIN_TOKEN が未設定です（.env に書くか環境変数で渡してください）");
  process.exit(1);
}

const base = url.replace(/\/+$/, "");
const PROGRESS = resolve(DATA_DIR, "external/deploy-progress.json");
mkdirSync(resolve(DATA_DIR, "external"), { recursive: true });
const progress: Record<string, number> = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, "utf8")) : {};
let lastId = values.restart ? 0 : (progress[base] ?? 0);

const db = openDb(config.dbPath);
type Row = { id: number; lemma: string; pos: string; cefr: string; meaning_ja: string; definition_en: string | null; ipa: string | null; frequency_rank: number | null; tags: string; source: string };
const total = (db.prepare("SELECT COUNT(*) AS n FROM words WHERE created_by IS NULL AND id > ?").get(lastId) as { n: number }).n;
console.log(`${base} に ${total} 語を送ります${lastId ? `（ID ${lastId} の続きから）` : ""}`);

const size = Number(values.batch);
let sent = 0;
for (;;) {
  const rows = db.prepare("SELECT * FROM words WHERE created_by IS NULL AND id > ? ORDER BY id LIMIT ?").all(lastId, size) as unknown as Row[];
  if (!rows.length) break;
  const words = rows.map((w) => ({
    lemma: w.lemma,
    pos: w.pos,
    cefr: w.cefr,
    meaningJa: w.meaning_ja,
    definitionEn: w.definition_en,
    ipa: w.ipa,
    frequencyRank: w.frequency_rank,
    tags: parseTags(w.tags),
    source: w.source,
    examples: (db.prepare("SELECT sentence AS en, translation_ja AS ja, attribution FROM examples WHERE word_id = ? ORDER BY id LIMIT 10").all(w.id) as { en: string; ja: string | null; attribution: string | null }[]),
    synonyms: db.prepare("SELECT related_lemma AS lemma, note FROM word_relations WHERE word_id = ? AND type = 'synonym' ORDER BY id LIMIT 20").all(w.id) as { lemma: string; note: string | null }[],
    antonyms: db.prepare("SELECT related_lemma AS lemma, note FROM word_relations WHERE word_id = ? AND type = 'antonym' ORDER BY id LIMIT 20").all(w.id) as { lemma: string; note: string | null }[],
  }));
  const res = await fetch(`${base}/api/v1/admin/words`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ words }),
  });
  if (!res.ok) {
    console.error(`\n送信に失敗しました（HTTP ${res.status}）: ${(await res.text()).slice(0, 300)}`);
    console.error("無料枠の書き込み上限に達した場合は、翌日（UTC 0 時以降）にもう一度実行すると続きから送ります");
    process.exit(1);
  }
  lastId = rows[rows.length - 1].id;
  progress[base] = lastId;
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 2));
  sent += rows.length;
  process.stdout.write(`\r${sent} / ${total}`);
}
console.log(`\n完了: ${sent} 語を送りました`);
