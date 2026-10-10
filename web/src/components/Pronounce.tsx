import { useState } from "react";
import { listen, type PronunciationResult, speak, sttSupported, ttsSupported, useSpeechPrefs } from "../speech.ts";
import { IconMic, IconSlow, IconSpeaker } from "./Icons.tsx";

/** 再生（通常・ゆっくり）ボタン */
export function SpeakButtons({ text, compact = false }: { text: string; compact?: boolean }) {
  if (!ttsSupported()) return null;
  return (
    <span className="speak-btns">
      <button type="button" className={`icon-btn ${compact ? "sm" : ""}`} aria-label={`${text} を再生`} onClick={(e) => { e.stopPropagation(); speak(text); }}>
        <IconSpeaker size={compact ? 18 : 22} />
      </button>
      {!compact && (
        <button type="button" className="icon-btn" aria-label={`${text} をゆっくり再生`} onClick={(e) => { e.stopPropagation(); speak(text, { slow: true }); }}>
          <IconSlow />
        </button>
      )}
    </span>
  );
}

/** 発音チェック: マイクで言ってみて、音声認識で聞き取れたかを判定 */
export function MicCheck({ target, label = "言ってみる" }: { target: string; label?: string }) {
  const [prefs] = useSpeechPrefs();
  const [state, setState] = useState<"idle" | "listening">("idle");
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [error, setError] = useState("");
  if (!sttSupported()) return null;

  const start = async () => {
    setResult(null);
    setError("");
    setState("listening");
    try {
      setResult(await listen(target, prefs.accent));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setState("idle");
    }
  };

  return (
    <div className="mic-check">
      <button type="button" className={`mic-btn ${state === "listening" ? "on" : ""}`} onClick={start} disabled={state === "listening"}>
        <IconMic /> {state === "listening" ? "聞いています…" : label}
      </button>
      {result && (
        <div className={`mic-result ${result.ok ? "ok" : "ng"}`} role="status">
          {result.ok ? "◎ 伝わる発音です" : "△ もう一度"}
          <span className="muted">
            {" "}聞き取り: “{result.heard || "—"}”{result.confidence !== null && ` · 確信度 ${Math.round(result.confidence * 100)}%`}
          </span>
          {!result.ok && <button type="button" className="link" onClick={() => speak(target, { slow: true })}>お手本をゆっくり聞く</button>}
        </div>
      )}
      {error && <div className="mic-result ng" role="status">{error}</div>}
    </div>
  );
}
