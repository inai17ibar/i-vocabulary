import { useEffect, useRef, useState } from "react";
import type { Grade, QuizQuestion, ReviewResult } from "@ivocab/shared";
import { examLabelsForCefr } from "@ivocab/shared";
import { api } from "../api.ts";
import { SpeakButton } from "../components/Speak.tsx";

const TASK_TITLES: Record<string, string> = {
  review: "今日の復習", new: "新しい単語・表現", synonym: "類義語ドリル", antonym: "対義語ドリル", paraphrase: "言い換えドリル",
};
const GRADES: { g: Grade; label: string; sub: string }[] = [
  { g: 1, label: "もう一度", sub: "思い出せない" },
  { g: 2, label: "難しい", sub: "時間がかかった" },
  { g: 3, label: "正解", sub: "思い出せた" },
  { g: 4, label: "簡単", sub: "即答できた" },
];

function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))}分後`;
  if (days < 1) return `${Math.round(days * 24)}時間後`;
  if (days < 30) return `${Math.round(days)}日後`;
  return `${Math.round(days / 30)}か月後`;
}

export function Study({ task, onExit }: { task: string; onExit: () => void }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [last, setLast] = useState<ReviewResult | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [error, setError] = useState("");
  const startedAt = useRef(Date.now());

  useEffect(() => {
    api.session(task).then((s) => setQuestions(s.questions)).catch((e) => setError(e.message));
  }, [task]);
  useEffect(() => { startedAt.current = Date.now(); }, [i]);

  if (error) return <p className="error">{error}</p>;
  if (!questions) return <p className="muted">問題を準備中…</p>;

  const q = questions[i];
  if (!q) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <h2>{TASK_TITLES[task]} 完了</h2>
        {questions.length === 0 ? <p className="sub">今は出題できるカードがありません。</p> : (
          <p className="sub">{questions.length} 問中 {correctCount} 問正解。次の復習は忘れかけた頃に自動で出題されます。</p>
        )}
        <button className="btn" onClick={onExit}>今日のタスクへ戻る</button>
      </div>
    );
  }

  const clientReviewId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const submit = async (body: { grade?: Grade; correct?: boolean }) => {
    try {
      const r = await api.review({ cardId: q.cardId, mode: q.mode, durationMs: Date.now() - startedAt.current, clientReviewId: clientReviewId(), ...body });
      setLast(r);
      if (body.correct || (body.grade && body.grade > 1)) setCorrectCount((c) => c + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const next = () => {
    setPicked(null);
    setRevealed(false);
    setLast(null);
    setI(i + 1);
  };
  const choose = (idx: number) => {
    if (picked !== null) return;
    setPicked(idx);
    submit({ correct: idx === q.answerIndex });
  };
  const speakText = q.word?.lemma ?? (q.mode === "paraphrase" ? q.prompt.replace(/"/g, "") : null);
  const answered = q.mode === "flashcard" ? last !== null : picked !== null;

  return (
    <div>
      <div className="row spread">
        <button className="ghost" onClick={onExit}>← 終了</button>
        <span className="muted">{TASK_TITLES[task]} · {i + 1} / {questions.length}</span>
      </div>
      <div className="progress"><div style={{ width: `${(i / questions.length) * 100}%` }} /></div>

      <div className="card">
        {q.word && (
          <div className="row" style={{ justifyContent: "center" }}>
            <span className="tag">{q.word.pos}</span>
            <span className="tag">CEFR {q.word.cefr}</span>
            <span className="tag">英検 {examLabelsForCefr(q.word.cefr).eiken}</span>
          </div>
        )}
        <div className={`quiz-prompt ${q.prompt.length > 24 ? "small" : ""}`}>{q.prompt}</div>
        {q.word?.ipa && (q.mode === "flashcard" || q.mode === "synonym" || q.mode === "antonym") && <div className="instruction">{q.word.ipa}</div>}
        <div className="instruction">{q.instruction}</div>
        {speakText && q.mode !== "meaning" && q.mode !== "cloze" && <div className="row" style={{ justifyContent: "center", marginBottom: 12 }}><SpeakButton text={speakText} /></div>}

        {q.mode === "flashcard" ? (
          !revealed ? (
            <button className="btn" style={{ width: "100%" }} onClick={() => setRevealed(true)}>答えを見る</button>
          ) : (
            <>
              {q.word && <div className="quiz-prompt small">{q.word.meaningJa || q.word.definitionEn}</div>}
              <div className="explain">{q.explanation}</div>
              {!last && (
                <div className="grades">
                  {GRADES.map((g) => (
                    <button key={g.g} onClick={() => submit({ grade: g.g })}>{g.label}<small>{g.sub}</small></button>
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
                  <button key={idx} className={`choice ${cls}`} disabled={picked !== null} onClick={() => choose(idx)}>
                    {c.text}
                    {picked !== null && c.hint && <span className="hint">{c.hint}</span>}
                  </button>
                );
              })}
            </div>
            {picked !== null && <div className="explain">{q.explanation}</div>}
          </>
        )}

        {answered && (
          <div className="row spread" style={{ marginTop: 12 }}>
            <span className="muted">{last ? `次の復習: ${formatInterval(last.intervalDays)}` : "記録中…"}</span>
            <button className="btn" onClick={next} disabled={!last}>次へ →</button>
          </div>
        )}
      </div>
    </div>
  );
}
