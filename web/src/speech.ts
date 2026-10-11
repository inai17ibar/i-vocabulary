/**
 * 発音まわり（Web Speech API）。
 *  - 読み上げ: speechSynthesis（iOS 版では AVSpeechSynthesizer）
 *  - 発音チェック: SpeechRecognition（Chrome / Safari。iOS 版では SFSpeechRecognizer）
 * 設定は端末ごとの好みなので localStorage に保存する。
 */
import { useEffect, useState } from "react";

export type Accent = "en-US" | "en-GB";
export interface SpeechPrefs {
  accent: Accent;
  rate: number;
  /** 新出カード・リスニング問題で自動再生する */
  autoplay: boolean;
}

const PREFS_KEY = "ivocab.speech";
const DEFAULT_PREFS: SpeechPrefs = { accent: "en-US", rate: 0.95, autoplay: true };

export function loadPrefs(): SpeechPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: SpeechPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  window.dispatchEvent(new Event("ivocab:speechprefs"));
}

export function useSpeechPrefs(): [SpeechPrefs, (p: SpeechPrefs) => void] {
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    const on = () => setPrefs(loadPrefs());
    window.addEventListener("ivocab:speechprefs", on);
    return () => window.removeEventListener("ivocab:speechprefs", on);
  }, []);
  return [prefs, savePrefs];
}

export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Apple 端末の声リストに入っているネタ用・旧式の声。名前順で先頭に来る（Albert, Bad News…）ので
 * 除外しないとロボット声や効果音で読み上げてしまう。Eloquence 系（Eddy, Flo…）も発音が粗いので避ける
 */
const NOVELTY_VOICE = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
/** 高品質な声の目印（ダウンロード版の高音質・Siri・クラウド音声） */
const HIGH_QUALITY = /premium|enhanced|siri|natural|neural|google|online/i;
/** 定評のある標準の声 */
const GOOD_NAMES: Record<Accent, RegExp> = {
  "en-US": /^(samantha|ava|allison|susan|zoe|nicky|evan|tom|alex|aaron|nathan|joelle|noelle)\b/i,
  "en-GB": /^(daniel|kate|serena|arthur|martha|oliver|stephanie|jamie)\b/i,
};

/** 指定アクセントの声。ブラウザの声リストは非同期に読み込まれるので毎回引く */
export function pickVoice(voices: SpeechSynthesisVoice[], accent: Accent): SpeechSynthesisVoice | undefined {
  const usable = voices.filter((v) => !NOVELTY_VOICE.test(v.name));
  const exact = usable.filter((v) => v.lang.replace("_", "-") === accent);
  return exact.find((v) => HIGH_QUALITY.test(v.name))
    ?? exact.find((v) => GOOD_NAMES[accent].test(v.name))
    ?? exact.find((v) => v.default)
    ?? exact[0]
    ?? usable.find((v) => v.lang.startsWith("en"));
}

// Chrome は speak() 中の utterance が GC されると途中で止まるので参照を持っておく
let current: SpeechSynthesisUtterance | null = null;
let pending: ReturnType<typeof setTimeout> | undefined;

export function speak(text: string, opts: { slow?: boolean; onEnd?: () => void } = {}) {
  if (!ttsSupported()) return;
  const prefs = loadPrefs();
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text.replace(/\.\.\.|…/g, ", ").replace(/_{3,}/g, "blank"));
  u.lang = prefs.accent;
  const voice = pickVoice(synth.getVoices(), prefs.accent);
  if (voice) u.voice = voice;
  u.rate = opts.slow ? Math.max(0.5, prefs.rate * 0.6) : prefs.rate;
  u.onend = () => { if (current === u) current = null; opts.onEnd?.(); };
  current = u;
  clearTimeout(pending);
  // Safari / iOS は cancel() 直後の speak() で冒頭が欠けたり音が乱れたりするので、再生中だけ止めて少し待つ
  if (synth.speaking || synth.pending) {
    synth.cancel();
    pending = setTimeout(() => synth.speak(u), 120);
  } else {
    synth.speak(u);
  }
}

// 声リストは初回 getVoices() では空のことがあるので、読み込みを先に促しておく
if (ttsSupported()) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices());
}

// ---- 発音チェック（音声認識） -------------------------------------------

interface RecognitionAlternative { transcript: string; confidence: number }
interface RecognitionEvent { results: ArrayLike<ArrayLike<RecognitionAlternative>> }
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const sttSupported = () => typeof window !== "undefined" && recognitionCtor() !== null;

export interface PronunciationResult {
  ok: boolean;
  heard: string;
  /** 認識エンジンの確信度 (0〜1)。取得できない場合 null */
  confidence: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\.\.\.|…/g, " ").replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();

/** 認識結果の候補のどれかに目標の語（句）が含まれていれば OK */
export function judgePronunciation(target: string, alternatives: RecognitionAlternative[]): PronunciationResult {
  const t = norm(target);
  const hit = alternatives.find((a) => ` ${norm(a.transcript)} `.includes(` ${t} `));
  const best = hit ?? alternatives[0];
  return { ok: !!hit, heard: best?.transcript ?? "", confidence: best && best.confidence > 0 ? best.confidence : null };
}

export function listen(target: string, accent: Accent): Promise<PronunciationResult> {
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.reject(new Error("この端末のブラウザは音声認識に対応していません"));
  window.speechSynthesis?.cancel();
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = accent;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    let done = false;
    const timer = setTimeout(() => rec.abort(), 8000);
    rec.onresult = (e) => {
      done = true;
      clearTimeout(timer);
      resolve(judgePronunciation(target, Array.from(e.results[0] ?? [])));
    };
    rec.onerror = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(e.error === "not-allowed" ? "マイクの使用が許可されていません" : e.error === "no-speech" ? "声が聞き取れませんでした" : `音声認識エラー: ${e.error}`));
    };
    rec.onend = () => {
      clearTimeout(timer);
      if (!done) { done = true; reject(new Error("声が聞き取れませんでした")); }
    };
    rec.start();
  });
}
