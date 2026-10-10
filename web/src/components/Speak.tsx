/** ブラウザの音声合成で発音を再生（iOS 版では AVSpeechSynthesizer に置き換え） */
export function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\.\.\./g, " "));
  u.lang = "en-US";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export function SpeakButton({ text }: { text: string }) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return (
    <button type="button" className="ghost" aria-label={`${text} を発音`} onClick={(e) => { e.stopPropagation(); speak(text); }} style={{ padding: "4px 10px" }}>
      ▶ 発音
    </button>
  );
}
