/**
 * Qarar (قرار) — shared types + rule catalog.
 * The rulebook (محرك القرار الإعلاني v2.1) is the single source of truth.
 * Everything here is deterministic — no AI inference anywhere.
 */

// ---------- Verdicts ----------

export type Verdict = "kill" | "watch" | "continue" | "rescue" | "too_early";

export const VERDICT_META: Record<
  Verdict,
  { emoji: string; labelAr: string; color: string }
> = {
  kill: { emoji: "🔴", labelAr: "أوقف", color: "red" },
  watch: { emoji: "🟡", labelAr: "راقب", color: "amber" },
  continue: { emoji: "🟢", labelAr: "واصل", color: "emerald" },
  rescue: { emoji: "🛟", labelAr: "أنقذه", color: "blue" },
  too_early: { emoji: "⏳", labelAr: "مبكّر", color: "gray" },
};

// ---------- Rule catalog (codes verbatim from the rulebook) ----------

export type RuleCode =
  | "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7"
  | "CB1" | "CB2"
  | "F1" | "F2"
  | "W1" | "W2" | "W3" | "W4" | "W5" | "W6"
  | "S1" | "S2" | "S3" | "S4"
  | "GATE";

export const RULES: Record<RuleCode, { titleAr: string; defAr: string }> = {
  K1: {
    titleAr: "أوقِفه — لا يوجد أي نتائج",
    defAr: "صرف ضعف التكلفة المستهدفة للعميل ولم يجلب أي نتيجة — هذا الإعلان لا يبيع أصلًا.",
  },
  K2: {
    titleAr: "أوقِفه — خسارة مستمرة",
    defAr: "منذ يومين أو ثلاثة وهو يجلب العميل بتكلفة أعلى بكثير من هدفك — هذه خسارة مستمرة وليست يومًا سيئًا عابرًا.",
  },
  K3: {
    titleAr: "أوقِفه — الناس لا تضغط",
    defAr: "عدد كبير من الناس شاهد الإعلان وأقل من نصف في المئة ضغط عليه — بداية الإعلان لا توقف أحدًا. غيّر التصميم أو أوقفه.",
  },
  K4: {
    titleAr: "أوقِفه — نجاح لم يدُم",
    defAr: "أول يوم كان ممتازًا ثم هبط الأداء للنصف أو أكثر خلال 3 أيام — لا تطارد نجاح اليوم الأول، فقد انتهى.",
  },
  K5: {
    titleAr: "إعلان لا يأخذ فرصته",
    defAr: "فيسبوك يعطي هذا الإعلان أقل من 10% من المصروف منذ 3 أيام — القرار يعتمد على أداء إخوته في نفس المجموعة: اتركه، أو أوقفه، أو انقله لمجموعة مستقلة.",
  },
  K6: {
    titleAr: "أوقِفه — سعر العميل ارتفع جدًا",
    defAr: "تكلفة العميل المحتمل أصبحت ضعف متوسطك المعتاد في آخر 30 يومًا — الحملة تدفع أكثر مما يجب.",
  },
  K7: {
    titleAr: "أوقِفه — الحساب يخسر",
    defAr: "تكلفة العميل المحتمل وصلت لـ 70% من قيمته المتوقعة — حتى لو باع، أنت تخسر. راجع العرض كاملًا.",
  },
  CB1: {
    titleAr: "تنبيه اليوم — راجعه غدًا",
    defAr: "صرف اليوم مبلغًا كبيرًا بلا أي نتيجة — راجعه صباح الغد قبل أن تتركه يصرف من جديد.",
  },
  CB2: {
    titleAr: "خطر اليوم — أوقِفه فورًا",
    defAr: "صرف اليوم أكثر من ضعفين ونصف هدفك بلا أي نتيجة — أوقِفه الآن وقيّم الوضع بنفسك.",
  },
  F1: {
    titleAr: "الإعلان بدأ يتعب",
    defAr: "سعر الظهور ثابت لكن ضغط الناس على الإعلان نزل ربع أو ثلث عمّا كان — الجمهور ملّ التصميم، جهّز تصميمًا جديدًا.",
  },
  F2: {
    titleAr: "فيسبوك رفع سعره",
    defAr: "سعر ظهور هذا الإعلان يرتفع عن باقي حسابك — فيسبوك لم يعد يحب هذا التصميم.",
  },
  W1: {
    titleAr: "راقبه — أغلى من الهدف قليلًا",
    defAr: "تكلفة العميل أعلى من هدفك بقليل (ليست كارثة) — انتظر يومين أو ثلاثة بدون أي تعديل.",
  },
  W2: {
    titleAr: "لا تلمسه — يوم سيئ واحد",
    defAr: "يوم سيئ واحد بعد أيام جيدة — طبيعي جدًا. أي تعديل الآن سيخرب تعلّم فيسبوك ويزيد التكلفة.",
  },
  W3: {
    titleAr: "الإعلان ممتاز — المشكلة في صفحتك",
    defAr: "الناس تضغط على الإعلان أكثر من المعتاد لكن صفحة البيع لا تقنعهم — أصلح الصفحة أو العرض أولًا ولا تغيّر شيئًا في الإعلانات.",
  },
  W4: {
    titleAr: "افحص سرعة صفحتك",
    defAr: "ناس كثيرون يضغطون على الإعلان لكن ربعهم أو أكثر لا يصل للصفحة — غالبًا الصفحة بطيئة في التحميل.",
  },
  W5: {
    titleAr: "المشكلة بعد البيع الأول",
    defAr: "الإعلانات تجلب عملاء بسعر جيد، لكنهم لا يشترون منتجك الأساسي بعد ذلك — الإعلان بريء، راجع المتابعة والرسائل بعد الشراء.",
  },
  W6: {
    titleAr: "واصل بحذر — الحساب متعادل",
    defAr: "تكلفة العميل أعلى من هدفك، لكن عند حساب كل ما سيشتريه العميل لاحقًا فأنت لا تخسر — يمكنك الاستمرار بحذر.",
  },
  S1: {
    titleAr: "ناجح — جاهز للتوسيع",
    defAr: "ثلاثة أيام متتالية يحقق هدفك أو أفضل، والناس تتفاعل معه أكثر من المعتاد — انسخه لمرحلة أعلى مع الحفاظ على تفاعلاته.",
  },
  S2: {
    titleAr: "زوّد ميزانيته بهدوء",
    defAr: "زد الميزانية 20% فقط كل يومين أو ثلاثة — الزيادة الكبيرة دفعة واحدة تخرب أداءه.",
  },
  S3: {
    titleAr: "انسخه لجمهور جديد",
    defAr: "بدل زيادة الميزانية كثيرًا، انسخ الإعلان الناجح نفسه لجمهور آخر مع الحفاظ على تفاعلاته.",
  },
  S4: {
    titleAr: "رابح ثابت — لا تلمسه",
    defAr: "يحقق هدفك باستمرار — اتركه كما هو، وأضف بجانبه نسخًا معدّلة خفيفة لتطيل عمره.",
  },
  GATE: {
    titleAr: "البيانات ما زالت قليلة",
    defAr: "لا نحكم على إعلان قبل أن تكتمل بياناته — أكثر القرارات الخاسرة سببها الحكم المبكر.",
  },
};

