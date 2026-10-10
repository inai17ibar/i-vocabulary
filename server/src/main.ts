import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { seedDatabase } from "./seed.ts";

const db = openDb(config.dbPath);
// 同梱データは冪等に upsert されるので、毎回流して更新（発音記号の追加など）を既存 DB にも反映する
const seeded = seedDatabase(db);
console.log(`seed data: ${seeded.words} words, ${seeded.expressionGroups} expression groups`);

const app = await buildApp({ db, webDist: config.webDist, logger: true, corsOrigins: config.corsOrigins });
await app.listen({ port: config.port, host: config.host });
