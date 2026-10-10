import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { seedIfEmpty } from "./seed.ts";

const db = openDb(config.dbPath);
const seeded = seedIfEmpty(db);
if (seeded) console.log(`seeded ${seeded.words} words, ${seeded.expressionGroups} expression groups`);

const app = await buildApp({ db, webDist: config.webDist, logger: true, corsOrigins: config.corsOrigins });
await app.listen({ port: config.port, host: config.host });
