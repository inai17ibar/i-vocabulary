import { useCallback, useEffect, useRef, useState } from "react";
import type { Grade, QuizQuestion, ReviewResult, Word } from "@ivocab/shared";
import { examLabelsForCefr } from "@ivocab/shared";
import { api } from "../api.ts";
import { IconClose, IconSlow, IconSpeaker } from "../components/Icons.tsx";
import { MicCheck, SpeakButtons } from "../components/Pronounce.tsx";
import { speak, ttsSupported, useSpeechPrefs } from "../speech.ts";

const TASK_TITLES: Record<string, string> = {
  review: "今日の復習", new: "新しい単語・表現", synonym: "類義語ドリル", antonym: "対義語ドリル", paraphrase: "言い換えドリル",
};
const GRADES: { g: Grade; label: string; sub: string }[] = [
  { g: 1, label: "もう一度", sub: "忘れた" },
  { g: 2, label: "難しい", sub: "やっと" },
  { g: 3, label: "正解", sub: "思い出せた" },
  { g: 4, label: "簡単", sub: "即答" },
];
const REGISTER_JA = { casual: "カジュアル", neutral: "標準", formal: "フォーマル" } as const;

function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))}分後`;
  if (days < 1) return `${Math.round(days * 24)}時間後`;
  if (days < 30) return `${Math.round(days)}日後`;
  return `${Math.round(days / 30)}か月後`;
}

function WordDetail({ w }: { w: Word }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      {w.examples.map((ex) => (
        <div className="example" key={ex.en} style={{ borderTop: "none" }}>
          <SpeakButtons text={ex.en} compact />
          <div><div className="en">{ex.en}</div>{ex.ja && <div className="muted">{ex.ja}</div>}</div>
        </div>
      ))}
      {w.synonyms.length > 0 && (
        <div className="example">
          <strong style={{ minWidth: 34 }}>≒</strong>
          <div>{w.synonyms.map((s) => <div key={s.lemma}>{s.lemma}{s.note && <span className="muted">（{s.note}）</span>}</div>)}</div>
        </div>
      )}
      {w.antonyms.length > 0 && (
        <div className="example"><strong style={{ minWidth: 34 }}>⇔</strong><div>{w.antonyms.map((a) => a.lemma).join(", ")}</div></div>
      )}
    </div>
  );
}

export function Study({ task, onExit }: { task: string; onExit: () => void }) {
  const [prefs] = useSpeechPrefs();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [last, setLast] = useState<ReviewResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [error, setError] = useState("");
  const startedAt = useRef(Date.now());

  useEffect(() => {
    api.session(task).then((s) => setQuestions(s.questions)).catch((e) => setError(e.message));
  }, [task]);

  const q = questions?.[i];
  // 出題時の自動再生: リスニングは必須、単語カードは設定で
  useEffect(() => {
    startedAt.current = Date.now();
    if (!q) return;
    if (q.mode === "listening") speak(q.prompt);
    else if (prefs.autoplay && q.mode === "flashcard" && q.word) speak(q.word.lemma);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const submit = useCallback(async (body: { grade?: Grade; correct?: boolean }) => {
    if (!q) return;
    setSubmitting(true);
    try {
      const r = await api.review({
        cardId: q.cardId, mode: q.mode, durationMs: Date.now() - startedAt.current,
        clientReviewId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, ...body,
      });
      setLast(r);
      if (body.correct || (body.grade && body.grade > 1)) setCorrectCount((c) => c + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [q]);

  const next = useCallback(() => {
    setPicked(null);
    setRevealed(false);
    setLast(null);
    setI((n) => n + 1);
  }, []);

  const choose = useCallback((idx: number) => {
    if (!q || picked !== null) return;
    setPicked(idx);
    submit({ correct: idx === q.answerIndex });
    if (q.mode !== "listening" && q.choices[idx] && !q.group) speak(q.choices[q.answerIndex].text);
  }, [q, picked, submit]);

  // デスクトップ用キーボード操作: 1–4 で選択/評価、Space/Enter で表示・次へ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q || (e.target as HTMLElement).tagName === "INPUT") return;
      const n = Number(e.key);
      if (q.mode === "flashcard") {
        if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setRevealed(true); }
        else if (revealed && !last && n >= 1 && n <= 4) submit({ grade: n as Grade });
        else if (last && (e.key === " " || e.key === "Enter")) { e.preventDefault(); next(); }
      } else if (picked === null && n >= 1 && n <= q.choices.length) choose(n - 1);
      else if (last && (e.key === " " || e.key === "Enter")) { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, revealed, last, picked, submit, next, choose]);

  const shell = (body: React.ReactNode, actions?: React.ReactNode) => (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" aria-label="終了" onClick={onExit}><IconClose /></button>
        <div className="progress"><div style={{ width: `${questions?.length ? (i / questions.length) * 100 : 0}%` }} /></div>
        <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{questions ? `${Math.min(i + 1, questions.length)}/${questions.length}` : ""}</span>
      </div>
      <div className="study-body">{body}</div>
      {actions && <div className="study-actions">{actions}</div>}
    </div>
  );

  if (error) return shell(<p className="error">{error}</p>, <button className="btn block" onClick={onExit}>戻る</button>);
  if (!questions) return shell(<p className="muted">問題を準備中…</p>);
  if (!q) {
    return shell(
      <div style={{ textAlign: "center", paddingTop: 48 }}>
        <div style={{ fontSize: 48 }}>🎉</div>
        <h2>{TASK_TITLES[task]} 完了</h2>
        {questions.length === 0 ? <p className="sub">今は出題できるカードがありません。</p> : (
          <p className="sub">{questions.length} 問中 {correctCount} 問正解。<br />次の復習は忘れかけた頃に自動で出題されます。</p>
        )}
      </div>,
      <button className="btn block" onClick={onExit}>今日のタスクへ戻る</button>,
    );
  }

  const answered = q.mode === "flashcard" ? last !== null : picked !== null;
  const isListening = q.mode === "listening";
  const showWordAudio = q.word && !isListening && (q.mode === "flashcard" || q.mode === "synonym" || q.mode === "antonym");
  const nextBar = (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <span className="muted" style={{ flex: 1 }}>{last ? `次の復習: ${formatInterval(last.intervalDays)}` : "記録中…"}</span>
      <button className="btn" style={{ minWidth: 140 }} onClick={next} disabled={!last}>次へ</button>
    </div>
  );

  let actions: React.ReactNode = null;
  if (q.mode === "flashcard") {
    if (!revealed) actions = <button className="btn block" onClick={() => setRevealed(true)}>答えを見る</button>;
    else if (!last) actions = (
      <div className="grades">
        {GRADES.map((g) => (
          <button key={g.g} className={`g${g.g}`} disabled={submitting} onClick={() => submit({ grade: g.g })}>{g.label}<small>{g.sub}</small></button>
        ))}
      </div>
    );
    else actions = nextBar;
  } else if (answered) actions = nextBar;

  const body = (
    <>
      {q.word && (
        <div className="row center" style={{ marginTop: 4 }}>
          <span className="tag">{q.word.pos}</span>
          <span className="tag">CEFR {q.word.cefr}</span>
          <span className="tag">英検 {examLabelsForCefr(q.word.cefr).eiken}</span>
        </div>
      )}

      {isListening && !answered ? (
        <div className="listen-stage">
          <button className="icon-btn primary" aria-label="もう一度聞く" onClick={() => speak(q.prompt)}><IconSpeaker size={34} /></button>
          <button className="ghost" onClick={() => speak(q.prompt, { slow: true })}><span className="row" style={{ gap: 6 }}><IconSlow size={18} />ゆっくり</span></button>
          {!ttsSupported() && <p className="muted">この端末は読み上げに対応していないため、綴りを表示します: {q.prompt}</p>}
        </div>
      ) : (
        <div className={`quiz-prompt ${q.prompt.length > 22 ? "small" : ""}`}>{q.prompt}</div>
      )}
      {(showWordAudio || (isListening && answered)) && q.word?.ipa && <div className="ipa">{q.word.ipa}</div>}
      {(showWordAudio || (isListening && answered)) && q.word && <div className="row center"><SpeakButtons text={q.word.lemma} /></div>}
      <div className="instruction">{q.instruction}</div>

      {q.mode === "flashcard" ? (
        revealed && (
          <>
            {q.word && (
              <>
                <div className="meaning">{q.word.meaningJa || q.word.definitionEn}</div>
                <MicCheck target={q.word.lemma} />
                <WordDetail w={q.word} />
              </>
            )}
            {q.group && (
              <div className="card">
                {q.group.expressions.map((e) => (
                  <div className="expr-row" key={e.id}>
                    <SpeakButtons text={e.text} compact />
                    <span className="txt">{e.text}{e.note && <span className="muted" style={{ display: "block" }}>{e.note}</span>}</span>
                    <span className="tag">{REGISTER_JA[e.register]}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <>
          <div className="choices">
            {q.choices.map((c, idx) => {
              const cls = picked === null ? "" : idx === q.answerIndex ? "correct" : idx === picked ? "wrong" : "";
              return (
                <div key={idx} className={`choice ${cls}`} role="button" tabIndex={picked === null ? 0 : -1} aria-disabled={picked !== null}
                  onClick={() => choose(idx)} onKeyDown={(e) => e.key === "Enter" && choose(idx)}>
                  <span className="txt">
                    {c.text}
                    {picked !== null && c.hint && <span className="hint">{c.hint}</span>}
                  </span>
                  {picked !== null && <SpeakButtons text={c.text} compact />}
                </div>
              );
            })}
          </div>
          {picked !== null && (
            <>
              {q.word && (isListening || q.mode === "meaning" || q.mode === "cloze") && <MicCheck target={q.word.lemma} />}
              <div className="explain">{q.explanation}</div>
            </>
          )}
        </>
      )}
    </>
  );

  return shell(body, actions);
}
