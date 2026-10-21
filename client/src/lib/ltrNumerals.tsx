import type { ReactNode } from "react";

// Moved from pages/Dashboard.tsx (spec 016 self-review N11) so the decision
// table can use it too without importing the page. Dashboard re-exports it.

/**
 * Matches one numeric run: an optional ASCII currency symbol, digits
 * with thousands separators and an optional decimal part, and an
 * optional trailing `%` or `+`.
 *
 * Arabic currency symbols (د.إ, ر.س, …) are deliberately NOT part of
 * this pattern — they are strong-RTL text belonging to the sentence,
 * not to the number, and pulling them inside the isolate would reorder
 * them against the surrounding line.
 */
const FIGURE_RE = /[$£€]?\d[\d,]*(?:\.\d+)?%?\+?/g;

/**
 * Splits a diagnosis sentence so every figure in it renders
 * left-to-right inside the RTL layout (Constitution III, contract C5.2).
 *
 * Each numeric run is wrapped in `.num`
 * (`direction: ltr; unicode-bidi: isolate` — `client/src/index.css`);
 * the Arabic between runs is returned untouched, so the sentence
 * survives the split intact.
 *
 * A table cell holding a bare number can simply carry
 * `className="num"`. Finding text cannot: it arrives from the engine as
 * ONE Arabic sentence with its figures embedded, which is why it has to
 * be split here rather than wrapped at the call site.
 *
 * @param text the finding's `text_ar`, or the account card's `reason_ar`
 * @returns alternating plain-text and `.num`-wrapped nodes, in order
 */
export function withLtrNumerals(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of Array.from(text.matchAll(FIGURE_RE))) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <span className="num" key={`${i}-${m[0]}`}>
        {m[0]}
      </span>
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
