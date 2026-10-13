/**
 * 単語データの出典とライセンス。アプリの「データの出典」画面と GET /credits で表示する
 * （CC BY / CC BY-SA の表示義務、CEFR-J の出典明記の条件を満たすため）。
 * 取り込みスクリプト（server/src/cli/wordlists.ts）のダウンロード元もここに揃える。
 */
export interface DataSource {
  id: string;
  name: string;
  /** 何に使っているか */
  usage: string;
  credit: string;
  license: string;
  licenseUrl: string | null;
  url: string;
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: "seed",
    name: "i-vocabulary 同梱データ",
    usage: "厳選した会話頻出語・表現と独自の訳・例文補正（CC0）",
    credit: "i-vocabulary",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    url: "https://github.com/inai17ibar/i-vocabulary",
  },
  {
    id: "cefr-j",
    name: "CEFR-J Wordlist Version 1.5",
    usage: "単語と CEFR レベル（A1–B2）",
    credit: "Compiled by Yukio Tono, Tokyo University of Foreign Studies (Tono Laboratory). Retrieved from http://www.cefr-j.org/download.html",
    license: "出典明記により研究・商用とも無償で利用可",
    licenseUrl: null,
    url: "https://github.com/openlanguageprofiles/olp-en-cefrj",
  },
  {
    id: "octanove",
    name: "Octanove Vocabulary Profile C1/C2 1.0",
    usage: "上級（C1–C2）の単語と CEFR レベル",
    credit: "Octanove Labs",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    url: "https://github.com/openlanguageprofiles/olp-en-cefrj",
  },
  {
    id: "ngsl",
    name: "New General Service List 1.2 (NGSL)",
    usage: "頻度順位（出題の優先順）",
    credit: "Browne, C., Culligan, B., and Phillips, J.",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    url: "https://www.newgeneralservicelist.com/new-general-service-list",
  },
  {
    id: "ngsl-spoken",
    name: "New General Service List-Spoken 1.2 (NGSL-S)",
    usage: "「会話でよく使う」の目印",
    credit: "Browne, C. and Culligan, B.",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    url: "https://www.newgeneralservicelist.com/ngsl-spoken",
  },
  {
    id: "nawl",
    name: "New Academic Word List 1.2 (NAWL)",
    usage: "「アカデミック（IELTS 向け）」の目印と学術語",
    credit: "Browne, C., Culligan, B., and Phillips, J.",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    url: "https://www.newgeneralservicelist.com/new-academic-word-list",
  },
  {
    id: "ejdict",
    name: "EJDict-hand",
    usage: "日本語訳",
    credit: "kujirahand",
    license: "CC0 1.0（パブリックドメイン）",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    url: "https://github.com/kujirahand/EJDict",
  },
  {
    id: "tatoeba",
    name: "Tatoeba（日英対訳例文）",
    usage: "和訳つき例文（各例文に作者を表示）",
    credit: "tatoeba.org の各作者（例文ごとに表示）。ファイルは www.manythings.org/anki 経由",
    license: "CC BY 2.0 FR",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/fr/",
    url: "https://tatoeba.org/",
  },
];

/** CC BY-SA のデータを加工したもの（取り込んだ単語データ一式）の扱い */
export const DERIVED_DATA_NOTICE =
  "公開データには品詞の正規化、リストの合成、訳語・例文の選択、独自の補正を加えています。取り込んだ単語データ（レベル・頻度・目印）は CC BY-SA 4.0 のデータを含むため、データを再配布する場合は CC BY-SA 4.0 で提供し、上記の出典を表示します。アプリのプログラム自体には影響しません。";
