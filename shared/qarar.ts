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
  kill: { emoji: "🔴", labelAr: "اقفل", color: "red" },
  watch: { emoji: "🟡", labelAr: "راقب", color: "amber" },
  continue: { emoji: "🟢", labelAr: "كمّل", color: "emerald" },
  rescue: { emoji: "🛟", labelAr: "أنقذه", color: "blue" },
  too_early: { emoji: "⏳", labelAr: "بدري", color: "gray" },
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
    titleAr: "قفل — صفر تحويلات",
    defAr: "صرف ≥ 2 × Target CPA بصفر تحويلات — الوحدة لا تحوّل أصلًا.",
  },
  K2: {
    titleAr: "قفل — نزيف مستمر",
    defAr: "صرف ≥ 3 × Target والـ CPA الفعلي > 1.5 × Target عبر آخر 2–3 أيام rolling — نزيف مستمر لا تذبذب.",
  },
  K3: {
    titleAr: "قفل — الهوك ميت",
    defAr: "Link CTR < 0.5% بعد 1,500–3,000 impressions — الهوك ميت، اقفل أو استبدل الكريتف.",
  },
  K4: {
    titleAr: "قفل — Flash Creative",
    defAr: "قمة يوم أول قوية ثم تراجع ≥ 50% خلال 72 ساعة — النية المركزة استُنفدت، لا تطارد يوم الإطلاق.",
  },
  K5: {
    titleAr: "مصفوفة الإعلان المحروم",
    defAr: "إعلان يأخذ < 10% من صرف الـ ad set لمدة 3 أيام وعمره > 48 ساعة — القرار حسب حالة الـ ad set وكفاءة الإعلان (اتركه / اطفئه / أنقذه).",
  },
  K6: {
    titleAr: "قفل — CPL فوق خط الأساس",
    defAr: "CPL > 2 × خط الأساس المتحرك (الميديان 30 يومًا) مع استيفاء البوابات — فانل مجاني.",
  },
  K7: {
    titleAr: "قفل — السقف الاقتصادي",
    defAr: "CPL يلامس السقف الاقتصادي (70% من قيمة الليد) — الفانل يخسر بنيويًا، قفل + مراجعة فانل.",
  },
  CB1: {
    titleAr: "قاطع الدائرة — مراجعة",
    defAr: "صرف اليوم ≥ 1.5 × Target CPA بصفر تحويلات — مراجعة إجبارية صباح اليوم التالي قبل تجديد الصرف.",
  },
  CB2: {
    titleAr: "قاطع الدائرة — إيقاف فوري",
    defAr: "صرف اليوم ≥ 2.5 × Target CPA بصفر تحويلات — إيقاف فوري ويُعاد التقييم يدويًا.",
  },
  F1: {
    titleAr: "إنهاك إبداعي",
    defAr: "CPM ثابت + Link CTR نزل ≥ 25–30% من قمة أول 3 أيام — أوثق إشارة إنهاك مبكرة: جدّد الكريتف، الجمهور سليم.",
  },
  F2: {
    titleAr: "عقوبة حداثة",
    defAr: "CPM يتصاعد على هذا الإعلان تحديدًا مقابل متوسط الحساب — الخوارزمية تعاقب الكريتف الباهت.",
  },
  W1: {
    titleAr: "مراقبة — تذبذب",
    defAr: "CPA بين 1×–1.5× الـ Target — راقب 48–72 ساعة بلا أي تعديل.",
  },
  W2: {
    titleAr: "انتظر — يوم سيئ منفرد",
    defAr: "يوم سيئ منفرد بعد 2–3 أيام جيدة — لا تلمس؛ التعديل يكسر الـ learning.",
  },
  W3: {
    titleAr: "الإعلان بريء — المشكلة في الصفحة",
    defAr: "Link CTR فوق ميديان الحساب لكن تحويل الصفحة ضعيف — جمّد القرارات الإعلانية وأصلح الصفحة/العرض.",
  },
  W4: {
    titleAr: "فحص الصفحة — LP Views منخفضة",
    defAr: "نقرات جيدة لكن LP Views < 75% من النقرات — افحص سرعة الصفحة أولًا، ثم الـ congruency.",
  },
  W5: {
    titleAr: "المشكلة بعد التحويل",
    defAr: "ليدات/مبيعات LTO جيدة لكن لا حضور أو مبيعات HTO — المشكلة في الـ nurture/الإيميلات/الـ show-up، الإعلان بريء.",
  },
  W6: {
    titleAr: "كمّل بحذر — الفانل متعادل",
    defAr: "CPA فوق الهدف لكن ROAS الفانل الكلي ≥ التعادل بقيمة المشتري الكاملة — الحكم النهائي للفانل.",
  },
  S1: {
    titleAr: "مؤهل للترقية",
    defAr: "CPA ≤ Target عبر 3 أيام rolling متصلة + الكريتف غلب ميديان CTR للحساب — انسخه بالـ Post ID للمرحلة التالية.",
  },
  S2: {
    titleAr: "توسيع رأسي",
    defAr: "+20% فقط على الميزانية كل 48–72 ساعة — أكثر من ذلك يعيد الـ learning.",
  },
  S3: {
    titleAr: "توسيع أفقي",
    defAr: "نسخ الكومبو الرابح بالـ Post ID لـ ad set/جمهور إضافي بدل القفزات الرأسية.",
  },
  S4: {
    titleAr: "رابح مستقر — لا تلمسه",
    defAr: "الرابح في التوسيع يحقق باستمرار — لا تلمسه، أضف variations خفيفة بجانبه لتمديد عمره.",
  },
  GATE: {
    titleAr: "بوابة بيانات",
    defAr: "لا حُكم قبل اكتمال البيانات — أغلب القرارات الخاسرة سببها الحكم المبكر على بيانات ناقصة.",
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
  conversionValue: number;
  /** landing page views (from actions) */
  lpViews: number;
  /** null when conversions = 0 */
  cpa: number | null;
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
  createdTime?: string | null;
  ageDays: number;
  w3d: WindowMetrics;
  today: WindowMetrics;
  daily7: DailyMetrics[];
  /** ads only — % of ad-set 3d spend */
  spendSharePct: number | null;
  learningPhase?: boolean;
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

export interface EngineRow {
  id: string;
  name: string;
  status: string;
  level: ObjectLevel;
  parentId: string | null;
  campaignId: string | null;
  daily_budget: number | null;
  spend_3d: number;
  spend_today: number;
  impressions_3d: number;
  cpa_3d: number | null;
  ctr_link: number;
  ctr_all: number;
  conversions_3d: number;
  frequency_3d: number;
  spend_share_pct: number | null;
  age_days: number;
  verdict: Verdict;
  rule: RuleCode;
  reason_ar: string;
  action_ar: string;
  diagnosis: string | null;
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
  rule: RuleCode;
  verdict: Verdict;
  action_ar: string;
  impact_ar: string;
  impactValue: number;
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
}

export interface EngineResult {
  rows: EngineRow[];
  summary: AccountSummary;
  targets: DerivedTargets;
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

/**
 * Derived targets (2.x) — pure & shared so the client previews live while typing.
 * rawTargetCPA = AOV ÷ frontEndROAS
 * fullBuyerValue = AOV + htoPrice × (htoConversionRate/100)
 * maxCPA = fullBuyerValue ÷ 2 (Full-Funnel ROAS ≥ 2.0 floor)
 * effectiveCPA = min(rawTargetCPA, maxCPA)
 */
export function deriveTargets(
  f: FunnelInputs,
  baselines?: Baselines | null
): DerivedTargets {
  const roas = f.frontEndRoas > 0 ? f.frontEndRoas : 1;
  const rawTargetCPA = f.aov > 0 ? f.aov / roas : null;
  const fullBuyerValue = f.aov + f.htoPrice * (f.htoConversionRate / 100);
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
    leadValue = f.htoPrice * (f.htoConversionRate / 100);
    cplCeiling = 0.7 * leadValue;
    if (baselines?.cpaMedian30 && baselines.cpaMedian30 > 0) {
      unitTarget = baselines.cpaMedian30;
      unitTargetSource = "cpl_baseline";
    } else if (f.marketCplBenchmark && f.marketCplBenchmark > 0) {
      unitTarget = f.marketCplBenchmark;
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
