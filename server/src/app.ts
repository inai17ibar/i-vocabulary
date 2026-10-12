import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import type { User } from "@ivocab/shared";
import { CEFR_LEVELS, DATA_SOURCES, DERIVED_DATA_NOTICE, LEVELS } from "@ivocab/shared";
import type { DB } from "./db.ts";
import { AuthError, PasswordMismatchError, deleteAccount, login, logout, register, updateUser, userFromToken } from "./services/auth.ts";
import { deleteCard, ensureCard, listCards, NotFoundError, recordReview, toCardDto } from "./services/cards.ts";
import { addFromLesson, analyzeTranscript, createLesson, getLesson, listLessons, markTargetUsed, prepSheet, suggestTargets, updateLesson } from "./services/lessons.ts";
import { gradeFromQuiz } from "./services/srs.ts";
import { AiUnavailableError, listPhrases, type PhraseSuggester, RateLimitError, savePhrase, suggestPhrases } from "./services/phrasebook.ts";
import { cardDetail, history, listReviewLogs, schedule } from "./services/history.ts";
import { computeStats } from "./services/stats.ts";
import { buildSession, dailyTasks, TASK_KEYS } from "./services/study.ts";
import { canSeeWord, getExpressionGroup, getWord, listExpressionGroups, searchWords, upsertWord } from "./services/vocab.ts";
import { tx } from "./db.ts";

/**
 * REST API（/api/v1）。Hono で書いているので Node.js（main.ts）と Cloudflare Workers（worker.ts）の両方で動く。
 * Web クライアントの配信は実行環境側（Node は serve-static、Workers は Static Assets）が受け持つ
 */
export interface AppOptions {
  db: DB;
  /** 許可するオリジン。未指定ならリクエストのオリジンをそのまま許可（iOS アプリ・別オリジンの開発サーバー用） */
  corsOrigins?: string[];
  /** 5xx の詳細を出す先 */
  logError?: (err: unknown) => void;
  /** 設定すると POST /admin/words（単語データの一括投入）を有効にする。Bearer にこの値が必要 */
  adminToken?: string;
  /** 「言えなかった」フレーズ帳の AI 提案。未設定なら提案 API は 503 */
  phrases?: PhraseSuggester;
  /** 1 人 1 日あたりの AI 提案の上限 */
  phraseDailyLimit?: number;
}

type AppEnv = { Variables: { user: User } };

/** 不正な JSON 本文は 400 にする */
class BadRequestError extends Error {}

const QUIZ_MODES = ["flashcard", "meaning", "synonym", "antonym", "cloze", "listening", "paraphrase"] as const;

