/**
 * 公開語彙リストを取得して DB に取り込む（出典・ライセンスは shared/src/sources.ts と docs/word-sources.md）
 *   npm run wordlists                 # 未取得のファイルだけダウンロードして取り込む
 *   npm run wordlists -- --refresh    # すべて取り直す
 *   npm run wordlists -- --skip-fetch # ダウンロードせず手元のファイルで取り込む
 *
 * ダウンロードしたファイルは data/external/（git 管理外）に置く。データ本体はリポジトリに含めない。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DATA_SOURCES } from "@ivocab/shared";
import { config } from "../config.ts";
import { openDb } from "../db.ts";
import { DATA_DIR } from "../seed.ts";
import { ExampleIndex, importOpenWordlist, mergeWordlists, parseEjdict } from "../services/open-wordlists.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: resolve(DATA_DIR, "external") },
    refresh: { type: "boolean", default: false },
    "skip-fetch": { type: "boolean", default: false },
    "no-examples": { type: "boolean", default: false },
  },
});
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), values.dir!);

const OLP = "https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master";
const NGSL = "https://www.newgeneralservicelist.com/s";
const EJDICT = "https://raw.githubusercontent.com/kujirahand/EJDict/master/src";
const FILES: { source: string; file: string; url: string }[] = [
  { source: "cefr-j", file: "cefrj-vocabulary-profile-1.5.csv", url: `${OLP}/cefrj-vocabulary-profile-1.5.csv` },
  { source: "octanove", file: "octanove-vocabulary-profile-c1c2-1.0.csv", url: `${OLP}/octanove-vocabulary-profile-c1c2-1.0.csv` },
  { source: "ngsl", file: "NGSL_12_stats.csv", url: `${NGSL}/NGSL_12_stats.csv` },
  { source: "ngsl-spoken", file: "NGSL-Spoken_12_stats.csv", url: `${NGSL}/NGSL-Spoken_12_stats.csv` },
  { source: "nawl", file: "NAWL_12_lemmatized_for_teaching.csv", url: `${NGSL}/NAWL_12_lemmatized_for_teaching.csv` },
  ...[..."abcdefghijklmnopqrstuvwxyz"].map((c) => ({ source: "ejdict", file: `ejdict/${c}.txt`, url: `${EJDICT}/${c}.txt` })),
  { source: "tatoeba", file: "jpn-eng.zip", url: "https://www.manythings.org/anki/jpn-eng.zip" },
];

async function download(url: string, dest: string) {
  const res = await fetch(url, { headers: { "user-agent": "i-vocabulary wordlist importer" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

if (!values["skip-fetch"]) {
  mkdirSync(resolve(dir, "ejdict"), { recursive: true });
  for (const f of FILES) {
    const dest = resolve(dir, f.file);
    if (existsSync(dest) && !values.refresh) continue;
    process.stdout.write(`download ${f.file} … `);
    await download(f.url, dest);
    console.log("ok");
  }
  if (!existsSync(resolve(dir, "tatoeba/jpn.txt")) || values.refresh) {
    mkdirSync(resolve(dir, "tatoeba"), { recursive: true });
    try {
      execFileSync("unzip", ["-oq", resolve(dir, "jpn-eng.zip"), "-d", resolve(dir, "tatoeba")]);
    } catch {
      throw new Error("jpn-eng.zip を展開できませんでした（unzip コマンドが必要です）");
    }
  }
  // 取得元・日時・ライセンスの控え（再配布時の出典表示に使う）
  const manifest = [
    `retrieved: ${new Date().toISOString()}`,
    "",
    ...DATA_SOURCES.filter((s) => s.id !== "seed").map((s) => `- ${s.name} — ${s.credit} — ${s.license}${s.licenseUrl ? ` (${s.licenseUrl})` : ""} — ${s.url}`),
    "",
    "files:",
    ...FILES.map((f) => `  ${f.file} <- ${f.url}`),
  ].join("\n");
  writeFileSync(resolve(dir, "SOURCES.txt"), manifest + "\n");
}

const read = (f: string) => readFileSync(resolve(dir, f), "utf8");
const words = mergeWordlists({
  cefrj: read("cefrj-vocabulary-profile-1.5.csv"),
  octanove: read("octanove-vocabulary-profile-c1c2-1.0.csv"),
  ngsl: read("NGSL_12_stats.csv"),
  ngslSpoken: read("NGSL-Spoken_12_stats.csv"),
  nawl: read("NAWL_12_lemmatized_for_teaching.csv"),
});
const dict = parseEjdict(readdirSync(resolve(dir, "ejdict")).sort().map((f) => read(`ejdict/${f}`)).join("\n"));
const examples = values["no-examples"] ? null : ExampleIndex.fromManythings(read("tatoeba/jpn.txt"));

const db = openDb(config.dbPath);
const r = importOpenWordlist(db, words, dict, examples);
const pct = (n: number) => `${Math.round((n / r.words) * 100)}%`;
console.log(`imported ${r.words} words (${r.added} new) into ${config.dbPath}`);
console.log(`  日本語訳あり ${r.withMeaning} (${pct(r.withMeaning)}) / 例文あり ${r.withExamples} (${pct(r.withExamples)})`);
console.log(`  CEFR: ${Object.entries(r.byCefr).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  source: ${Object.entries(r.bySource).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log("日本語訳のない語は新出カードとして出題されません（npm run enrich で英語定義などを補完できます）");
