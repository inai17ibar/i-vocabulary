# 単語リストの供給方法

「どこからいい方法で供給するか」への回答として、ライセンス的に安全な **3 層構成** にしています。

## 1. 同梱シード（すぐ使える・高品質）

`data/seed/words.json`（120 語、CEFR A1–C2）と `data/seed/expressions.json`（「いろんな言い方」22 グループ）。
英会話で使用頻度が高い語を選び、**日本語訳・ニュアンス注記つきの類義語・対義語・例文**を手作業で付けたオリジナルデータ（CC0）。
サーバー初回起動時に自動投入されます（`npm run seed` で再投入、既存は上書き更新）。

## 2. 公開語彙リストの取り込み（量を確保）

```bash
npm run import:words -- --file list.csv --preset ngsl --source ngsl
npm run import:words -- --file cefrj.csv --preset cefrj --source cefr-j
npm run import:words -- --file data/samples/generic-sample.csv          # 独自 CSV
```

| リスト | 内容 | ライセンス | プリセット |
|---|---|---|---|
| **NGSL** (New General Service List) | 一般英語の高頻度 約 2,800 語。日常会話の 9 割をカバー | CC BY-SA 4.0 | `ngsl`（順位から CEFR を推定） |
| **NAWL / TSL / BSL** | アカデミック（IELTS 向け）、TOEIC、ビジネス | CC BY-SA 4.0 | `ngsl` |
| **CEFR-J Wordlist** | 日本の英語教育向けに CEFR レベルを付与した約 7,800 語 | 出典明記で利用可（要確認） | `cefrj` |
| 独自 CSV | `lemma,pos,cefr,meaning_ja,definition_en,example,example_ja,synonyms,antonyms`（関係語は `;` 区切り） | – | `generic` |

注意:
- **Oxford 3000/5000、英検の公式単語帳、市販単語帳の転載は不可**（著作権）。
- CC BY-SA のデータを再配布する場合は表示と継承が必要。データ本体はリポジトリに含めず、取り込みスクリプトで各自取得する運用を推奨。
- `meaning_ja` が空の単語は新出カードとして自動導入されません（英語定義は表示されます）。

## 3. 外部辞書で自動補完（関係語・定義・発音）

```bash
npm run enrich -- --limit 200
```

| API | 取得内容 | 備考 |
|---|---|---|
| [Free Dictionary API](https://dictionaryapi.dev/) | 英語定義・IPA・例文・類義語・対義語 | 無料・キー不要（Wiktionary 由来、CC BY-SA） |
| [Datamuse](https://www.datamuse.com/api/) | 類義語 `rel_syn`・対義語 `rel_ant` | 無料・キー不要（〜10 万リクエスト/日） |

結果は DB にキャッシュ（`enriched_at`）するので、実行時の API 依存はありません。関係語は双方向に参照されます
（`hot` の対義語に `cold` を登録すると `cold` 側にも `hot` が出る）。

## 今後の拡張案

- **日本語訳の自動付与**: 取り込んだ語の `meaning_ja`・日本語例文・言い換え表現グループを LLM（Claude API 等）で生成し、
  人がレビューしてから公開する。Cambly のチャットログから「訂正」や言い換えを抽出する精度も上がる。
- **JMdict**（CC BY-SA）からの英→日の逆引きで訳語候補を付ける。
- NGSL 等を取り込むと、Cambly 解析の「辞書にない語の候補」から `yesterday` のような基本語が自然に消える。
