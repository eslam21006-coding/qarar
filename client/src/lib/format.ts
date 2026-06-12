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
 * Link CTR tier colors (rulebook tiers):
 * <0.5 dead · 0.5–0.9 weak · 0.9–1.5 acceptable · 1.5–2.5 good · >2.5 excellent
 */
export function ctrColorClass(ctr: number): string {
  if (ctr < 0.5) return "text-v-kill";
  if (ctr < 0.9) return "text-orange-400";
  if (ctr < 1.5) return "text-v-watch";
  if (ctr <= 2.5) return "text-v-continue";
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
