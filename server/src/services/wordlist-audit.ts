import type { DB } from "../db.ts";
import { CEFR_LEVELS } from "@ivocab/shared";

/** Counts shared cards, not user vocabulary; repeated lemmas with different POS are intentional. */
export function auditWordlists(db: Pick<DB, "prepare">) {
  const counts = (where: string) => db.prepare(`SELECT COUNT(*) AS words,
    COUNT(DISTINCT lower(trim(lemma))) AS lemmas,
    SUM(CASE WHEN trim(meaning_ja) <> '' THEN 1 ELSE 0 END) AS withMeaning,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM examples e WHERE e.word_id = w.id) THEN 1 ELSE 0 END) AS withExamples,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM examples e WHERE e.word_id = w.id AND trim(COALESCE(e.translation_ja, '')) <> '') THEN 1 ELSE 0 END) AS withTranslatedExamples,
    SUM(CASE WHEN frequency_rank IS NOT NULL THEN 1 ELSE 0 END) AS withFrequency,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM word_relations r WHERE r.word_id = w.id AND r.type = 'synonym') THEN 1 ELSE 0 END) AS withSynonyms,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM word_relations r WHERE r.word_id = w.id AND r.type = 'antonym') THEN 1 ELSE 0 END) AS withAntonyms
    FROM words w WHERE created_by IS NULL AND (${where})`).get();
  return {
    total: counts("1"),
    byCefr: Object.fromEntries(CEFR_LEVELS.map((c) => [c, counts(`cefr = '${c}'`)])),
    spoken: counts("(',' || tags || ',') LIKE '%,spoken,%'"),
    academic: counts("(',' || tags || ',') LIKE '%,academic,%'"),
    ielts6: counts("cefr IN ('B1', 'B2')"),
    ielts7: counts("cefr IN ('B2', 'C1')"),
    bySource: db.prepare("SELECT source, COUNT(*) AS words FROM words WHERE created_by IS NULL GROUP BY source ORDER BY source").all(),
    duplicates: db.prepare("SELECT lower(trim(lemma)) AS lemma, pos, COUNT(*) AS n FROM words WHERE created_by IS NULL GROUP BY lower(trim(lemma)), pos HAVING COUNT(*) > 1").all(),
    invalidRanks: db.prepare("SELECT lemma, pos, frequency_rank FROM words WHERE created_by IS NULL AND frequency_rank IS NOT NULL AND (frequency_rank <= 0 OR frequency_rank <> CAST(frequency_rank AS INTEGER))").all(),
    frequency: db.prepare("SELECT MIN(frequency_rank) AS min, MAX(frequency_rank) AS max, COUNT(DISTINCT frequency_rank) AS distinctRanks FROM words WHERE created_by IS NULL").get(),
    uncreditedTatoeba: db.prepare("SELECT COUNT(*) AS n FROM examples e JOIN words w ON w.id = e.word_id WHERE w.created_by IS NULL AND e.attribution LIKE 'Tatoeba%' AND e.attribution NOT LIKE 'Tatoeba #% & #%'").get(),
    missingMeaningSample: db.prepare("SELECT lemma, pos, cefr FROM words WHERE created_by IS NULL AND trim(meaning_ja) = '' ORDER BY COALESCE(frequency_rank, 1000000), lemma LIMIT 30").all(),
    missingExampleSample: db.prepare("SELECT lemma, pos, cefr FROM words w WHERE created_by IS NULL AND NOT EXISTS (SELECT 1 FROM examples e WHERE e.word_id = w.id) ORDER BY COALESCE(frequency_rank, 1000000), lemma LIMIT 30").all(),
  };
}