// ---------- Metric shapes ----------

export interface WindowMetrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  linkClicks: number;
  /** % values, e.g. 1.7 means 1.7% */
  ctrAll: number;
  ctrLink: number;
  cpm: number;
  cpc: number;
  conversions: number;
  /** value of conversions reported by Meta (used for ROAS = value / spend) */
  conversionValue: number;
  /** landing page views (from actions) */
  lpViews: number;
  /** null when conversions = 0 */
  cpa: number | null;
  /** 3-second video views (hook) — optional, video ads only */
  videoViews3s?: number;
  /** ThruPlays (hold) — optional, video ads only */
  thruplays?: number;
}

export interface DailyMetrics extends WindowMetrics {
  date: string; // YYYY-MM-DD
}

export type ObjectLevel = "campaign" | "adset" | "ad";

export interface NormalizedObject {
  id: string;
  name: string;
  status: string; // ACTIVE | PAUSED | ...
  level: ObjectLevel;
  parentId: string | null;
  campaignId: string | null;
  dailyBudget: number | null; // account currency units
  bidStrategy?: string | null;
  objective?: string | null;
  createdTime?: string | null;
  ageDays: number;
  w3d: WindowMetrics;
  today: WindowMetrics;
  daily7: DailyMetrics[];
  /** ads only — % of ad-set 3d spend */
  spendSharePct: number | null;
  learningPhase?: boolean;
  /** ads only — creative thumbnail */
  thumbnailUrl?: string | null;
  /** delivery status from Meta (effective_status) */
  effectiveStatus?: string | null;
  /** last 30 days, daily — powers the date-range selector (display only) */
  daily30?: DailyMetrics[];
}

