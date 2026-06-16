/** Formatting helpers — all numeric output is LTR monospace via the .num class. */

export function money(n: number | null | undefined, currency = "$"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "∞";
  return `${currency}${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 1 })}`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** CPA cell color relative to target. */
export function cpaColorClass(cpa: number | null, target: number): string {
  if (cpa === null) return "text-v-kill"; // ∞ — zero conversions
  if (cpa <= target) return "text-v-continue";
  if (cpa <= 1.5 * target) return "text-v-watch";
  return "text-v-kill";
}

/**
 * Link CTR tier colors.
 *
 * When a `median` is provided the threshold between below-median and
 * above-median colors keys off whether `ctr` is above or below it; the
 * absolute SOP bands are used as the fallback when median is null.
 *
 * Bands (percent):
 *   <0.5           dead red
 *   0.5 to <1      weak amber
 *   1 to <2        medium (watch)
 *   2 to 3         good green
 *   >3             excellent green
 */
export function ctrColorClass(ctr: number, median: number | null = null): string {
  if (median !== null) {
    if (ctr < median) return "text-v-kill";
    if (ctr < median * 1.2) return "text-v-watch";
    return "text-v-continue";
  }
  if (ctr < 0.5) return "text-v-kill";
  if (ctr < 1) return "text-orange-400";
  if (ctr < 2) return "text-v-watch";
  if (ctr <= 3) return "text-v-continue";
  return "text-emerald-300";
}

export function timeAgoAr(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}
