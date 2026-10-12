import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db-node.ts";
import { seedDatabase } from "../src/seed.ts";

/** テストから API を叩く（Fastify の inject と同じ形で呼べるようにしている） */
function injector(app: ReturnType<typeof buildApp>) {
  return async (req: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) => {
    const res = await app.request(req.url, {
      method: req.method,
      headers: { ...(req.payload !== undefined ? { "content-type": "application/json" } : {}), ...req.headers },
      body: req.payload !== undefined ? JSON.stringify(req.payload) : undefined,
    });
    const text = await res.text();
    return { statusCode: res.status, json: () => JSON.parse(text) };
  };
}

export async function setup(opts: Omit<Parameters<typeof buildApp>[0], "db"> = {}) {
  const db = openDb(":memory:");
  seedDatabase(db);
  const app = { inject: injector(buildApp({ db, logError: () => {}, ...opts })) };
  const reg = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: "a@example.com", password: "password123", levelId: "eiken-2" } });
  const { token, user } = reg.json();
  const call = async (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    return { status: res.statusCode, body: res.json() };
  };
  return { db, app, token, user, call };
}
