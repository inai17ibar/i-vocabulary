import { config } from "../config.ts";
import { openDb } from "../db-node.ts";
import { seedDatabase } from "../seed.ts";

const db = openDb(config.dbPath);
const r = seedDatabase(db);
console.log(`seeded ${r.words} words and ${r.expressionGroups} expression groups into ${config.dbPath}`);
