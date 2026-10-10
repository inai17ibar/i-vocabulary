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

## Cambly 連携

| Method | Path | 説明 |
|---|---|---|
| POST | `/cambly/analyze` | `{text}` チャットログ等を解析 → 既知語・表現・訂正・新出語候補 |
| POST | `/cambly/cards` | `{wordIds?, groupIds?, customWords?, corrections?}` 解析結果をカード化（source=`cambly`） |
| GET | `/cambly/suggestions` | 次のレッスンで使うと良い語（想起確率が低い順） |
| GET | `/cambly/lessons` | レッスン一覧 |
| POST | `/cambly/lessons` | `{lessonDate, tutor?, topic?, notes?, transcript?, targetCardIds?}` → `{lesson, prepSheet}` |
| GET/PATCH | `/cambly/lessons/:id` | 取得・更新 |
| PUT | `/cambly/lessons/:id/targets/:cardId` | `{used}` レッスンで使えたら true → FSRS に Good で記録（1 レッスン 1 回） |

## エラー

`{ "error": "validation_error" | "auth_error" | "unauthorized" | "not_found" | "error", "message"?, "details"? }`
（400 / 401 / 404 / 500）