export interface Baselines {
  /** 90-day median Link CTR across ads/days (%) */
  ctrLinkMedian90: number | null;
  /** 14-day average CPM */
  cpmAvg14: number | null;
  /** 30-day median CPA/CPL */
  cpaMedian30: number | null;
  /** current account-level CPM (3d) for market-level comparison */
  cpmNow: number | null;
}

export interface AccountSnapshotPayload {
  accountId: string;
  currency: string;
  fetchedAt: string; // ISO
  objects: NormalizedObject[];
  baselines: Baselines;
  /** true when any compared window straddles 2026-03-01 (attribution change) */
  attributionStraddle: boolean;
  isDemo?: boolean;
}

// ---------- Funnel settings & derived targets ----------

export interface FunnelInputs {
  archetype: "paid_lto" | "free_lead" | "direct_call";
  liveComponent: boolean;
  offerDescription?: string | null;
  ticketPrice?: number | null;
  aov: number;
  htoPrice: number;
  htoConversionRate: number; // %
  frontEndRoas: number;
  dailyBudget?: number | null;
  marketCplBenchmark?: number | null;
  /** W5 — user-reported funnel-level signal: LTO كويس لكن HTO ضعيف */
  htoUnderperforming?: boolean;
  arena: "interests" | "broad";
  bestInterest?: string | null;
  geoTiers?: string[] | null;
  /**
   * Batch 2 / ISSUE-009 — currency the user-entered prices are denominated in.
   * Carrier only: read by runEngine() to thread into deriveTargets().
   * Existing fixtures (baseFunnel, DEMO_FUNNEL) omit it ⇒ undefined ⇒ no-op.
   * Stored value is `string | null`; both null and undefined are safe no-ops
   * inside convertCurrency.
   */
  inputCurrency?: string | null;
}

export interface DerivedTargets {
  rawTargetCPA: number | null;
  fullBuyerValue: number;
  maxCPA: number;
  effectiveCPA: number;
  capped: boolean;
  /** lead value & economic ceiling (free_lead) */
  leadValue: number | null;
  cplCeiling: number | null;
  /** the unit target the engine judges with (CPA or CPL) */
  unitTarget: number;
  unitTargetSource: "effective_cpa" | "cpl_baseline" | "cpl_benchmark";
}

// ---------- Engine output ----------

export interface Finding {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  text_ar: string;
  primary: boolean;
  ctaUrl?: string;
}

export interface EngineRow {
  id: string;
  name: string;
  status: string;
  level: ObjectLevel;
  parentId: string | null;
  campaignId: string | null;
  daily_budget: number | null;
  objective: string | null;
  spend_3d: number;
  spend_today: number;
  impressions_3d: number;
  cpa_3d: number | null;
  ctr_link: number;
  ctr_all: number;
  conversions_3d: number;
  frequency_3d: number;
  spend_share_pct: number | null;
  /** 3-day ROAS = conversionValue / spend. null when either is 0. */
  roas_3d: number | null;
  age_days: number;
  verdict: Verdict;
  rule: RuleCode;
  reason_ar: string;
  action_ar: string;
  findings: Finding[];
  promotion_eligible: boolean;
  promotion_note: string | null;
  learning_phase: boolean;
}

