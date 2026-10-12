import { useEffect, useState } from "react";
import type { ExpressionGroup, Word } from "@ivocab/shared";
import { CEFR_LEVELS } from "@ivocab/shared";
import { api } from "../api.ts";
import { MicCheck, SpeakButtons } from "../components/Pronounce.tsx";

const REGISTER_JA = { casual: "カジュアル", neutral: "標準", formal: "フォーマル" } as const;

export function Words() {
  const [tab, setTab] = useState<"words" | "expressions">("words");
  const [q, setQ] = useState("");
  const [cefr, setCefr] = useState("");
  const [words, setWords] = useState<{ items: Word[]; total: number } | null>(null);
  const [groups, setGroups] = useState<ExpressionGroup[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);

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
  const addBtn = (type: "word" | "expression", id: number) =>
    owned.has(`${type}:${id}`) ? <span className="tag">学習中</span> : <button className="ghost" onClick={() => add(type, id)}>＋ 追加</button>;

  return (
    <div>
      <div className="seg">
        <button className={tab === "words" ? "on" : ""} onClick={() => setTab("words")}>単語</button>
        <button className={tab === "expressions" ? "on" : ""} onClick={() => setTab("expressions")}>いろんな言い方</button>
      </div>

      {tab === "words" && (
        <>
          <div className="search">
            <input type="search" placeholder="英単語 / 日本語で検索" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={cefr} onChange={(e) => setCefr(e.target.value)} aria-label="CEFR レベル">
              <option value="">全レベル</option>
              {CEFR_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <p className="muted" style={{ margin: "0 0 4px" }}>{words?.total ?? 0} 語 · タップで例文と発音練習</p>
          <div className="card word-list" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {words?.items.map((w) => (
              <div className="w" key={w.id}>
                <div className="word-head">
                  <div className="grow" role="button" tabIndex={0} onClick={() => setOpen(open === w.id ? null : w.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(open === w.id ? null : w.id)} style={{ cursor: "pointer" }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="lemma">{w.lemma}</span>
                      <span className="tag">{w.cefr}</span>
                      {w.tags.includes("spoken") && <span className="tag tag-spoken">会話</span>}
                      {w.tags.includes("academic") && <span className="tag tag-academic">アカデミック</span>}
                    </div>
                    <div className="muted">{w.ipa ? `${w.ipa} · ` : ""}{w.pos}</div>
                  </div>
                  <SpeakButtons text={w.lemma} compact />
                </div>
                <div style={{ marginTop: 2 }}>{w.meaningJa || <span className="muted">{w.definitionEn}</span>}</div>
                {w.synonyms.length > 0 && <div className="sub" style={{ fontSize: 14 }}>≒ {w.synonyms.map((s) => s.lemma).join(", ")}</div>}
                {w.antonyms.length > 0 && <div className="sub" style={{ fontSize: 14 }}>⇔ {w.antonyms.map((a) => a.lemma).join(", ")}</div>}
                {open === w.id && (
                  <div style={{ marginTop: 8 }}>
                    {w.examples.map((ex) => (
                      <div className="example" key={ex.en}>
                        <SpeakButtons text={ex.en} compact />
                        <div><div className="en">{ex.en}</div>{ex.ja && <div className="muted">{ex.ja}</div>}{ex.attribution && <div className="credit">{ex.attribution}</div>}</div>
                      </div>
                    ))}
                    {w.synonyms.some((s) => s.note) && (
                      <div className="example"><div className="muted">{w.synonyms.filter((s) => s.note).map((s) => `${s.lemma}: ${s.note}`).join(" / ")}</div></div>
                    )}
                    <div className="row spread" style={{ marginTop: 4 }}>
                      <MicCheck target={w.lemma} />
                      {addBtn("word", w.id)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "expressions" && groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row spread" style={{ flexWrap: "nowrap", marginBottom: 6 }}>
            <div>
              <strong>{g.intentJa}</strong>
              <div className="muted">{g.intentEn} · {g.scene} · {g.cefr}</div>
            </div>
            {addBtn("expression", g.id)}
          </div>
          {g.expressions.map((e) => (
            <div key={e.id} className="expr-row">
              <SpeakButtons text={e.text} compact />
              <span className="txt">{e.text}{e.note && <span className="muted" style={{ display: "block" }}>{e.note}</span>}</span>
              <span className="tag">{REGISTER_JA[e.register]}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
