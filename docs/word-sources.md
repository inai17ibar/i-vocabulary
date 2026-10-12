# 単語リストの供給方法

「どこからいい方法で供給するか」への回答として、ライセンス的に安全な **3 層構成** にしています。

## 1. 同梱シード（すぐ使える・高品質）

`data/seed/words.json`（120 語、CEFR A1–C2）と `data/seed/expressions.json`（「いろんな言い方」22 グループ）。
英会話で使用頻度が高い語を選び、**日本語訳・ニュアンス注記つきの類義語・対義語・例文**を手作業で付けたオリジナルデータ（CC0）。
サーバー初回起動時に自動投入されます（`npm run seed` で再投入、既存は上書き更新）。

## 2. 公開語彙リストの一括取り込み（約 1 万語）

```bash
npm run wordlists                 # ダウンロード（data/external/、git 管理外）→ 合成 → DB へ取り込み
npm run wordlists -- --refresh    # 取り直す
npm run wordlists -- --skip-fetch # 手元のファイルで取り込み直す
```

**英検・IELTS の公式問題集・公式単語帳・市販の単語帳は著作物なので使わない。**
英検協会・IELTS（Cambridge）とも再利用可能な公式語彙リストは公開していない。
代わりに CEFR でレベル付けされた公開データを使い、`shared/src/levels.ts` の対応表で英検・IELTS のレベルに結びつける。

| データ | 使い道 | ライセンス |
|---|---|---|
| [CEFR-J Wordlist 1.5](https://github.com/openlanguageprofiles/olp-en-cefrj)（東京外大 投野研究室） | 単語・品詞・CEFR（A1–B2） | 出典明記で研究・商用とも無償 |
| [Octanove Vocabulary Profile C1/C2](https://github.com/openlanguageprofiles/olp-en-cefrj) | 上級語（C1–C2） | CC BY-SA 4.0 |
| [NGSL 1.2](https://www.newgeneralservicelist.com/new-general-service-list) | 頻度順位（出題順） | CC BY-SA 4.0 |
| [NGSL-Spoken 1.2](https://www.newgeneralservicelist.com/ngsl-spoken) | `spoken`（会話頻出）の目印 | CC BY-SA 4.0 |
| [NAWL 1.2](https://www.newgeneralservicelist.com/new-academic-word-list) | `academic`（IELTS 向け学術語）の目印 | CC BY-SA 4.0 |
| [EJDict-hand](https://github.com/kujirahand/EJDict) | 日本語訳 | CC0 1.0 |
| [Tatoeba](https://tatoeba.org/)（[manythings.org](https://www.manythings.org/anki/) の日英ペア） | 和訳つき例文。例文ごとに ID と作者を保存・表示 | CC BY 2.0 FR |

合成のルール（`server/src/services/open-wordlists.ts`）:
- 冠詞・代名詞・助動詞・数詞は単語カードにしない。同じ (lemma, pos) はリスト間で低いほうの CEFR を採る。
- CEFR-J / Octanove にない NGSL の語は順位から CEFR を推定、NAWL だけの語は C1。品詞は日本語訳の語尾から推定。
- 日本語訳は EJDict の訳語から、品詞に合いそうなもの（語尾で推定）を『』の主要訳から 3 つまで。機械的な選択なので完璧ではない。
- 例文は見出し語（活用形を含む）を含む 4〜14 語の文から、品詞に合った使われ方（to + 動詞、the + 名詞 など）を優先して 2 つ。
- 既存の語（同梱の厳選データ、ユーザー追加語）の訳・例文・レベルは上書きしない。目印と頻度順位だけ足す。
- 新出カードは同じ CEFR 帯の中で「厳選データ → 試験に合った目印（英検: spoken、IELTS: academic）→ 頻度順」に導入する。

結果（2026-10 時点）: 10,019 語（A1 1,033 / A2 1,372 / B1 2,435 / B2 2,814 / C1 1,432 / C2 933）、日本語訳あり 93%、例文あり 63%。

**出典表示**: アプリの「設定 › データの出典とライセンス」と `GET /api/v1/credits` に表示（定義は `shared/src/sources.ts`）。
取り込み時に `data/external/SOURCES.txt` へ取得日時と URL を控える。
CC BY-SA のデータを含むため、取り込んだ単語データを**再配布する場合は CC BY-SA 4.0 で提供**する（アプリのコードには影響しない）。
データ本体はリポジトリに含めず、各環境でこのスクリプトを実行して作る。

### 独自 CSV の取り込み

```bash
npm run import:words -- --file data/samples/generic-sample.csv          # lemma,pos,cefr,meaning_ja,...
npm run import:words -- --file list.csv --preset ngsl --source ngsl      # 頻度順リスト（順位から CEFR を推定）
```

列: `lemma,pos,cefr,meaning_ja,definition_en,example,example_ja,synonyms,antonyms`（関係語は `;` 区切り）。
**Oxford 3000/5000、英検の公式単語帳、市販単語帳の転載は不可**（著作権）。

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
- NGSL 等を取り込むと、Cambly 解析の「辞書にない語の候補」から `yesterday` のような基本語が自然に消える。
