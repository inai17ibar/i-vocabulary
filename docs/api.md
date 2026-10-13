# API リファレンス（v1）

ベース URL: `/api/v1`。JSON のみ。日時は ISO 8601 (UTC)、日付は `YYYY-MM-DD`（ユーザーのタイムゾーン）。
型定義は [`shared/src/types.ts`](../shared/src/types.ts) が正（iOS の `Codable` はここから起こす）。

## 認証

`Authorization: Bearer <token>`。トークンは `register` / `login` で取得（90 日有効、サーバー側にはハッシュのみ保存）。
iOS では Keychain に保存する。

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/auth/register` | `{email, password(8+), displayName?, levelId?, timezone?}` | `AuthResponse` |
| POST | `/auth/login` | `{email, password}` | `AuthResponse` |
| POST | `/auth/logout` | – | `{ok}` |
| GET | `/me` | – | `{user}` |
| PATCH | `/me` | `{displayName?, levelId?, desiredRetention?(0.7–0.97), timezone?}` | `{user}` |

## マスタ

| Method | Path | 説明 |
|---|---|---|
| GET | `/health` | 死活監視（認証不要） |
| GET | `/levels` | 英検・IELTS レベル定義と 1 日のタスク量（認証不要） |
| GET | `/words?q=&cefr=&limit=&offset=` | 単語検索（類義語・対義語・例文つき） |
| GET | `/words/:id` | 単語詳細 |
| GET | `/expressions` | 「いろんな言い方」グループ一覧 |
| GET | `/expressions/:id` | グループ詳細 |

## 学習

| Method | Path | 説明 |
|---|---|---|
| GET | `/tasks/today` | 今日のタスク（復習・新出・類義語・対義語・言い換え）と進捗、アウトプット課題 |
| GET | `/study/session?task=review\|new\|synonym\|antonym\|paraphrase&limit=` | 問題リスト `StudySession`。`new` は必要に応じてカードを導入する |
| POST | `/reviews` | 回答を記録 → FSRS で次回日時を計算 |
| POST | `/reviews/batch` | `{reviews: ReviewRequest[]}` オフラインで溜めた回答を一括送信（`reviewedAt` 順に適用） |
| GET | `/cards?itemType=&limit=&offset=` | 自分のカード一覧（想起確率つき） |
| POST | `/cards` | `{itemType, itemId}` 手動でカード追加 |
| DELETE | `/cards/:id` | カード削除 |
| GET | `/stats` | 連続日数・正答率・忘却曲線・復習予定・CEFR 別定着数 |
| GET | `/cards/:id` | `CardDetail`: カードの現在の状態と全回答履歴（新しい順） |

### `POST /reviews`

```json
{ "cardId": 12, "mode": "synonym", "correct": true, "durationMs": 4200,
  "reviewedAt": "2026-10-10T08:00:00Z", "clientReviewId": "5b0c…" }
```

- `grade`（1=Again 2=Hard 3=Good 4=Easy）か `correct` のどちらかが必須。
  `correct` の場合: 不正解→1、10 秒超の正解→2、それ以外→3。
- `clientReviewId` は冪等キー。同じ ID の再送は `duplicate: true` を返し二重記録しない（オフライン再送対策）。
- `reviewedAt` が未来や前回レビューより前の場合はサーバー時刻を使う。

クイズの正解 (`answerIndex`) は問題に含めて返すので、クライアントはオフラインでも採点できる。
`mode: "listening"` の問題は `prompt`（正解の単語）を表示せずに読み上げ、選択肢から選ばせる。

## 学習記録・予定

`/stats` は集計値だけを返す。個々の回答や「どのカードがいつ出るか」はこちら。型は `shared/src/types.ts` の `ReviewLogEntry` / `HistoryResponse` / `ScheduleResponse` / `CardDetail`。

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/reviews` | `date?` `from?` `to?`（`YYYY-MM-DD`、ユーザーのタイムゾーン）, `cardId?`, `limit?`(1–200, 既定 50), `before?` | `ReviewLogPage` 回答記録を新しい順に |
| GET | `/history` | `from?` `to?`（既定: 今日までの 30 日、最大 366 日） | `HistoryResponse` 日別サマリー（学習しなかった日も 0 で埋める）と期間合計 |
| GET | `/schedule` | `days?`(1–90, 既定 14) | `ScheduleResponse` 期限切れ・日別の復習予定カード |

- `/reviews` は回答時刻（`reviewedAt`）順。オフライン回答が後から届いても時刻どおりに並ぶ。
  続きは前ページの `nextCursor` を `before` に渡す（`null` なら最後）。
- `/history` の `newCards` は「その日に初めて学習したカード数」、`studyMs` は記録された回答時間の合計。
- `/schedule` の各日は `count`（全件数）と `cards`（期限順、1 日最大 200 件）。`later` は期間より後、`unstarted` は未学習で予定のないカード数。
  学習中（learning / relearning）のカードは数分〜の固定ステップで再出題されるので、`retrievability` より `due` を見て表示する。
- `retrievability` は経過時間を小数の日数で計算する（当日中でも下がっていく）。

## 「言えなかった」フレーズ帳（AI）

| Method | Path | 説明 |
|---|---|---|
| POST | `/phrases/suggest` | `PhraseRequest {text, context?}` → `PhraseSuggestion`。言いたかったこと（日本語・途中までの英語）から自然な言い方を 2〜4 個（カジュアル〜フォーマル）、英語の試みへのフィードバック、覚えると便利な語（辞書にあれば `wordId`） |
| POST | `/phrases` | `SavePhraseRequest {intentJa, chosen, alternatives}` → `{word, card}`。選んだ言い方を本人専用のフレーズ（`pos: "phrase"`、`source: "phrase"`）として保存し、ほかの言い方はニュアンス注記つきの類義表現にする。新出カードの最初に出る |
| GET | `/phrases` | 保存したフレーズ（新しい順） |

- AI は Claude（サーバーの `ANTHROPIC_API_KEY`、モデルは `PHRASE_MODEL`、既定 `claude-opus-5-5`）。未設定なら 503 `ai_unavailable`。
- 1 人 1 日 30 回まで（`PHRASE_DAILY_LIMIT`）。超えると 429 `rate_limited`。応答の `remainingToday` が残り回数。

## 英文から学ぶ・英会話レッスン

特定の英会話サービスには依存しない（オンライン英会話・対面・独学どれでも使える）。

| Method | Path | 説明 |
|---|---|---|
| POST | `/capture/analyze` | `{text}` チャットログ・文字起こし・メモ・記事などを解析 → 既知語・表現・訂正・新出語候補 |
| POST | `/capture/cards` | `{wordIds?, groupIds?, customWords?, corrections?}` 解析結果をカード化（source=`capture`） |
| GET | `/lessons/suggestions` | 次のレッスンで使うと良い語（想起確率が低い順） |
| GET | `/lessons` | レッスン一覧 |
| POST | `/lessons` | `{lessonDate, tutor?, topic?, notes?, transcript?, targetCardIds?}` → `{lesson, prepSheet}`（講師とのチャットに貼る英文） |
| GET/PATCH | `/lessons/:id` | 取得・更新 |
| PUT | `/lessons/:id/targets/:cardId` | `{used}` レッスンで使えたら true → FSRS に Good で記録（1 レッスン 1 回） |

## エラー

`{ "error": "validation_error" | "auth_error" | "unauthorized" | "not_found" | "error", "message"?, "details"? }`
（400 / 401 / 404 / 500）
