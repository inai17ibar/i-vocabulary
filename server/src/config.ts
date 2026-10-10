import { resolve } from "node:path";
import { DATA_DIR } from "./seed.ts";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dbPath: process.env.DATABASE_PATH ?? resolve(DATA_DIR, "ivocab.db"),
  webDist: process.env.WEB_DIST ?? resolve(DATA_DIR, "../web/dist"),
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : undefined,
};
