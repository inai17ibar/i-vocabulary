import { useEffect, useState } from "react";
import type { CamblyLesson, LessonTarget, TranscriptAnalysis } from "@ivocab/shared";
import { api, todayLocal } from "../api.ts";
import { SpeakButtons } from "../components/Pronounce.tsx";

export function Cambly() {
  const [section, setSection] = useState<"prep" | "after">("prep");
  return (
    <div>
      <div className="seg">
        <button className={section === "prep" ? "on" : ""} onClick={() => setSection("prep")}>レッスン前・中</button>
        <button className={section === "after" ? "on" : ""} onClick={() => setSection("after")}>レッスン後</button>
      </div>
      <p className="muted">
        {section === "prep"
          ? "使いたい語を決めて Cambly のチャットに貼り、レッスン中に使えたらチェック。"
          : "チャットログや講師のメモを貼ると、訂正・単語・表現を拾ってカードにします。"}
      </p>
      {section === "prep" ? <Prep /> : <AfterLesson />}
    </div>
  );
}

function Prep() {
  const [suggestions, setSuggestions] = useState<LessonTarget[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tutor, setTutor] = useState("");
  const [lessons, setLessons] = useState<CamblyLesson[]>([]);
  const [sheet, setSheet] = useState<{ lessonId: number; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    api.suggestions().then((r) => { setSuggestions(r.targets); setSelected(new Set(r.targets.map((t) => t.cardId))); });
    api.lessons().then((r) => setLessons(r.lessons));
  };
  useEffect(load, []);

  const create = async () => {
    const r = await api.createLesson({ lessonDate: todayLocal(), tutor: tutor || undefined, targetCardIds: [...selected] });
    setSheet({ lessonId: r.lesson.id, text: r.prepSheet });
    load();
  };
  const toggleUsed = async (lessonId: number, cardId: number, used: boolean) => {
    const r = await api.markUsed(lessonId, cardId, used);
    setLessons((ls) => ls.map((l) => (l.id === lessonId ? r.lesson : l)));
  };
  const copy = async () => {
    if (!sheet) return;
    try { await navigator.clipboard.writeText(sheet.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <>
      <div className="card">
        <h2>今日のレッスンで使う語</h2>
        <p className="muted">覚えたけれど忘れかけている語を優先して提案します。会話で実際に「使う」と、知っているだけの語が使える語になります。</p>
        {suggestions.length === 0 && <p className="sub">まだ学習済みのカードがありません。まず「今日」タブで新しい単語を学びましょう。</p>}
        {suggestions.map((t) => (
          <label className="check" key={t.cardId}>
            <input type="checkbox" checked={selected.has(t.cardId)} onChange={(e) => {
              const s = new Set(selected);
              e.target.checked ? s.add(t.cardId) : s.delete(t.cardId);
              setSelected(s);
            }} />
            <span>{t.headline}</span> <span className="tag">{t.itemType === "word" ? "単語" : "表現"}</span>
          </label>
        ))}
        {suggestions.length > 0 && (
          <>
            <label>講師名（任意）</label>
            <input value={tutor} onChange={(e) => setTutor(e.target.value)} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn block" disabled={selected.size === 0} onClick={create}>レッスンを作成して練習リストを出力</button>
            </div>
          </>
        )}
        {sheet && (
          <>
            <h3>Cambly のチャットに貼り付け</h3>
            <pre className="sheet">{sheet.text}</pre>
            <button className="ghost" onClick={copy}>{copied ? "コピーしました" : "コピー"}</button>
          </>
        )}
      </div>

      {lessons.map((l) => (
        <div className="card" key={l.id}>
          <div className="row spread">
            <strong>{l.lessonDate}{l.tutor && ` · ${l.tutor}`}</strong>
            <span className="muted">{l.targets.filter((t) => t.used).length} / {l.targets.length} 使えた</span>
          </div>
          <p className="muted">レッスン中・後に、実際に使えた語にチェック → 「正解」として復習スケジュールに反映されます。</p>
          {l.targets.map((t) => (
            <label className="check" key={t.cardId}>
              <input type="checkbox" checked={t.used} onChange={(e) => toggleUsed(l.id, t.cardId, e.target.checked)} />
              <span style={{ flex: 1 }}>{t.headline}</span>
              {t.itemType === "word" && <SpeakButtons text={t.headline} compact />}
            </label>
          ))}
        </div>
      ))}
    </>
  );
}

function AfterLesson() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<TranscriptAnalysis | null>(null);
  const [wordIds, setWordIds] = useState<Set<number>>(new Set());
  const [groupIds, setGroupIds] = useState<Set<number>>(new Set());
  const [corrections, setCorrections] = useState<Set<number>>(new Set());
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const analyze = async () => {
    const r = await api.analyze(text);
    setResult(r);
    setWordIds(new Set(r.knownWords.filter((w) => !w.hasCard).map((w) => w.wordId)));
    setGroupIds(new Set(r.expressions.filter((e) => !e.hasCard).map((e) => e.groupId)));
    setCorrections(new Set(r.corrections.map((_, i) => i)));
    setCustom({});
    setMessage("");
  };
  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number, on: boolean) => {
    const s = new Set(set);
    on ? s.add(id) : s.delete(id);
    setter(s);
  };
  const save = async () => {
    if (!result) return;
    const r = await api.addLessonCards({
      wordIds: [...wordIds],
      groupIds: [...groupIds],
      customWords: Object.entries(custom).filter(([, ja]) => ja.trim()).map(([lemma, meaningJa]) => ({ lemma, meaningJa })),
      corrections: result.corrections.filter((_, i) => corrections.has(i)),
    });
    setMessage(`${r.cards.length} 件を学習に追加しました（Cambly タグ付き）`);
  };

  return (
    <div className="card">
      <h2>レッスンのチャットログ・メモを貼り付け</h2>
      <p className="muted">
        Cambly のレッスン画面のチャット、レッスン後の文字起こし、講師のメモなど。「I go → I went」「Instead of X, say Y」のような訂正も自動で拾います。
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Tutor: What did you do last weekend?\nI go to there -> I went there\n..."} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn block" disabled={!text.trim()} onClick={analyze}>解析する</button>
      </div>

      {result && (
        <>
          <h3>講師の訂正（{result.corrections.length}）</h3>
          {result.corrections.length === 0 && <p className="muted">見つかりませんでした</p>}
          {result.corrections.map((c, i) => (
            <label className="check" key={i}>
              <input type="checkbox" checked={corrections.has(i)} onChange={(e) => toggle(corrections, setCorrections, i, e.target.checked)} />
              <span><s className="muted">{c.original}</s> → <strong>{c.better}</strong></span>
            </label>
          ))}

          <h3>出てきた単語（{result.knownWords.length}）</h3>
          {result.knownWords.map((w) => (
            <label className="check" key={w.wordId}>
              <input type="checkbox" disabled={w.hasCard} checked={wordIds.has(w.wordId)} onChange={(e) => toggle(wordIds, setWordIds, w.wordId, e.target.checked)} />
              <span>{w.lemma}</span> <span className="tag">{w.cefr}</span> {w.hasCard && <span className="muted">学習中</span>}
            </label>
          ))}

          <h3>出てきた表現（{result.expressions.length}）</h3>
          {result.expressions.map((e) => (
            <label className="check" key={e.groupId + e.text}>
              <input type="checkbox" disabled={e.hasCard} checked={groupIds.has(e.groupId)} onChange={(ev) => toggle(groupIds, setGroupIds, e.groupId, ev.target.checked)} />
              <span>{e.text}</span> <span className="muted">（{e.intentJa}）</span> {e.hasCard && <span className="muted">学習中</span>}
            </label>
          ))}

          <h3>辞書にない語の候補</h3>
          <p className="muted">覚えたい語に日本語の意味を入力すると、自分用の単語として追加されます。</p>
          {result.unknownCandidates.map((t) => (
            <div className="row" key={t} style={{ flexWrap: "nowrap", margin: "6px 0" }}>
              <span style={{ width: 110, flex: "none", overflowWrap: "anywhere" }}>{t}</span>
              <input placeholder="意味（任意）" value={custom[t] ?? ""} onChange={(e) => setCustom({ ...custom, [t]: e.target.value })} />
            </div>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn block" onClick={save}>選択した項目を学習に追加</button>
            {message && <span className="sub">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}
