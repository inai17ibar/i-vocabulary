import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./seed.ts";

// リポジトリ直下の .env（git 管理外）があれば読む（ANTHROPIC_API_KEY など）
const envFile = resolve(DATA_DIR, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dbPath: process.env.DATABASE_PATH ?? resolve(DATA_DIR, "ivocab.db"),
  webDist: process.env.WEB_DIST ?? resolve(DATA_DIR, "../web/dist"),
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  phraseModel: process.env.PHRASE_MODEL,
};
