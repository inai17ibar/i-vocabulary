import { useEffect, useState } from "react";
import type { ExpressionGroup, Word } from "@ivocab/shared";
import { CEFR_LEVELS } from "@ivocab/shared";
import { api } from "../api.ts";
import { SpeakButton } from "../components/Speak.tsx";

const REGISTER_JA = { casual: "カジュアル", neutral: "標準", formal: "フォーマル" } as const;

export function Words() {
  const [tab, setTab] = useState<"words" | "expressions">("words");
  const [q, setQ] = useState("");
  const [cefr, setCefr] = useState("");
  const [words, setWords] = useState<{ items: Word[]; total: number } | null>(null);
  const [groups, setGroups] = useState<ExpressionGroup[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());

  const refreshCards = () => api.cards().then((r) => setOwned(new Set(r.cards.map((c) => `${c.itemType}:${c.itemId}`))));
  useEffect(() => { refreshCards(); api.expressions().then((r) => setGroups(r.groups)); }, []);
  useEffect(() => {
    const t = setTimeout(() => api.words({ q, cefr }).then(setWords), 200);
    return () => clearTimeout(t);
  }, [q, cefr]);

  const add = async (itemType: "word" | "expression", id: number) => {
    await api.addCard(itemType, id);
    refreshCards();
  };

  return (
    <div>
      <div className="row">
        <button className={tab === "words" ? "btn" : "ghost"} onClick={() => setTab("words")}>単語（類義語・対義語）</button>
        <button className={tab === "expressions" ? "btn" : "ghost"} onClick={() => setTab("expressions")}>いろんな言い方</button>
      </div>

      {tab === "words" && (
        <>
          <div className="row" style={{ marginTop: 12, flexWrap: "nowrap" }}>
            <input placeholder="英単語 / 日本語で検索" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={cefr} onChange={(e) => setCefr(e.target.value)} style={{ width: 120 }}>
              <option value="">全レベル</option>
              {CEFR_LEVELS.map((c) => <option key={c} value={c}>CEFR {c}</option>)}
            </select>
          </div>
          <p className="muted">{words?.total ?? 0} 語</p>
          <div className="card word-list">
            {words?.items.map((w) => (
              <div className="w" key={w.id}>
                <div className="row spread">
                  <div className="row">
                    <strong style={{ fontSize: 17 }}>{w.lemma}</strong>
                    <span className="tag">{w.pos}</span>
                    <span className="tag">{w.cefr}</span>
                    <SpeakButton text={w.lemma} />
                  </div>
                  {owned.has(`word:${w.id}`) ? <span className="muted">学習中</span> : <button className="ghost" onClick={() => add("word", w.id)}>＋ 学習に追加</button>}
                </div>
                <div>{w.meaningJa || <span className="muted">{w.definitionEn}</span>}</div>
                {w.synonyms.length > 0 && (
                  <div className="sub" style={{ fontSize: 14 }}>
                    ≒ {w.synonyms.map((s, i) => <span key={s.lemma} title={s.note ?? ""}>{i > 0 && ", "}{s.lemma}{s.note && <span className="muted">（{s.note}）</span>}</span>)}
                  </div>
                )}
                {w.antonyms.length > 0 && <div className="sub" style={{ fontSize: 14 }}>⇔ {w.antonyms.map((a) => a.lemma).join(", ")}</div>}
                {w.examples[0] && <div className="muted">{w.examples[0].en}{w.examples[0].ja && ` — ${w.examples[0].ja}`}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "expressions" && groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row spread">
            <div>
              <strong>{g.intentJa}</strong> <span className="muted">{g.intentEn} · {g.scene} · {g.cefr}</span>
            </div>
            {owned.has(`expression:${g.id}`) ? <span className="muted">学習中</span> : <button className="ghost" onClick={() => add("expression", g.id)}>＋ 学習に追加</button>}
          </div>
          {g.expressions.map((e) => (
            <div key={e.id} className="row" style={{ padding: "4px 0" }}>
              <span className="tag" style={{ minWidth: 76, textAlign: "center" }}>{REGISTER_JA[e.register]}</span>
              <span>{e.text}</span>
              {e.note && <span className="muted">{e.note}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
