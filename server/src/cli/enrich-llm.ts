/**
 * Claude で日本語訳・例文・類義語・対義語を生成して記録し、DB に反映する（docs/word-sources.md）
 *   npm run enrich:llm -- pilot --limit 40      # 少数を同期 API で生成（品質と単価の確認）
 *   npm run enrich:llm -- batch [--limit N]     # 残り全部を Batch API（半額）で生成。完了まで待って反映する
 *   npm run enrich:llm -- collect               # 中断した batch の結果を回収して反映する
 *   npm run enrich:llm -- apply                 # 記録済みの結果を DB に反映するだけ（API は呼ばない・無料）
 * オプション: --model claude-opus-5-5 / --cefr B1,B2
 *
 * 生成結果は data/generated/llm-words.jsonl に追記する（git 管理。再生成しないで済むように）。
 * API キーは ANTHROPIC_API_KEY（リポジトリ直下の .env にも書ける。.env は git 管理外）。
 */
import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Cefr, isCefr } from "@ivocab/shared";
import { config } from "../config.ts";
import { openDb } from "../db-node.ts";
import { DATA_DIR } from "../seed.ts";
import {
  applyGenerated, buildParams, costUsd, DEFAULT_MODEL, type GeneratedEntry, keyOf, parseEntries, parseGeneratedFile, selectTargets, type TargetWord, WORDS_PER_REQUEST,
} from "../services/llm-enrich.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string" },
    model: { type: "string", default: DEFAULT_MODEL },
    cefr: { type: "string" },
  },
});
const command = positionals[0] ?? "";
if (!["pilot", "batch", "collect", "apply"].includes(command)) {
  console.error("usage: npm run enrich:llm -- pilot|batch|collect|apply [--limit N] [--model ID] [--cefr B1,B2]");
  process.exit(1);
}

