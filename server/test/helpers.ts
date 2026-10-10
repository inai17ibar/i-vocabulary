import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { seedDatabase } from "../src/seed.ts";

export async function setup() {
  const db = openDb(":memory:");
  seedDatabase(db);
  const app = await buildApp({ db });
  const reg = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: "a@example.com", password: "password123", levelId: "eiken-2" } });
  const { token, user } = reg.json();
  const call = async (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
    return { status: res.statusCode, body: res.json() };
  };
  return { db, app, token, user, call };
}
