# i-vocabulary

英会話のための英単語学習アプリ。**忘却曲線に沿った復習（FSRS）**、**類義語・対義語**、**同じ意図のいろんな言い方**、
**英検・IELTS のレベル別タスク**、**Cambly のレッスンとの連携** を備えています。
Web クライアント + API サーバー構成で、同じ API を将来の iOS アプリから使えるように設計しています。

## 主な機能

| 機能 | 内容 |
|---|---|
| 学習曲線 | FSRS で単語ごとの記憶の安定度を推定し、想起確率が目標値（既定 90%）に落ちるタイミングで復習。自分の忘却曲線・復習予定をグラフ表示。日別・回答ごとの学習履歴と、単語ごとの復習予定・回答履歴も見られる |
| 類義語・対義語 | ニュアンス注記つき。類義語問題には対義語を、対義語問題には類義語を紛らわしい選択肢として混ぜる |
| いろんな言い方 | 「意見を言う」「やんわり反対する」など 22 の意図ごとに、カジュアル〜フォーマルの言い方をセットで学習。言い換え・レジスター選択問題 |
| レベル別タスク | 英検 5級〜1級（準2級プラス含む）/ IELTS 4.0〜9.0。レベルに応じた出題 CEFR 帯・1日の量・アウトプット課題（英検二次 / IELTS Speaking 型） |
| Cambly 連携 | レッスン前: 忘れかけの語から「今日使う語」リストを作り、チャットに貼る英文を生成 → レッスン後: 使えた語にチェックすると復習に反映 → チャットログを貼ると既知語・表現・**講師の訂正**・新出語候補を抽出してカード化 |
| 発音 | 単語・例文・表現の読み上げ（米/英アクセント、ゆっくり再生、新出語の自動再生）、発音記号、**マイクで言ってみて音声認識で判定する発音チェック**、音声を聞いて単語を選ぶ**リスニング問題** |
| モバイル | 下部タブバー・親指で押せる位置の回答ボタン・全画面の学習画面。ホーム画面に追加すればアプリのように起動（PWA） |
| 単語供給 | 同梱の厳選データ + NGSL / CEFR-J / 独自 CSV の取り込み + Free Dictionary / Datamuse で自動補完（[詳細](docs/word-sources.md)） |

## 使い方

Node.js 22.13 以上（組み込みの `node:sqlite` を使用）。

```bash
npm install
npm run dev          # API :8787 + Web :5173（/api はプロキシ）
# → http://localhost:5173
```

本番相当（API が Web のビルドも配信）:

```bash
npm run build && npm start   # → http://localhost:8787
```

iOS アプリ（Capacitor で Web UI を包んだネイティブアプリ。Xcode が必要）:

```bash
npm start                      # API サーバーを起動しておく
npm run ios -w web             # Web をビルド → ios/ に同期 → シミュレーターで起動
npm run ios:open -w web        # Xcode で開く（実機ビルド・署名はここで）
```

**接続先はアプリ内で切り替える**（ログイン画面の「接続先 › 変更」/ 設定 › 接続先サーバー）。ビルドし直す必要はない。
候補から選ぶか `192.168.0.10:8787` / `https://…` を入力すると、接続テストが通ったときだけ切り替わる。ログイン状態は接続先ごとに保存される。

| 設定 | 場所 | 用途 |
|---|---|---|
| `VITE_API_BASE` | `web/.env.ios` | 既定の接続先（`http://localhost:8787/api/v1` = シミュレーターから Mac） |
| `VITE_API_SERVERS` | `web/.env.ios` | 候補一覧 `名前=URL;名前=URL`。デプロイしたら本番 URL をここに足す |
| 個人の値 | `web/.env.ios.local`（git 管理外） | 自宅の LAN IP など。例: `VITE_API_SERVERS=自宅のMac=192.168.0.10:8787` |

実機で Mac のサーバーを使うときは同じ Wi-Fi につなぎ、初回の「ローカルネットワーク」の許可を「許可」にする。
Web 版（同一オリジン配信）では切り替え UI は出ない（開発サーバーと、`VITE_API_SERVERS` を設定したビルドでは出る）。

| コマンド | 内容 |
|---|---|
| `npm test` | shared / server / web のテスト（vitest） |
| `npm run typecheck` | 全パッケージの型チェック |
| `npm run seed` | 同梱データを DB に投入（初回起動時は自動） |
| `npm run import:words -- --file x.csv --preset ngsl` | 単語リストの取り込み |
| `npm run enrich -- --limit 200` | 外部辞書で定義・関係語を補完 |

環境変数: `PORT`(8787) / `DATABASE_PATH`(data/ivocab.db) / `WEB_DIST` / `CORS_ORIGINS`（カンマ区切り）/ Web 側 `VITE_API_BASE` `VITE_API_SERVERS`

## 構成

```
shared/   API 型定義・英検/IELTS/CEFR レベル定義（Web/Server 共通）
server/   Fastify + SQLite + ts-fsrs の REST API (/api/v1)
web/      React + Vite の Web クライアント
data/     同梱シードデータ・サンプル CSV
docs/     api.md / architecture.md（iOS 展開計画）/ word-sources.md
```

- [API リファレンス](docs/api.md)
- [アーキテクチャと iOS への展開](docs/architecture.md)
- [単語リストの供給方法](docs/word-sources.md)