export interface TopAction {
  key: string;
  rank: number;
  objectId: string;
  objectName: string;
  level: ObjectLevel;
  parentId: string | null;
  campaignId: string | null;
  rule: RuleCode;
  verdict: Verdict;
  action_ar: string;
  impact_ar: string;
  impactValue: number;
}

export interface Cadence {
  state: "stall" | "reminder" | "ok" | "unknown";
  daysSinceLast: number | null;
  message_ar: string;
}

export interface AccountSummary {
  total_spend_3d: number;
  total_spend_today: number;
  bleed_daily: number;
  counts: Record<Verdict, number>;
  baselines: Baselines;
  top_3_actions: TopAction[];
  attributionStraddle: boolean;
  fetchedAt: string;
  currency: string;
  account_funnel_cta: { reason_ar: string; ctaUrl: string } | null;
  account_alert: {
    cpmNow: number;
    cpmAvg14: number;
    deltaPct: number;
  } | null;
  /**
   * US9 — creative-factory cadence. Null when state is "ok" (≤7 days since
   * the most recent ad was created). Otherwise carries the state, days since
   * last new ad, and a simple-Arabic message for the account-level signal.
   */
  cadence: Cadence | null;
}

export interface EngineResult {
  rows: EngineRow[];
  summary: AccountSummary;
  targets: DerivedTargets;
  /** Display symbol for the account's currency (e.g. "AED" → "د.إ"). */
  currencySymbol: string;
}

// ---------- Helpers shared by client & server ----------

export function median(values: number[]): number | null {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1] + v[mid]) / 2 : v[mid];
}

/** Attribution model change date (March 2026) */
export const ATTRIBUTION_CHANGE_DATE = "2026-03-01";

// ---------- Currency conversion (Batch 2 / ISSUE-009) ----------
// Frozen, shared table. No external/network rate source (constitution).
// Pivots through USD: amount / rate[from] * rate[to].

/**
 * The canonical list of currency codes the product supports. Single source
 * of truth shared by the conversion table, the Settings UI selector, and the
 * server-side zod validator. Adding a new code means appending to this
 * tuple AND adding a matching rate AND adding a matching symbol in
 * `client/src/lib/format.ts#currencySymbol()`.
 */