export function buildApp(opts: AppOptions) {
  const { db } = opts;
  const app = new Hono<AppEnv>();
  app.use("/api/*", cors({
    origin: opts.corsOrigins ?? ((origin) => origin),
    allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    allowHeaders: ["content-type", "authorization"],
  }));

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: "validation_error", details: err.issues }, 400);
    if (err instanceof BadRequestError) return c.json({ error: "bad_request", message: err.message }, 400);
    if (err instanceof AuthError) return c.json({ error: "auth_error", message: err.message }, 401);
    if (err instanceof PasswordMismatchError) return c.json({ error: "password_mismatch", message: err.message }, 403);
    if (err instanceof NotFoundError) return c.json({ error: "not_found", message: err.message }, 404);
    if (err instanceof RateLimitError) return c.json({ error: "rate_limited", message: err.message }, 429);
    if (err instanceof AiUnavailableError) return c.json({ error: "ai_unavailable", message: err.message }, 503);
    (opts.logError ?? console.error)(err);
    return c.json({ error: "error", message: "internal error" }, 500);
  });

  /** ハンドラの戻り値を JSON で返す */
  const json = (fn: (c: Context<AppEnv>) => unknown) => async (c: Context<AppEnv>) => c.json((await fn(c)) as object);
  const readBody = async (c: Context<AppEnv>): Promise<unknown> => {
    const text = await c.req.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new BadRequestError("invalid JSON body");
    }
  };
  const query = (c: Context<AppEnv>) => c.req.query();
  const params = (c: Context<AppEnv>) => c.req.param();

  const idParam = z.object({ id: z.coerce.number().int().positive() });

  const api = new Hono<AppEnv>();
  {
      api.get("/health", json(() => ({ ok: true })));
      api.get("/levels", json(async (c) => ({ levels: LEVELS, cefr: CEFR_LEVELS })));
      api.get("/credits", json(async (c) => ({ sources: DATA_SOURCES, notice: DERIVED_DATA_NOTICE })));

      // ---- 管理: ローカルで作った単語データ（npm run wordlists / enrich:llm）をクラウドの DB に入れる ----
      if (opts.adminToken) {
        const digest = (v: string) => createHash("sha256").update(v).digest();
        const expected = digest(`Bearer ${opts.adminToken}`);
        const relation = z.object({ lemma: z.string().min(1).max(100), note: z.string().max(200).nullable().optional() });
        const wordSchema = z.object({
          lemma: z.string().min(1).max(100),
          pos: z.string().max(20),
          cefr: z.enum(CEFR_LEVELS),
          meaningJa: z.string().max(200),
          definitionEn: z.string().max(1000).nullable().optional(),
          ipa: z.string().max(100).nullable().optional(),
          frequencyRank: z.number().int().nullable().optional(),
          tags: z.array(z.enum(["spoken", "academic"])).optional(),
          source: z.string().max(30),
          examples: z.array(z.object({ en: z.string().max(500), ja: z.string().max(500).nullable(), attribution: z.string().max(200).nullable().optional() })).max(10),
          synonyms: z.array(relation).max(20),
          antonyms: z.array(relation).max(20),
        });
        api.post("/admin/words", json(async (c) => {
          if (!timingSafeEqual(digest(c.req.header("authorization") ?? ""), expected)) throw new AuthError("admin token required");
          const { words } = z.object({ words: z.array(wordSchema).max(500) }).parse(await readBody(c));
          tx(db, () => {
            for (const w of words) upsertWord(db, { ...w, createdBy: null });
          });
          return { imported: words.length };
        }));
      }

      // ---- 認証 -------------------------------------------------------
      api.post("/auth/register", json(async (c) => {
        const body = z.object({
          email: z.string().email(),
          password: z.string().min(8),
          displayName: z.string().max(50).optional(),
          levelId: z.string().optional(),
          timezone: z.string().optional(),
        }).parse(await readBody(c));
        return register(db, body);
      }));
      api.post("/auth/login", json(async (c) => {
        const body = z.object({ email: z.string(), password: z.string() }).parse(await readBody(c));
        return login(db, body.email, body.password);
      }));

      const authed = new Hono<AppEnv>();
      authed.use("*", async (c, next) => {
        const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
        const user = m ? userFromToken(db, m[1]) : null;
        if (!user) return c.json({ error: "unauthorized" }, 401);
        c.set("user", user);
        await next();
      });

        authed.post("/auth/logout", json(async (c) => {
          logout(db, (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""));
          return { ok: true };
        }));
        authed.get("/me", json(async (c) => ({ user: c.get("user") })));
        authed.delete("/me", json(async (c) => {
          const { password } = z.object({ password: z.string() }).parse(await readBody(c));
          await deleteAccount(db, c.get("user").id, password);
          return { ok: true };
        }));
        authed.patch("/me", json(async (c) => {
          const body = z.object({
            displayName: z.string().max(50).optional(),
            levelId: z.enum(LEVELS.map((l) => l.id) as [string, ...string[]]).optional(),
            desiredRetention: z.number().min(0.7).max(0.97).optional(),
            timezone: z.string().optional(),
          }).parse(await readBody(c));
          return { user: updateUser(db, c.get("user").id, body) };
        }));

        // ---- 語彙 -----------------------------------------------------
        authed.get("/words", json(async (c) => {
          const q = z.object({
            q: z.string().optional(),
            cefr: z.enum(CEFR_LEVELS).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          }).parse(query(c));
          return searchWords(db, { ...q, userId: c.get("user").id });
        }));
        authed.get("/words/:id", json(async (c) => {
          const { id } = idParam.parse(params(c));
          const w = canSeeWord(db, id, c.get("user").id) ? getWord(db, id) : null;
          if (!w) throw new NotFoundError("word not found");
          return { word: w };
        }));
        authed.get("/expressions", json(async (c) => ({ groups: listExpressionGroups(db) })));
        authed.get("/expressions/:id", json(async (c) => {
          const { id } = idParam.parse(params(c));
          const g = getExpressionGroup(db, id);
          if (!g) throw new NotFoundError("expression group not found");
          return { group: g };
        }));

        // ---- カード / 復習 --------------------------------------------
        authed.get("/cards", json(async (c) => {
          const q = z.object({
            itemType: z.enum(["word", "expression"]).optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
            offset: z.coerce.number().int().min(0).default(0),
          }).parse(query(c));
          return { cards: listCards(db, c.get("user"), q) };
        }));
        authed.post("/cards", json(async (c) => {
          const body = z.object({ itemType: z.enum(["word", "expression"]), itemId: z.number().int().positive() }).parse(await readBody(c));
          const exists = body.itemType === "word" ? canSeeWord(db, body.itemId, c.get("user").id) : getExpressionGroup(db, body.itemId);
          if (!exists) throw new NotFoundError("item not found");
          const row = ensureCard(db, c.get("user").id, body.itemType, body.itemId, "manual");
          return { card: toCardDto(db, row, new Date(), c.get("user").desiredRetention) };
        }));
        authed.get("/cards/:id", json(async (c) => cardDetail(db, c.get("user"), idParam.parse(params(c)).id)));
        authed.delete("/cards/:id", json(async (c) => {
          deleteCard(db, c.get("user").id, idParam.parse(params(c)).id);
          return { ok: true };
        }));

        authed.get("/tasks/today", json(async (c) => dailyTasks(db, c.get("user"))));
        authed.get("/study/session", json(async (c) => {
          const q = z.object({ task: z.enum(TASK_KEYS as [string, ...string[]]), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(query(c));
          return buildSession(db, c.get("user"), q.task as (typeof TASK_KEYS)[number], { limit: q.limit });
        }));

        const reviewSchema = z.object({
          cardId: z.number().int().positive(),
          grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
          correct: z.boolean().optional(),
          mode: z.enum(QUIZ_MODES),
          durationMs: z.number().int().min(0).max(3_600_000).optional(),
          reviewedAt: z.string().datetime().optional(),
          clientReviewId: z.string().max(100).optional(),
        }).refine((r) => r.grade !== undefined || r.correct !== undefined, "grade or correct is required");
        const applyReview = (user: User, r: z.infer<typeof reviewSchema>) =>
          recordReview(db, user, {
            cardId: r.cardId,
            grade: r.grade ?? gradeFromQuiz(r.correct!, r.durationMs),
            mode: r.mode,
            durationMs: r.durationMs,
            reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : undefined,
            clientReviewId: r.clientReviewId,
          });
        authed.post("/reviews", json(async (c) => applyReview(c.get("user"), reviewSchema.parse(await readBody(c)))));
        // オフラインで溜めた回答をまとめて送る（iOS 用）。時刻順に適用
        authed.post("/reviews/batch", json(async (c) => {
          const { reviews } = z.object({ reviews: z.array(reviewSchema).max(500) }).parse(await readBody(c));
          const sorted = [...reviews].sort((a, b) => (a.reviewedAt ?? "").localeCompare(b.reviewedAt ?? ""));
          const results = sorted.map((r) => {
            try {
              return { clientReviewId: r.clientReviewId ?? null, ok: true as const, result: applyReview(c.get("user"), r) };
            } catch (e) {
              return { clientReviewId: r.clientReviewId ?? null, ok: false as const, error: (e as Error).message };
            }
          });
          return { results };
        }));

        authed.get("/stats", json(async (c) => computeStats(db, c.get("user"))));

        // ---- 学習記録・予定 --------------------------------------------
        const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
        authed.get("/reviews", json(async (c) => {
          const q = z.object({
            date: isoDate.optional(),
            from: isoDate.optional(),
            to: isoDate.optional(),
            cardId: z.coerce.number().int().positive().optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            before: z.coerce.number().int().positive().optional(),
          }).parse(query(c));
          return listReviewLogs(db, c.get("user"), q);
        }));
        authed.get("/history", json(async (c) => {
          const q = z.object({ from: isoDate.optional(), to: isoDate.optional() })
            .refine((r) => !r.from || !r.to || r.from <= r.to, "from must be on or before to")
            .refine((r) => !r.from || !r.to || (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 < 366, "range must be within 366 days")
            .parse(query(c));
          return history(db, c.get("user"), q);
        }));
        authed.get("/schedule", json(async (c) => {
          const q = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).parse(query(c));
          return schedule(db, c.get("user"), q);
        }));

        // ---- 「言えなかった」フレーズ帳 ----------------------------------
        const registerSchema = z.enum(["casual", "neutral", "formal"]);
        const example = z.object({ en: z.string().min(1).max(300), ja: z.string().max(300) }).nullable();
        authed.post("/phrases/suggest", json(async (c) => {
          const input = z.object({ text: z.string().trim().min(1).max(500), context: z.string().trim().max(200).optional() }).parse(await readBody(c));
          return suggestPhrases(db, c.get("user"), opts.phrases, input, { dailyLimit: opts.phraseDailyLimit });
        }));
        authed.post("/phrases", json(async (c) => {
          const input = z.object({
            intentJa: z.string().trim().min(1).max(80),
            chosen: z.object({ text: z.string().trim().min(1).max(200), register: registerSchema, noteJa: z.string().max(100), example }),
            alternatives: z.array(z.object({ text: z.string().trim().min(1).max(200), register: registerSchema, noteJa: z.string().max(100) })).max(5),
          }).parse(await readBody(c));
          const { word, card } = savePhrase(db, c.get("user"), input);
          return { word, card: toCardDto(db, card, new Date(), c.get("user").desiredRetention) };
        }));
        authed.get("/phrases", json(async (c) => ({ phrases: listPhrases(db, c.get("user")) })));

        // ---- 英文から学ぶ・英会話レッスン ------------------------------
        authed.post("/capture/analyze", json(async (c) => {
          const { text } = z.object({ text: z.string().max(200_000) }).parse(await readBody(c));
          return analyzeTranscript(db, c.get("user"), text);
        }));
        authed.post("/capture/cards", json(async (c) => {
          const body = z.object({
            wordIds: z.array(z.number().int()).optional(),
            groupIds: z.array(z.number().int()).optional(),
            customWords: z.array(z.object({ lemma: z.string().min(1).max(100), meaningJa: z.string().max(200), pos: z.string().optional(), example: z.string().max(500).optional() })).optional(),
            corrections: z.array(z.object({ original: z.string().max(500), better: z.string().min(1).max(500) })).optional(),
          }).parse(await readBody(c));
          const rows = addFromLesson(db, c.get("user"), body);
          return { cards: rows.map((r) => toCardDto(db, r, new Date(), c.get("user").desiredRetention)) };
        }));
        authed.get("/lessons/suggestions", json(async (c) => ({ targets: suggestTargets(db, c.get("user")) })));
        authed.get("/lessons", json(async (c) => ({ lessons: listLessons(db, c.get("user").id) })));
        const lessonSchema = z.object({
          lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          tutor: z.string().max(100).nullable().optional(),
          topic: z.string().max(200).nullable().optional(),
          notes: z.string().max(20_000).nullable().optional(),
          transcript: z.string().max(200_000).nullable().optional(),
          targetCardIds: z.array(z.number().int()).max(30).optional(),
        });
        authed.post("/lessons", json(async (c) => {
          const lesson = createLesson(db, c.get("user"), lessonSchema.parse(await readBody(c)));
          return { lesson, prepSheet: prepSheet(db, lesson) };
        }));
        authed.get("/lessons/:id", json(async (c) => {
          const lesson = getLesson(db, c.get("user").id, idParam.parse(params(c)).id);
          return { lesson, prepSheet: prepSheet(db, lesson) };
        }));
        authed.patch("/lessons/:id", json(async (c) => {
          const lesson = updateLesson(db, c.get("user"), idParam.parse(params(c)).id, lessonSchema.partial().parse(await readBody(c)));
          return { lesson, prepSheet: prepSheet(db, lesson) };
        }));
        authed.put("/lessons/:id/targets/:cardId", json(async (c) => {
          const { id, cardId } = z.object({ id: z.coerce.number().int(), cardId: z.coerce.number().int() }).parse(params(c));
          const { used } = z.object({ used: z.boolean() }).parse(await readBody(c));
          return { lesson: markTargetUsed(db, c.get("user"), id, cardId, used) };
        }));
      api.route("/", authed);
  }
  app.route("/api/v1", api);
  return app;
}
