import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { ExamType, User } from "@ivocab/shared";
import { getLevel } from "@ivocab/shared";
import type { DB } from "../db.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 90;

export class AuthError extends Error {}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface UserRow {
  id: number;
  email: string;
  display_name: string;
  exam: ExamType;
  level_id: string;
  desired_retention: number;
  timezone: string;
  password_hash: string;
}

function toUser(r: UserRow): User {
  return { id: r.id, email: r.email, displayName: r.display_name, exam: r.exam, levelId: r.level_id, desiredRetention: r.desired_retention, timezone: r.timezone };
}

export async function register(db: DB, input: { email: string; password: string; displayName?: string; levelId?: string; timezone?: string }) {
  const email = input.email.trim().toLowerCase();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new AuthError("このメールアドレスは登録済みです");
  const level = getLevel(input.levelId ?? "");
  const r = db.prepare(
    "INSERT INTO users (email, password_hash, display_name, exam, level_id, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(email, await hashPassword(input.password), input.displayName?.trim() || email.split("@")[0], level.exam, level.id, input.timezone || "Asia/Tokyo", new Date().toISOString());
  const user = getUser(db, Number(r.lastInsertRowid));
  return { token: createSession(db, user.id), user };
}

export async function login(db: DB, email: string, password: string) {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new AuthError("メールアドレスまたはパスワードが違います");
  return { token: createSession(db, row.id), user: toUser(row) };
}

/** トークンはランダム 32 バイト。DB にはハッシュのみ保存（漏えい対策） */
export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), userId, now.toISOString(), expires.toISOString());
  return token;
}

export function userFromToken(db: DB, token: string): User | null {
  const row = db.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
  ).get(sha256(token), new Date().toISOString()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function logout(db: DB, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function getUser(db: DB, id: number): User {
  return toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow);
}

export function updateUser(db: DB, id: number, patch: { displayName?: string; levelId?: string; desiredRetention?: number; timezone?: string }): User {
  const cur = getUser(db, id);
  const level = patch.levelId ? getLevel(patch.levelId) : getLevel(cur.levelId);
  db.prepare("UPDATE users SET display_name = ?, level_id = ?, exam = ?, desired_retention = ?, timezone = ? WHERE id = ?").run(
    patch.displayName?.trim() || cur.displayName,
    level.id,
    level.exam,
    patch.desiredRetention ?? cur.desiredRetention,
    patch.timezone ?? cur.timezone,
    id,
  );
  return getUser(db, id);
}
