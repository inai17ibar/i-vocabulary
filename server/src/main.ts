import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { logger } from "hono/logger";
import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { openDb } from "./db-node.ts";
import { seedDatabase } from "./seed.ts";
import { createClaudePhraseSuggester } from "./services/llm-phrases.ts";

const db = openDb(config.dbPath);
// 同梱データは冪等に upsert されるので、毎回流して更新（発音記号の追加など）を既存 DB にも反映する
const seeded = seedDatabase(db);
console.log(`seed data: ${seeded.words} words, ${seeded.expressionGroups} expression groups`);

const app = buildApp({
  db,
  corsOrigins: config.corsOrigins,
  phrases: config.anthropicApiKey ? createClaudePhraseSuggester({ apiKey: config.anthropicApiKey, model: config.phraseModel }) : undefined,
});
if (!config.anthropicApiKey) console.log("ANTHROPIC_API_KEY が未設定のため、フレーズ帳の AI 提案は無効です");
app.use("*", logger());

// ビルド済みの Web クライアントを同じオリジンで配信する（SPA なので未知のパスは index.html）
if (existsSync(config.webDist)) {
  const indexHtml = readFileSync(resolve(config.webDist, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: relative(process.cwd(), config.webDist) }));
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not_found" }, 404) : c.html(indexHtml)));
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Server listening at http://${config.host}:${info.port}`);
});
