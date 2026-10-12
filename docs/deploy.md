# デプロイ（Cloudflare Workers + Durable Objects）

本番: https://i-vocabulary.inai17ibar.workers.dev

```
ブラウザ / iOS アプリ
   │
   ▼
Cloudflare Worker（server/src/worker.ts）
   ├─ /api/*  → Durable Object「AppDurableObject」（名前 "main"）
   │              └─ Hono の API（server/src/app.ts）＋ SQLite（ctx.storage.sql、server/src/db-do.ts）
   └─ それ以外 → Static Assets（web/dist。SPA なので未知のパスは index.html）
```

- API のコード（`server/src/app.ts` とサービス層）はローカルの Node.js（`npm start`、node:sqlite）と同じもの。
  DB の違いは `DB` インターフェース（`server/src/db.ts`）で吸収している。
- 利用者が少ないうちは Durable Object 1 つで全リクエストを処理する（1 オブジェクトあたり約 1,000 req/s が目安、DB は 10GB まで）。
  増えてきたらユーザーごとの Durable Object に分ける。
- 同梱データ（data/seed）は Worker に同梱され、内容が変わったときだけ起動時に入れ直す。

## 料金（Workers Free プラン）

1 日あたり: リクエスト 10 万、Durable Objects の SQLite 読み取り 500 万行・書き込み 10 万行、保存 5GB（2026-10 時点）。
個人〜少人数の利用は無料枠に収まる。超えると翌日（UTC 0 時）まで失敗するので、増えたら Workers Paid（月 $5〜）にする。

## デプロイ

```bash
npm run deploy                    # Web をビルドして Worker をデプロイ（wrangler にログイン済みであること）
```

初回だけ、単語データの投入用トークンを設定する:

```bash
# .env（git 管理外）に IVOCAB_ADMIN_TOKEN=<ランダムな文字列> を書いてから
node -e 'process.loadEnvFile(".env"); process.stdout.write(process.env.IVOCAB_ADMIN_TOKEN)' | (cd server && npx wrangler secret put ADMIN_TOKEN)
```

## 単語データの投入

単語データ（`npm run wordlists`、`npm run enrich:llm` の結果）はローカルの DB で作り、本番に送る:

```bash
npm run deploy:data                 # 本番に送る（--url で送り先を変更）
```

- `POST /api/v1/admin/words`（`ADMIN_TOKEN` が必要）に 200 語ずつ送る。同じ語は上書き・追記なので何度送っても壊れない。
- 約 1 万語・例文 1.2 万で書き込みは 5〜6 万行（索引込み）。無料枠の 10 万行/日を超えたら翌日に再実行すると続きから送る
  （進み具合は `data/external/deploy-progress.json`）。`--restart` で最初から。

## ローカルで Worker を動かす

```bash
npm run dev:worker                # wrangler dev（workerd + ローカルの Durable Object）
```

## iOS アプリ

既定の接続先は本番（`web/.env.ios`）。アプリの「接続先 › 変更」でローカルの Mac にも切り替えられる。