const ENV_FILE = resolve(DATA_DIR, "../.env");
if (!process.env.ANTHROPIC_API_KEY && existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const GENERATED = resolve(DATA_DIR, "generated/llm-words.jsonl");
const BATCH_STATE = resolve(DATA_DIR, "external/llm-batches.json");
mkdirSync(resolve(DATA_DIR, "generated"), { recursive: true });
mkdirSync(resolve(DATA_DIR, "external"), { recursive: true });

const db = openDb(config.dbPath);
const readGenerated = () => (existsSync(GENERATED) ? parseGeneratedFile(readFileSync(GENERATED, "utf8")) : []);
const record = (entries: GeneratedEntry[]) => {
  if (entries.length) appendFileSync(GENERATED, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
};
const applyAll = () => {
  const r = applyGenerated(db, readGenerated());
  console.log(`DB に反映: ${r.applied} 語${r.missing ? `（DB にない語 ${r.missing}。先に npm run wordlists を実行）` : ""}`);
};
const chunks = (words: TargetWord[]) => Array.from({ length: Math.ceil(words.length / WORDS_PER_REQUEST) }, (_, i) => words.slice(i * WORDS_PER_REQUEST, (i + 1) * WORDS_PER_REQUEST));
const report = (model: string, usage: { input: number; output: number }, batch: boolean, words: number) => {
  const usd = costUsd(model, usage, batch);
  const per = usd !== null && words ? usd / words : null;
  console.log(`トークン: 入力 ${usage.input.toLocaleString()} / 出力 ${usage.output.toLocaleString()}${usd !== null ? ` → 約 $${usd.toFixed(3)}` : ""}`);
  if (per !== null) {
    const remaining = selectTargets(db, new Set(readGenerated().map(keyOf))).length;
    console.log(`1 語あたり約 $${per.toFixed(5)}（${batch ? "Batch" : "同期 API"}）。残り ${remaining} 語を Batch API で生成すると約 $${((batch ? per : per / 2) * remaining).toFixed(2)}`);
  }
};

const cefr = values.cefr?.split(",").map((c) => c.trim().toUpperCase()).filter(isCefr) as Cefr[] | undefined;
const done = new Set(readGenerated().map(keyOf));

if (command === "apply") {
  applyAll();
} else if (command === "pilot") {
  const words = selectTargets(db, done, { limit: Number(values.limit ?? 40), cefr });
  const client = new Anthropic();
  const usage = { input: 0, output: 0 };
  let generated: GeneratedEntry[] = [];
  for (const chunk of chunks(words)) {
    const msg = await client.messages.create(buildParams(chunk, values.model!));
    usage.input += msg.usage.input_tokens;
    usage.output += msg.usage.output_tokens;
    const entries = parseEntries(msg, chunk);
    if (msg.stop_reason !== "end_turn") console.warn(`stop_reason=${msg.stop_reason}: ${chunk.length} 語を飛ばしました`);
    generated = generated.concat(entries);
    record(entries);
    process.stdout.write(`${generated.length}/${words.length} `);
  }
  console.log();
  for (const e of generated.slice(0, 8)) {
    console.log(`- ${e.lemma} (${e.pos}) ${e.meaning_ja}\n    ${e.examples[0]?.en ?? ""} / ${e.examples[0]?.ja ?? ""}\n    ≒ ${e.synonyms.map((s) => `${s.lemma}（${s.note_ja}）`).join(", ")}  ⇔ ${e.antonyms.join(", ")}`);
  }
  report(values.model!, usage, false, generated.length);
  applyAll();
} else {
  const client = new Anthropic();
  type State = { batches: { id: string; model: string; collected: boolean; requests: Record<string, TargetWord[]> }[] };
  const state: State = existsSync(BATCH_STATE) ? JSON.parse(readFileSync(BATCH_STATE, "utf8")) : { batches: [] };
  const save = () => writeFileSync(BATCH_STATE, JSON.stringify(state));

  if (command === "batch") {
    const pending = new Set(state.batches.filter((b) => !b.collected).flatMap((b) => Object.values(b.requests).flat().map(keyOf)));
    const words = selectTargets(db, new Set([...done, ...pending]), { limit: values.limit ? Number(values.limit) : undefined, cefr });
    if (!words.length) console.log("新しく生成する語はありません");
    else {
      const requests = Object.fromEntries(chunks(words).map((c, i) => [`w${Date.now()}-${i}`, c]));
      const batch = await client.messages.batches.create({
        requests: Object.entries(requests).map(([custom_id, c]) => ({ custom_id, params: buildParams(c, values.model!) })),
      });
      state.batches.push({ id: batch.id, model: values.model!, collected: false, requests });
      save();
      console.log(`batch ${batch.id} を作成: ${words.length} 語 / ${Object.keys(requests).length} リクエスト。完了まで待ちます（通常 1 時間以内、Ctrl+C で中断しても collect で回収できます）`);
    }
  }

  for (const b of state.batches.filter((x) => !x.collected)) {
    let batch = await client.messages.batches.retrieve(b.id);
    while (batch.processing_status !== "ended") {
      console.log(`${b.id}: ${batch.processing_status}（処理中 ${batch.request_counts.processing} / 完了 ${batch.request_counts.succeeded}）`);
      await new Promise((r) => setTimeout(r, 60_000));
      batch = await client.messages.batches.retrieve(b.id);
    }
    const usage = { input: 0, output: 0 };
    let count = 0;
    let failed = 0;
    for await (const result of await client.messages.batches.results(b.id)) {
      const words = b.requests[result.custom_id] ?? [];
      if (result.result.type !== "succeeded") {
        failed += words.length;
        continue;
      }
      const msg = result.result.message;
      usage.input += msg.usage.input_tokens;
      usage.output += msg.usage.output_tokens;
      const entries = parseEntries(msg, words);
      failed += words.length - entries.length;
      count += entries.length;
      record(entries);
    }
    b.collected = true;
    save();
    console.log(`${b.id}: ${count} 語を記録${failed ? `（失敗 ${failed} 語。もう一度 batch を実行すると再生成します）` : ""}`);
    report(b.model, usage, true, count);
  }
  applyAll();
}
