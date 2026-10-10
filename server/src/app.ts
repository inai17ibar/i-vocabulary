import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { z, ZodError } from "zod";
import type { User } from "@ivocab/shared";
import { CEFR_LEVELS, LEVELS } from "@ivocab/shared";
import type { DB } from "./db.ts";
import { AuthError, login, logout, register, updateUser, userFromToken } from "./services/auth.ts";
import { deleteCard, ensureCard, listCards, NotFoundError, recordReview, toCardDto } from "./services/cards.ts";
import { addFromLesson, analyzeTranscript, createLesson, getLesson, listLessons, markTargetUsed, prepSheet, suggestTargets, updateLesson } from "./services/cambly.ts";
import { gradeFromQuiz } from "./services/srs.ts";
import { computeStats } from "./services/stats.ts";
import { buildSession, dailyTasks, TASK_KEYS } from "./services/study.ts";
import { getExpressionGroup, getWord, listExpressionGroups, searchWords } from "./services/vocab.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}

export interface AppOptions {
  db: DB;
  /** ビルド済み Web クライアントのディレクトリ（本番で同一オリジン配信する場合） */
  webDist?: string;
  logger?: boolean;
  corsOrigins?: string[];
}

const QUIZ_MODES = ["flashcard", "meaning", "synonym", "antonym", "cloze", "listening", "paraphrase"] as const;

