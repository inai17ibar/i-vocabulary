/**
 * Cloudflare Workers のエントリ。
 *  - /api/* は Durable Object（AppDurableObject）に渡す。SQLite の DB はこの Durable Object の中にある
 *  - それ以外は Static Assets（web/dist）が配信する（wrangler.jsonc の assets 設定。SPA なので未知のパスは index.html）
 *
 * 利用者が少ないうちは Durable Object 1 つ（"main"）で全リクエストを処理する（1 オブジェクトあたり約 1,000 req/s が目安）。
 * 増えてきたらユーザーごとの Durable Object に分ける。
 */
import { DurableObject } from "cloudflare:workers";
import seedWords from "../../data/seed/words.json";
import seedExpressions from "../../data/seed/expressions.json";
import { buildApp } from "./app.ts";
import { migrate } from "./db.ts";
import { fromDurableObjectStorage } from "./db-do.ts";
import { createClaudePhraseSuggester } from "./services/llm-phrases.ts";
import { importSeedExpressions, importSeedWords, type SeedExpressionsFile, type SeedWordsFile } from "./services/vocab.ts";

export interface Env {
  APP: DurableObjectNamespace<AppDurableObject>;
  /** 単語データの一括投入用（wrangler secret put ADMIN_TOKEN） */
  ADMIN_TOKEN?: string;
  /** 許可するオリジン（カンマ区切り）。未設定ならリクエストのオリジンを許可 */
  CORS_ORIGINS?: string;
  /** フレーズ帳の AI 提案（wrangler secret put ANTHROPIC_API_KEY） */
  ANTHROPIC_API_KEY?: string;
  /** 提案に使うモデル（既定 claude-opus-5-5） */
  PHRASE_MODEL?: string;
  /** 1 人 1 日あたりの AI 提案の上限（既定 30） */
  PHRASE_DAILY_LIMIT?: string;
}

/** 同梱データの内容が変わったときだけ入れ直す（毎回 upsert すると無料枠の書き込み行数を使ってしまうため） */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

export class AppDurableObject extends DurableObject<Env> {
  private app: ReturnType<typeof buildApp>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = fromDurableObjectStorage(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      migrate(db);
      db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      const seedHash = fingerprint(JSON.stringify([seedWords, seedExpressions]));
      const current = db.prepare("SELECT value FROM app_meta WHERE key = 'seed'").get() as { value: string } | undefined;
      if (current?.value !== seedHash) {
        importSeedWords(db, seedWords as unknown as SeedWordsFile);
        importSeedExpressions(db, seedExpressions as unknown as SeedExpressionsFile);
        db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed', ?)").run(seedHash);
      }
    });
    this.app = buildApp({
      db,
      corsOrigins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(",") : undefined,
      adminToken: env.ADMIN_TOKEN,
      phrases: env.ANTHROPIC_API_KEY ? createClaudePhraseSuggester({ apiKey: env.ANTHROPIC_API_KEY, model: env.PHRASE_MODEL }) : undefined,
      phraseDailyLimit: env.PHRASE_DAILY_LIMIT ? Number(env.PHRASE_DAILY_LIMIT) : undefined,
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.APP.getByName("main").fetch(request);
  },
} satisfies ExportedHandler<Env>;
