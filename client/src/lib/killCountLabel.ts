/**
 * Self-review M2 — Arabic number–noun agreement for the dashboard's kill
 * counter ("{N} مجموعة · {M} إعلان").
 *
 *   1 → the noun + "واحد/واحدة"   (no numeral)
 *   2 → the dual                  (no numeral)
 *   3–10 → numeral + plural
 *   11+ → numeral + singular (accusative tamyīz for the masculine noun)
 *   0 → null: the caller hides that part
 *
 * The numeral is returned separately so the caller can wrap it in `.num`
 * and keep it left-to-right.
 */
export type KillCountNoun = "adset" | "ad";

export interface KillCountPart {
  /** The numeral to render LTR, or null when the words carry the count. */
  num: number | null;
  words: string;
}

const FORMS: Record<KillCountNoun, { one: string; two: string; few: string; many: string }> = {
  adset: { one: "مجموعة واحدة", two: "مجموعتان", few: "مجموعات", many: "مجموعة" },
  ad: { one: "إعلان واحد", two: "إعلانان", few: "إعلانات", many: "إعلانًا" },
};

export function killCountPart(n: number, noun: KillCountNoun): KillCountPart | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const f = FORMS[noun];
  if (n === 1) return { num: null, words: f.one };
  if (n === 2) return { num: null, words: f.two };
  if (n <= 10) return { num: n, words: f.few };
  return { num: n, words: f.many };
}

/** Plain-text form, e.g. "3 مجموعات" — used by tests and accessible labels. */
export function killCountText(n: number, noun: KillCountNoun): string | null {
  const p = killCountPart(n, noun);
  if (!p) return null;
  return p.num === null ? p.words : `${p.num} ${p.words}`;
}
