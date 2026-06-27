export type KoreanCopyKind = "headline" | "subheadline" | "bullet" | "trust" | "cta" | "body";

export interface KoreanHumanizeOptions {
  kind?: KoreanCopyKind;
  maxLength?: number;
}

const LEADING_CONNECTORS = /^(또한|따라서|즉|나아가|결론적으로|종합하면|한편|더불어|무엇보다)[,\s]+/;

const TRANSLATIONESE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\s*을 통해\s*/g, "으로 "],
  [/\s*를 통해\s*/g, "로 "],
  [/\s*에 대해\s*/g, "을 "],
  [/\s*에 대한\s*/g, " 관련 "],
  [/\s*에 있어서\s*/g, "에서 "],
  [/가지고 있습니다/g, "있습니다"],
  [/가지고 있는/g, "있는"],
  [/되어진/g, "된"],
  [/되어지는/g, "되는"],
  [/사용되어집니다/g, "사용됩니다"],
  [/제공되어집니다/g, "제공됩니다"],
  [/가능하게 합니다/g, "쉽게 합니다"],
  [/가능하도록 합니다/g, "쉽게 합니다"],
  [/도움을 줍니다/g, "돕습니다"],
  [/효율성을 높일 수 있습니다/g, "효율을 높입니다"],
  [/효율을 높일 수 있습니다/g, "효율을 높입니다"],
  [/확인할 수 있습니다/g, "확인합니다"],
  [/경험할 수 있습니다/g, "경험합니다"],
  [/느낄 수 있습니다/g, "느낍니다"],
  [/볼 수 있습니다/g, "봅니다"],
  [/쓸 수 있습니다/g, "씁니다"],
  [/사용할 수 있습니다/g, "사용합니다"],
  [/관리할 수 있습니다/g, "관리합니다"],
  [/만나볼 수 있습니다/g, "만납니다"],
  [/누릴 수 있습니다/g, "누립니다"],
  [/시사하는 바가 큽니다/g, ""],
  [/주목할 만한/g, "눈에 띄는"],
  [/혁신적인/g, "새로운"],
  [/완벽한/g, "빈틈없는"],
  [/압도적인/g, "뚜렷한"],
  [/차원이 다른/g, "확실히 다른"],
  [/매우 /g, ""],
  [/정말 /g, ""]
];

const KIND_LIMITS: Record<KoreanCopyKind, number> = {
  headline: 22,
  subheadline: 44,
  bullet: 18,
  trust: 28,
  cta: 10,
  body: 80
};

export function humanizeKoreanCopy(value: string, options: KoreanHumanizeOptions = {}) {
  const text = normalizeCopyWhitespace(value);
  if (!text || !containsHangul(text)) return text;

  const limit = options.maxLength ?? KIND_LIMITS[options.kind ?? "body"];
  let next = text.replace(LEADING_CONNECTORS, "");

  for (const [pattern, replacement] of TRANSLATIONESE_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  next = next
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?。！？:：])/g, "$1")
    .replace(/\s+(은|는|이|가|을|를|에|에서|으로|로|와|과|도|만|의)\s+/g, "$1 ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();

  next = removeWeakEnding(next, options.kind);
  return clampKoreanCopy(next, limit);
}

export function humanizeKoreanList(values: string[], options: KoreanHumanizeOptions = {}) {
  return values.map((value) => humanizeKoreanCopy(value, options)).filter(Boolean);
}

function normalizeCopyWhitespace(value: string) {
  return String(value ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsHangul(value: string) {
  return /[가-힣]/.test(value);
}

function removeWeakEnding(value: string, kind: KoreanCopyKind | undefined) {
  let next = value.trim();
  if (kind === "headline" || kind === "cta") {
    next = next.replace(/[.!?。！？]+$/g, "");
  }

  if (kind === "headline" || kind === "bullet" || kind === "cta") {
    next = next
      .replace(/(할 수 있는|볼 수 있는|쓸 수 있는|될 수 있는)$/g, "")
      .replace(/(위한|통한|대한|있는|없는|하는|되는)$/g, "")
      .replace(/[,:：·ㆍ/\-\s]+$/g, "")
      .trim();
  }

  return next;
}

function clampKoreanCopy(value: string, limit: number) {
  if (!limit || value.length <= limit) return value;

  const sliced = value.slice(0, limit + 1);
  const boundary = Math.max(
    sliced.lastIndexOf(" "),
    sliced.lastIndexOf(","),
    sliced.lastIndexOf("·"),
    sliced.lastIndexOf("/"),
    sliced.lastIndexOf("(")
  );
  const clipped = boundary >= Math.floor(limit * 0.55) ? sliced.slice(0, boundary) : value.slice(0, limit);
  return clipped.replace(/[,:：·ㆍ/\-\s(]+$/g, "").trim();
}
