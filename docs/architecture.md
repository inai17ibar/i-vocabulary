# アーキテクチャと iOS への展開計画

## 全体像

```
┌──────────────┐     HTTPS / JSON (Bearer token)      ┌──────────────────────────┐
│ Web (React)  │ ───────────────────────────────────▶ │ API server (Hono/TS)     │
└──────────────┘                                       │  ├ FSRS スケジューラ      │
┌──────────────┐     同じ /api/v1                      │  ├ クイズ生成             │
│ iOS (SwiftUI)│ ───────────────────────────────────▶ │  ├ 英文解析・AI フレーズ  │
│  ※今後       │   オフライン回答は /reviews/batch      │  └ 単語取り込み・補完     │
└──────────────┘                                       └────────────┬─────────────┘
                                                                    │
                                          SQLite（→ 本番は PostgreSQL へ移行可）
                                                                    │
                                     外部辞書: Datamuse / Free Dictionary API（CLI でキャッシュ）
```

**設計方針: ロジックはサーバーに寄せ、クライアントは薄く。**
スケジューリング（FSRS）、出題、タスク量、英文解析、AI によるフレーズ提案はすべてサーバー側にあるので、
iOS クライアントは「表示・回答送信・オフラインキャッシュ」だけを実装すればよい。

## ディレクトリ

| パス | 内容 |
|---|---|
| `shared/` | API の型定義とレベル定義（Web と Server で共有。iOS は型を Swift に写す） |
| `server/` | Fastify API。`src/services/*` がドメインロジック、`src/app.ts` がルーティング |
| `web/` | React + Vite の Web クライアント |
| `data/seed/` | 同梱の単語・表現データ（オリジナル、CC0） |
| `docs/` | API・設計・単語供給のドキュメント |

## 学習曲線（FSRS）

- 各カードに **安定度 S**（想起確率が 90% に落ちるまでの日数）と **難易度 D** を持たせ、
  回答のたびに更新する（ライブラリ: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)）。
- 忘却曲線 `R(t) = (1 + F·t/S)^C`。`R` がユーザーの **目標保持率**（既定 90%、設定で 80–95%）まで落ちる日に復習。
- 4 択クイズは正誤と回答時間から評価を自動算出（不正解→Again、遅い正解→Hard、正解→Good）。
- 出題モードは記憶の段階で変える: 学習初期は「単語→意味」「意味→単語」（認識）、
  安定度が上がると「例文の穴埋め」「類義語」「対義語」（文脈・関連づけ）へ。
- 英会話レッスンで実際に使えた語は Good として記録（産出による記憶強化）。
- `/stats` でユーザー自身の忘却曲線（安定度の中央値）・復習予定・定着語数を可視化。

## レベル（英検・IELTS）

内部は CEFR を共通尺度にし、`shared/src/levels.ts` で英検（5級〜1級、準2級プラス含む）と IELTS バンドを対応づけ。
レベルごとに出題する CEFR 帯と 1 日のタスク量（新出語数、類義語/対義語/言い換えドリル数）、
アウトプット課題（英検の二次試験・英作文型 / IELTS Speaking Part 1–3 型）を定義している。
IELTS は採点基準 *Lexical Resource* が言い換え力を重視するので、言い換え・類義語ドリルを多めにしている。

## iOS 版への道筋

1. **API はそのまま使う。** Bearer トークン認証・JSON・CORS 不要のネイティブ HTTP。
2. **型を写す。** `shared/src/types.ts` → Swift の `Codable` struct（将来的には OpenAPI を生成して swift-openapi-generator を使うのが楽）。
3. **オフライン学習。** `GET /study/session` の結果（正解インデックス込み）を端末に保存し、
   オフラインで回答 → `clientReviewId`(UUID) と `reviewedAt` を付けてキューに積み、
   オンライン復帰時に `POST /reviews/batch`。サーバーは冪等なので二重送信しても安全。
4. **発音。** Web 版の `web/src/speech.ts` と同じ役割を、読み上げは `AVSpeechSynthesizer`、
   発音チェックは `SFSpeechRecognizer`（`en-US` / `en-GB`）で実装。判定ロジック（認識候補のどれかに目標語が含まれれば OK）も同じにする。
   リスニング問題 (`mode: "listening"`) は `prompt` を画面に出さず読み上げる。
5. **通知。** `/tasks/today` の復習数をもとにローカル通知（復習の最適タイミング）。
6. **英文の取り込み。** iOS の共有シート（Share Extension）で他のアプリからテキストを受け取り `/capture/analyze` へ送る。

React Native / Capacitor で Web を流用する選択肢もあるが、API を分離してあるので SwiftUI ネイティブで作っても重複は最小限。

## 本番運用に向けて（未対応）

- デプロイ済み: Cloudflare Workers + Durable Objects の SQLite（[deploy.md](deploy.md)）。利用者が増えたらユーザーごとの Durable Object に分割。
- パスワードリセット、Sign in with Apple（iOS 審査で必要になる場合あり）
- レート制限（HTTPS は Cloudflare が終端）
- OpenAPI 定義の自動生成