export async function buildApp(opts: AppOptions) {
  const { db } = opts;
  const app = Fastify({ logger: opts.logger ?? false });
  // iOS アプリはネイティブ HTTP なので CORS 不要。Web の別オリジン開発用に許可
  await app.register(cors, { origin: opts.corsOrigins ?? true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: "validation_error", details: err.issues });
    if (err instanceof AuthError) return reply.status(401).send({ error: "auth_error", message: err.message });
    if (err instanceof NotFoundError) return reply.status(404).send({ error: "not_found", message: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: "error", message: status >= 500 ? "internal error" : (err as Error).message });
  });

  const requireUser = async (req: FastifyRequest, reply: FastifyReply) => {
    const m = (req.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
    const user = m ? userFromToken(db, m[1]) : null;
    if (!user) return reply.status(401).send({ error: "unauthorized" });
    req.user = user;
  };

  const idParam = z.object({ id: z.coerce.number().int().positive() });

  app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      api.get("/levels", async () => ({ levels: LEVELS, cefr: CEFR_LEVELS }));

      // ---- 認証 -------------------------------------------------------
      api.post("/auth/register", async (req) => {
        const body = z.object({
          email: z.string().email(),
          password: z.string().min(8),
          displayName: z.string().max(50).optional(),
          levelId: z.string().optional(),
          timezone: z.string().optional(),
        }).parse(req.body);
        return register(db, body);
      });
      api.post("/auth/login", async (req) => {
        const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
        return login(db, body.email, body.password);
      });

      api.register(async (authed) => {
        authed.addHook("preHandler", requireUser);

        authed.post("/auth/logout", async (req) => {
          logout(db, req.headers.authorization!.replace(/^Bearer\s+/i, ""));
          return { ok: true };
        });
        authed.get("/me", async (req) => ({ user: req.user }));
        authed.patch("/me", async (req) => {
          const body = z.object({
            displayName: z.string().max(50).optional(),
            levelId: z.enum(LEVELS.map((l) => l.id) as [string, ...string[]]).optional(),
            desiredRetention: z.number().min(0.7).max(0.97).optional(),
            timezone: z.string().optional(),
          }).parse(req.body);
          return { user: updateUser(db, req.user.id, body) };
        });

        // ---- 語彙 -----------------------------------------------------
        authed.get("/words", async (req) => {
          const q = z.object({
            q: z.string().optional(),
            cefr: z.enum(CEFR_LEVELS).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          }).parse(req.query);
          return searchWords(db, { ...q, userId: req.user.id });
        });
        authed.get("/words/:id", async (req) => {
          const { id } = idParam.parse(req.params);
          const w = getWord(db, id);
          if (!w) throw new NotFoundError("word not found");
          return { word: w };
        });
        authed.get("/expressions", async () => ({ groups: listExpressionGroups(db) }));
        authed.get("/expressions/:id", async (req) => {
          const { id } = idParam.parse(req.params);
          const g = getExpressionGroup(db, id);
          if (!g) throw new NotFoundError("expression group not found");
          return { group: g };
        });

        // ---- カード / 復習 --------------------------------------------
        authed.get("/cards", async (req) => {
          const q = z.object({
            itemType: z.enum(["word", "expression"]).optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
            offset: z.coerce.number().int().min(0).default(0),
          }).parse(req.query);
          return { cards: listCards(db, req.user, q) };
        });
        authed.post("/cards", async (req) => {
          const body = z.object({ itemType: z.enum(["word", "expression"]), itemId: z.number().int().positive() }).parse(req.body);
          const exists = body.itemType === "word" ? getWord(db, body.itemId) : getExpressionGroup(db, body.itemId);
          if (!exists) throw new NotFoundError("item not found");
          const row = ensureCard(db, req.user.id, body.itemType, body.itemId, "manual");
          return { card: toCardDto(db, row, new Date(), req.user.desiredRetention) };
        });
        authed.delete("/cards/:id", async (req) => {
          deleteCard(db, req.user.id, idParam.parse(req.params).id);
          return { ok: true };
        });

        authed.get("/tasks/today", async (req) => dailyTasks(db, req.user));
        authed.get("/study/session", async (req) => {
          const q = z.object({ task: z.enum(TASK_KEYS as [string, ...string[]]), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
          return buildSession(db, req.user, q.task as (typeof TASK_KEYS)[number], { limit: q.limit });
        });

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
        authed.post("/reviews", async (req) => applyReview(req.user, reviewSchema.parse(req.body)));
        // オフラインで溜めた回答をまとめて送る（iOS 用）。時刻順に適用
        authed.post("/reviews/batch", async (req) => {
          const { reviews } = z.object({ reviews: z.array(reviewSchema).max(500) }).parse(req.body);
          const sorted = [...reviews].sort((a, b) => (a.reviewedAt ?? "").localeCompare(b.reviewedAt ?? ""));
          const results = sorted.map((r) => {
            try {
              return { clientReviewId: r.clientReviewId ?? null, ok: true as const, result: applyReview(req.user, r) };
            } catch (e) {
              return { clientReviewId: r.clientReviewId ?? null, ok: false as const, error: (e as Error).message };
            }
          });
          return { results };
        });

        authed.get("/stats", async (req) => computeStats(db, req.user));

        // ---- Cambly 連携 ----------------------------------------------
        authed.post("/cambly/analyze", async (req) => {
          const { text } = z.object({ text: z.string().max(200_000) }).parse(req.body);
          return analyzeTranscript(db, req.user, text);
        });
        authed.post("/cambly/cards", async (req) => {
          const body = z.object({
            wordIds: z.array(z.number().int()).optional(),
            groupIds: z.array(z.number().int()).optional(),
            customWords: z.array(z.object({ lemma: z.string().min(1).max(100), meaningJa: z.string().max(200), pos: z.string().optional(), example: z.string().max(500).optional() })).optional(),
            corrections: z.array(z.object({ original: z.string().max(500), better: z.string().min(1).max(500) })).optional(),
          }).parse(req.body);
          const rows = addFromLesson(db, req.user, body);
          return { cards: rows.map((r) => toCardDto(db, r, new Date(), req.user.desiredRetention)) };
        });
        authed.get("/cambly/suggestions", async (req) => ({ targets: suggestTargets(db, req.user) }));
        authed.get("/cambly/lessons", async (req) => ({ lessons: listLessons(db, req.user.id) }));
        const lessonSchema = z.object({
          lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          tutor: z.string().max(100).nullable().optional(),
          topic: z.string().max(200).nullable().optional(),
          notes: z.string().max(20_000).nullable().optional(),
          transcript: z.string().max(200_000).nullable().optional(),
          targetCardIds: z.array(z.number().int()).max(30).optional(),
        });
        authed.post("/cambly/lessons", async (req) => {
          const lesson = createLesson(db, req.user, lessonSchema.parse(req.body));
          return { lesson, prepSheet: prepSheet(db, lesson) };
        });
        authed.get("/cambly/lessons/:id", async (req) => {
          const lesson = getLesson(db, req.user.id, idParam.parse(req.params).id);
          return { lesson, prepSheet: prepSheet(db, lesson) };
        });
        authed.patch("/cambly/lessons/:id", async (req) => {
          const lesson = updateLesson(db, req.user, idParam.parse(req.params).id, lessonSchema.partial().parse(req.body));
          return { lesson, prepSheet: prepSheet(db, lesson) };
        });
        authed.put("/cambly/lessons/:id/targets/:cardId", async (req) => {
          const { id, cardId } = z.object({ id: z.coerce.number().int(), cardId: z.coerce.number().int() }).parse(req.params);
          const { used } = z.object({ used: z.boolean() }).parse(req.body);
          return { lesson: markTargetUsed(db, req.user, id, cardId, used) };
        });
      });
    },
    { prefix: "/api/v1" },
  );

  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
