/** 英文テキスト処理（活用形の生成・トークン化）。依存ライブラリなしの軽量実装 */

const IRREGULAR: Record<string, string[]> = {
  buy: ["bought"], sell: ["sold"], begin: ["began", "begun"], forget: ["forgot", "forgotten"],
  leave: ["left"], choose: ["chose", "chosen"], lend: ["lent"], overcome: ["overcame"],
  get: ["got", "gotten"], take: ["took", "taken"], make: ["made"], go: ["went", "gone"],
  think: ["thought"], know: ["knew", "known"], say: ["said"], tell: ["told"], give: ["gave", "given"],
  find: ["found"], keep: ["kept"], feel: ["felt"], bring: ["brought"], teach: ["taught"],
  catch: ["caught"], understand: ["understood"], speak: ["spoke", "spoken"], write: ["wrote", "written"],
  run: ["ran"], come: ["came"], see: ["saw", "seen"], hold: ["held"], meet: ["met"], pay: ["paid"],
  good: ["better", "best"], bad: ["worse", "worst"], far: ["farther", "further"],
};

const VOWELS = /[aeiou]/;

/** 原形から考えられる活用形を列挙する（過剰生成は許容） */
export function inflections(lemma: string): string[] {
  const w = lemma.toLowerCase();
  const out = new Set<string>([w]);
  if (w.includes(" ")) return [w];
  for (const irr of IRREGULAR[w] ?? []) out.add(irr);
  out.add(w + "s");
  out.add(w + "es");
  out.add(w + "ed");
  out.add(w + "ing");
  out.add(w + "er");
  out.add(w + "est");
  out.add(w + "ly");
  if (w.endsWith("e")) {
    out.add(w + "d");
    out.add(w.slice(0, -1) + "ing");
    out.add(w + "r");
    out.add(w + "st");
  }
  if (w.endsWith("y") && w.length > 2 && !VOWELS.test(w[w.length - 2])) {
    const stem = w.slice(0, -1);
    out.add(stem + "ies");
    out.add(stem + "ied");
    out.add(stem + "ier");
    out.add(stem + "iest");
    out.add(stem + "ily");
  }
  // 子音+短母音+子音で終わる語は子音を重ねる (stop -> stopped, big -> bigger)
  const m = w.match(/[^aeiou]([aeiou])([bdgklmnprt])$/);
  if (m && w.length <= 6) {
    const c = m[2];
    out.add(w + c + "ed");
    out.add(w + c + "ing");
    out.add(w + c + "er");
    out.add(w + c + "est");
  }
  if (w.endsWith("le")) out.add(w.slice(0, -1) + "y");
  return [...out];
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 例文中の lemma（または活用形）を空欄にする。見つからなければ null */
export function makeCloze(sentence: string, lemma: string): string | null {
  const forms = inflections(lemma).sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${forms.map(escapeRegExp).join("|")})\\b`, "i");
  if (!re.test(sentence)) return null;
  return sentence.replace(re, "_____");
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*[a-z]|[a-z]/g) ?? []).map((t) => t.replace(/'s$/, ""));
}

/** 表現テキストを照合用に正規化（"..." は区切りとして扱う） */
export function expressionFragments(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/\.\.\.|…/)
    .map((f) => f.replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim())
    .filter((f) => f.length >= 6);
}

export function normalizeForMatch(text: string): string {
  return " " + text.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim() + " ";
}

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves yes yeah okay ok oh um uh like just really actually also well know think going go get got gonna wanna want right thing things lot maybe much many said say says tutor student hello hi thanks thank bye good great nice`.split(/\s+/),
);