export const SUPPORTED_CURRENCIES = [
  "USD", "AED", "SAR", "EGP", "EUR", "GBP", "KWD", "QAR", "BHD", "OMR",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const EXCHANGE_RATES_TO_USD: Readonly<Record<string, number>> = Object.freeze(
  SUPPORTED_CURRENCIES.reduce<Record<string, number>>((acc, code) => {
    acc[code] = (
      {
        USD: 1.0,
        AED: 3.67,
        SAR: 3.75,
        EGP: 50.0,
        EUR: 0.92,
        GBP: 0.79,
        KWD: 0.31,
        QAR: 3.64,
        BHD: 0.376,
        OMR: 0.385,
      } as const
    )[code];
    return acc;
  }, {})
);

/**
 * Pure, deterministic currency conversion via USD as the pivot.
 *
 * `from` / `to` accept `string | null | undefined` so callers can pass the
 * stored `funnel.inputCurrency` (type `string | null`) directly without
 * coalescing. A `null` / `undefined` / unknown code ⇒ safe no-op
 * (amount returned unchanged).
 *
 * Behavior table (first match wins):
 *   1. amount is 0, null, undefined, NaN, or non-finite     → 0
 *   2. from === to                                          → amount
 *   3. from or to is null/undefined/unknown                  → amount
 *   4. otherwise                                            → amount / rate[from] * rate[to]
 */
export function convertCurrency(
  amount: number,
  from: string | null | undefined,
  to: string | null | undefined
): number {
  if (amount === 0 || amount === null || amount === undefined) return 0;
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  if (!from || !to) return amount;
  const fromRate = EXCHANGE_RATES_TO_USD[from];
  const toRate = EXCHANGE_RATES_TO_USD[to];
  if (fromRate === undefined || toRate === undefined) return amount;
  return (amount / fromRate) * toRate;
}

/**
 * Derived targets (2.x) — pure & shared so the client previews live while typing.
 * rawTargetCPA = AOV ÷ frontEndROAS
 * fullBuyerValue = AOV + htoPrice × (htoConversionRate/100)
 * maxCPA = fullBuyerValue ÷ 2 (Full-Funnel ROAS ≥ 2.0 floor)
 * effectiveCPA = min(rawTargetCPA, maxCPA)
 *
 * Batch 2 / ISSUE-009 — when `inputCurrency` and `accountCurrency` are
 * supplied and differ, the user-entered monetary inputs (aov, htoPrice,
 * ticketPrice, marketCplBenchmark) are converted into account currency
 * BEFORE any target math. Baselines (baselines.cpaMedian30) and
 * f.dailyBudget are NEVER converted — both are already in account currency.
 *
 * Backward-compat (FR-007): when both params are omitted, undefined, or
 * equal, convertCurrency is a no-op and the output is bit-for-bit identical
 * to the pre-feature output.
 */
export function deriveTargets(
  f: FunnelInputs,
  baselines?: Baselines | null,
  inputCurrency?: string | null,
  accountCurrency?: string | null
): DerivedTargets {
  // Currency conversion — happens before any math, in account currency.
  // convertCurrency is a safe no-op for null/undefined/equal/unknown codes.
  const aov = convertCurrency(f.aov, inputCurrency, accountCurrency);
  const htoPrice = convertCurrency(f.htoPrice, inputCurrency, accountCurrency);
  const ticketPrice =
    f.ticketPrice != null
      ? convertCurrency(f.ticketPrice, inputCurrency, accountCurrency)
      : null;
  const marketCplBenchmark =
    f.marketCplBenchmark != null && f.marketCplBenchmark > 0
      ? convertCurrency(f.marketCplBenchmark, inputCurrency, accountCurrency)
      : f.marketCplBenchmark ?? null;

  const roas = f.frontEndRoas > 0 ? f.frontEndRoas : 1;
  const rawTargetCPA = aov > 0 ? aov / roas : null;
  const fullBuyerValue = aov + htoPrice * (f.htoConversionRate / 100);
  const maxCPA = fullBuyerValue / 2;
  const effectiveCPA =
    rawTargetCPA !== null ? Math.min(rawTargetCPA, maxCPA) : maxCPA;
  const capped = rawTargetCPA !== null && rawTargetCPA > maxCPA;

  // Free-lead funnel: two anchors (2.3)
  let leadValue: number | null = null;
  let cplCeiling: number | null = null;
  let unitTarget = effectiveCPA;
  let unitTargetSource: DerivedTargets["unitTargetSource"] = "effective_cpa";

  if (f.archetype === "free_lead") {
    // leadValue & cplCeiling derive from the (already-converted) htoPrice.
    leadValue = htoPrice * (f.htoConversionRate / 100);
    cplCeiling = 0.7 * leadValue;
    // baselines.cpaMedian30 is already in account currency — DO NOT convert
    // (no double-conversion). Same for the benchmark branch.
    if (baselines?.cpaMedian30 && baselines.cpaMedian30 > 0) {
      unitTarget = baselines.cpaMedian30;
      unitTargetSource = "cpl_baseline";
    } else if (marketCplBenchmark != null && marketCplBenchmark > 0) {
      unitTarget = marketCplBenchmark;
      unitTargetSource = "cpl_benchmark";
    } else {
      unitTarget = effectiveCPA;
    }
  }

  return {
    rawTargetCPA,
    fullBuyerValue,
    maxCPA,
    effectiveCPA,
    capped,
    leadValue,
    cplCeiling,
    unitTarget,
    unitTargetSource,
  };
}
