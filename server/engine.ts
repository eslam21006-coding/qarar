/**
 * engine.ts — محرك القرار الإعلاني
 * Pure, deterministic implementation of the rulebook
 * (محرك-القرار-الإعلاني-v2.1.md). No AI/LLM — fixed math only.
 *
 * Evaluation order per object (STOP at first firing verdict):
 *   1. K3 dead-hook kill — allowed before full data gates per SOP
 *      §4: "القتل الواضح بالـ CTR يُسمح من 1,500 impressions"
 *   2. Starved-ad matrix (K5) — checked before CPA gates because
 *      a starved ad has no spend to judge by CPA
 *   3. Data gates → ⏳ (age, impressions, spend thresholds)
 *   4. Circuit breaker CB1/CB2 (ad-set level — bypasses all gates
 *      per SOP §5.3: "يتجاوز كل البوابات")
 *   5. Kill rules K1–K7
 *   6. 72-hour decay map (K4)
 *   7. Fatigue signals (F1/F2)
 *   8. Watch W1–W6
 *   9. Continue/Scale S1–S4
 */
import {
  AccountSnapshotPayload,
  AccountSummary,
  Baselines,
  DIAGNOSIS_GATES,
  DiagnosisOutcome,
  DerivedTargets,
  EngineResult,
  EngineRow,
  Finding,
  FunnelInputs,
  JudgeableTargets,
  NormalizedObject,
  RULE_FAULT,
  RuleCode,
  RuleFaultClass,
  RungId,
  RungState,
  TopAction,
  Verdict,
  convertCurrency,
  isNonSalesExempt,
  median,
  deriveTargets,
  DISCOVERY_CALL_URL,
} from "../shared/qarar";

// deriveTargets lives in shared/qarar.ts (used by client live-preview too);
// re-exported here so server modules keep importing from the engine.
export { deriveTargets };

// ============================================================
// Formatting helpers (Arabic copy)
// ============================================================

const nf = (n: number, d = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });

// Hotfix T2: every money() call in the engine uses the account's currency
// symbol (e.g. "د.إ" for AED, "$" for USD). _currency is reset at the top
// of runEngine() so all evaluations within a single run share one symbol.
let _currency = "$";
const money = (n: number) => `${_currency}${nf(n, n < 10 ? 2 : 0)}`;

// Symbol map — kept in sync with client/src/lib/format.ts#currencySymbol.
// Server code doesn't import the client helper to avoid a cycle.
const CURRENCY_SYMBOLS: Record<string, string> = {
  AED: "د.إ",
  SAR: "ر.س",
  EGP: "ج.م",
  USD: "$",
  GBP: "£",
  EUR: "€",
  KWD: "د.ك",
  QAR: "ر.ق",
  BHD: "د.ب",
  OMR: "ر.ع",
};
function currencySymbolFor(code: string | null | undefined): string {
  if (!code) return "$";
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code;
}

// ============================================================
// Internal evaluation result
// ============================================================

interface Fired {
  verdict: Verdict;
  rule: RuleCode;
  reason: string;
  action: string;
  promotionEligible?: boolean;
  promotionNote?: string | null;
  ctaUrl?: string;
}

/**
 * Spec 014 / data-model §3 — per-object evaluation of rungs 1–5.
 * Internal to the engine; not on the wire (V6: `evaluable.size === 0`
 * triggers `INSUFFICIENT_DATA`).
 */
type RungEvaluation = Record<RungId, RungState>;

/**
 * Spec 014 / data-model §3 — derived sets used by the contract.
 */
function evalSets(ev: RungEvaluation): {
  evaluable: Set<RungId>;
  clean: Set<RungId>;
  broken: Set<RungId>;
} {
  const evaluable = new Set<RungId>();
  const clean = new Set<RungId>();
  const broken = new Set<RungId>();
  for (const id of [1, 2, 3, 4, 5] as RungId[]) {
    if (ev[id] === "clean") {
      evaluable.add(id);
      clean.add(id);
    } else if (ev[id] === "broken") {
      evaluable.add(id);
      broken.add(id);
    }
  }
  return { evaluable, clean, broken };
}

/**
 * Spec 014 / contract §C1 — build the per-rung evaluation record.
 * Reads every threshold from `DIAGNOSIS_GATES` (C1.3, FR-002, FR-014).
 *
 *   Rung 1: gate = `impressions > 500`; baseline required (C1.4).
 *   Rung 2: gate = `impressions >= 1000`; baseline optional (1.0
 *           fallback, §R2.1).
 *   Rung 3: gate shared with rung 2 (V5); broken when rung-2 broke
 *           AND the mismatch shape held.
 *   Rung 4: gate = `linkClicks >= 50` AND `lpViews > 0` (C1.5).
 *           Otherwise `unevaluable`.
 *   Rung 5: gate = `lpViews >= 100`.
 */
function evaluateRungs(
  o: NormalizedObject,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"]
): RungEvaluation {
  const w = o.w3d;
  const ev: RungEvaluation = {
    1: "unevaluable",
    2: "unevaluable",
    3: "unevaluable",
    4: "unevaluable",
    5: "unevaluable",
  };

  // Rung 1 — CPM vs 14-day average. C1.4 / R2.1: gate met but
  // baseline null ⇒ unevaluable (never clean).
  if (
    w.impressions > DIAGNOSIS_GATES.CPM_MIN_IMPRESSIONS &&
    baselines.cpmAvg14 !== null &&
    baselines.cpmAvg14 > 0
  ) {
    ev[1] = w.cpm > DIAGNOSIS_GATES.CPM_RATIO * baselines.cpmAvg14
      ? "broken"
      : "clean";
  }

  // Rung 2 — Link CTR vs the 90-day median (with the 1.0 fallback).
  // R2.1: rung 2 has the literal fallback, so a null median does NOT
  // make the rung unevaluable.
  const ctrMedian = baselines.ctrLinkMedian90;
  const ctrThreshold = ctrMedian !== null ? ctrMedian : DIAGNOSIS_GATES.CTR_FALLBACK_PCT;
  if (w.impressions >= DIAGNOSIS_GATES.CTR_MIN_IMPRESSIONS) {
    ev[2] = w.ctrLink < ctrThreshold ? "broken" : "clean";
  }

  // Rung 3 — message/CTA mismatch. Only broken when rung 2 is broken
  // AND the ctrAll-vs-ctrLink shape is met. Otherwise: same state as
  // rung 2 when gate is met; otherwise unevaluable (V5 — same gate).
  if (w.impressions >= DIAGNOSIS_GATES.CTR_MIN_IMPRESSIONS) {
    if (
      ev[2] === "broken" &&
      w.ctrAll >= DIAGNOSIS_GATES.MISMATCH_CTR_ALL_MULTIPLE * w.ctrLink &&
      w.ctrAll > DIAGNOSIS_GATES.MISMATCH_CTR_ALL_FLOOR
    ) {
      ev[3] = "broken";
    } else {
      ev[3] = "clean";
    }
  }

  // Rung 4 — landing-page arrival. C1.5 / R2.2: `lpViews === 0` is
  // unevaluable, not clean (the snapshot cannot distinguish "no
  // arrival" from "arrival untracked").
  if (
    w.linkClicks >= DIAGNOSIS_GATES.LP_MIN_LINK_CLICKS &&
    w.lpViews > 0
  ) {
    ev[4] = w.lpViews / w.linkClicks < DIAGNOSIS_GATES.LP_ARRIVAL_FLOOR
      ? "broken"
      : "clean";
  }

  // Rung 5 — page conversion. Floor depends on archetype.
  // `effectiveConversionsLocal` returns `undefined` only when the
  // pre-separation snapshot lacks the lead/purchase split
  // (appointment/webinar pre-feature snapshots) — that case keeps
  // rung 5 unevaluable. A real captured zero (`conversions === 0`)
  // is `0`, NOT `undefined`, and resolves to a `cvr` of 0 → broken.
  if (w.lpViews >= DIAGNOSIS_GATES.CVR_MIN_LP_VIEWS) {
    const floor =
      archetype === "free_lead"
        ? DIAGNOSIS_GATES.CVR_FLOOR_FREE_LEAD_PCT
        : DIAGNOSIS_GATES.CVR_FLOOR_DEFAULT_PCT;
    const conv = effectiveConversions(o, archetype);
    if (conv === undefined) {
      // Pre-separation snapshot — unit unknown. Spec A7 / FR-035.
      ev[5] = "unevaluable";
    } else {
      const cvr = (conv / w.lpViews) * 100;
      ev[5] = cvr < floor ? "broken" : "clean";
    }
  }

  return ev;
}

// ============================================================
// Data gates (الجزء الرابع)
// ============================================================

function ctrGateMet(o: NormalizedObject, target: number): boolean {
  // CTR judgment: ≥2,000–3,000 impressions OR spend ≥ 1×target (whichever first)
  return o.w3d.impressions >= 2000 || o.w3d.spend >= target;
}

function cpaGateMet(o: NormalizedObject, target: number): boolean {
  // CPA judgment: spend ≥ 1×target minimum
  return o.w3d.spend >= target;
}

function killCpaGateMet(o: NormalizedObject, target: number): boolean {
  return o.w3d.spend >= 2 * target;
}

/**
 * Archetype-aware conversion-count selector (T025, FR-031).
 *
 * `paid_lto` and `free_lead` continue to read the legacy `conversions`
 * field — the lead/purchase split is invisible to them (SC-025). The two
 * new archetypes read `leadConversions` because their target is a cost
 * per lead; using the legacy field would compare a cost-per-sale against
 * a cost-per-lead target (~108× apart at the spec's sanity-check rates —
 * research R4, contracts/conversion-measurement.md §4).
 *
 * Return type is `number | undefined`:
 *   - `number`         — captured, the engine can judge on it
 *   - `undefined`      — pre-separation snapshot; FR-035 says do NOT
 *                        coalesce to `0`. The caller MUST treat this as
 *                        "not yet measurable" and skip judgement.
 */
/**
 * Spec 014 / contract C4.4a — the NOUN that matches
 * `effectiveConversions`. For `appointment` / `webinar` the counted
 * event is a captured lead, not a purchase, so copy that says "bought"
 * mislabels the very figure the ladder just computed. Perfect and
 * imperfect forms, to fit both the rung-5 and ladder sentences.
 */
function conversionVerb(
  archetype: FunnelInputs["archetype"],
  tense: "past" | "present"
): string {
  const isLead = archetype === "appointment" || archetype === "webinar";
  if (isLead) return tense === "past" ? "سجّلوا بياناتهم" : "يسجّلون بياناتهم";
  return tense === "past" ? "اشتروا" : "يشترون";
}

function effectiveConversions(
  o: NormalizedObject,
  archetype: FunnelInputs["archetype"]
): number | undefined {
  if (archetype === "appointment" || archetype === "webinar") {
    return o.w3d.leadConversions;
  }
  return o.w3d.conversions;
}

/**
 * Archetype-aware cost-per-result (T025, FR-031).
 * Returns `null` when there is no usable count — pre-separation snapshot
 * OR zero results share the "no cpa" rendering, but the engine
 * distinguishes the two at the pre-separation gate (T026).
 */
function effectiveCpa(
  o: NormalizedObject,
  archetype: FunnelInputs["archetype"]
): number | null {
  const conv = effectiveConversions(o, archetype);
  if (conv === undefined || conv === 0) return null;
  return o.w3d.spend / conv;
}

/**
 * Pre-separation-snapshot guard (T026, FR-035).
 * For `appointment` / `webinar`, `leadConversions === undefined` means the
 * snapshot was captured before the lead/purchase split was deployed —
 * the unit is unknown. Returning a `too_early GATE` keeps the object out
 * of the judgement pipeline. `leadConversions === 0` is a real captured
 * zero and falls through to the ordinary zero-result rules (FR-034);
 * `leadConversions > 0` is the normal case.
 */
function preSeparationGate(
  o: NormalizedObject,
  archetype: FunnelInputs["archetype"]
): Fired | null {
  if (archetype !== "appointment" && archetype !== "webinar") return null;
  if (o.w3d.leadConversions !== undefined) return null;
  return {
    verdict: "too_early",
    rule: "GATE",
    reason:
      "عدد العملاء المحتملين في هذه الفترة لم يُحدَّد بعد — البيانات قديمة أو لم تُلتقط بعد",
    action: "حدّث البيانات من ميتا ثم راجع القرار",
  };
}

/** explicit-failure CTR kill allowed from 1,500 impressions when Link CTR < 0.5% */
function explicitCtrKillAllowed(o: NormalizedObject): boolean {
  return o.w3d.impressions >= 1500 && o.w3d.ctrLink < 0.5;
}

function gateVerdict(o: NormalizedObject, target: number): Fired | null {
  // Paused / not active → frozen data, no judgment (US4 / T027).
  // The subtraction (2000 − impressions) would otherwise always read "needs
  // 2,000 more" because paused objects carry zero impressions in the 3-day
  // window. Branch FIRST so the message matches the actual state.
  const effectiveDelivered = o.effectiveStatus ?? o.status;
  if (effectiveDelivered !== "ACTIVE") {
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: "هذا الإعلان موقوف الآن — لا يصرف ولا يجمع بيانات",
      action: "شغّله إن أردت تقييمه، أو احذفه إن لم تعد تحتاجه",
    };
  }
  // Minimum age gate: < 48h → no judgment at all (quick matrix: عمره < 48 ساعة → لا شيء)
  if (o.ageDays < 2 && !explicitCtrKillAllowed(o)) {
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: `عمره ${o.ageDays < 1 ? "أقل من يوم" : "يوم واحد"} — بياناته لم تكتمل بعد`,
      action: "لا تفعل شيئًا — انتظر 48 ساعة على الأقل قبل أي قرار",
    };
  }
  const ctrOk = ctrGateMet(o, target);
  const cpaOk = cpaGateMet(o, target);
  if (!ctrOk && !cpaOk && !explicitCtrKillAllowed(o)) {
    const needImp = Math.max(0, 2000 - o.w3d.impressions);
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: `في آخر 3 أيام: ما زال مبكرًا — يحتاج ${nf(needImp)} مشاهدة إضافية أو صرف ${money(target)} قبل الحكم`,
      action: "اترك البيانات تكتمل — لا قرار الآن",
    };
  }
  return null;
}

// ============================================================
// Circuit breaker (5.3) — today's data, overrides gates
// ============================================================

function circuitBreaker(o: NormalizedObject, target: number): Fired | null {
  if (o.level !== "adset") return null;
  if (o.today.conversions > 0) return null;
  if (o.today.spend >= 2.5 * target) {
    return {
      verdict: "kill",
      rule: "CB2",
      reason: `اليوم: صرف ${money(o.today.spend)} (أكثر من ضعفين ونصف هدفك ${money(target)}) بدون أي نتيجة`,
      action: "أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى",
    };
  }
  if (o.today.spend >= 1.5 * target) {
    return {
      verdict: "watch",
      rule: "CB1",
      reason: `اليوم: صرف ${money(o.today.spend)} (أكثر من هدفك بكثير) بدون أي نتيجة`,
      action: "راجعه غدًا صباحًا قبل أن يصرف من جديد",
    };
  }
  return null;
}

// ============================================================
// Kill rules K1–K7 (5.1)
// ============================================================

/**
 * W3 "الإعلان بريء" pre-check: Link CTR above account median + weak page CVR
 * → the problem is the page/offer, NOT the ad. Per the rulebook this FREEZES
 * ad-side decisions ("جمّد القرارات الإعلانية — أي تعديل إعلاني هنا حرق فلوس"),
 * so CPA-bleed kills (K2/K6) are suppressed and W3 fires instead.
 * K1 (zero conversions at 2× spend) still kills per the quick-decision matrix.
 */
function adInnocent(
  o: NormalizedObject,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): boolean {
  const { ctrLink, lpViews } = o.w3d;
  // T025 — cvr denominator follows the archetype-aware selector. The new
  // archetypes compute cvr from leads (FR-031, SC-024). Pre-separation
  // snapshots are caught at the gate (T026) and never reach this branch
  // for the new archetypes; for `paid_lto` / `free_lead` the legacy
  // `conversions` is always present (SC-025).
  const conversions = effectiveConversions(o, archetype) ?? 0;
  const ctrMedian = baselines.ctrLinkMedian90;
  if (ctrMedian === null || ctrLink <= ctrMedian || lpViews < 100) return false;
  const cvr = (conversions / lpViews) * 100;
  // FR-026a — the 15% lead-generation floor belongs to Phase 7 (T064) and
  // is INTENTIONALLY NOT applied to appointment / webinar here. Phase 2
  // ships the plumbing (archetype-aware selector) but keeps the legacy
  // 2% product-purchase floor for every non-`free_lead` archetype so the
  // Phase 2 / Phase 3 checkpoint does not silently widen the threshold.
  // Phase 7 widens this ternary to include appointment/webinar (FR-026a).
  return archetype === "free_lead" ? cvr < 15 : cvr < 2;
}

function killRulesAdset(
  o: NormalizedObject,
  t: JudgeableTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): Fired | null {
  const target = t.unitTarget;
  const { spend } = o.w3d;
  // T025 — cpa / conversions follow the archetype-aware selector. K1's
  // zero-result check is in `effectiveConversions` units (leads for the
  // new archetypes); K2/K6/K7 work in cpa-leads for the new archetypes.
  const conversions = effectiveConversions(o, archetype) ?? 0;
  const cpa = effectiveCpa(o, archetype);
  const innocent = adInnocent(o, archetype, baselines);

  // K1: spend ≥ 2×target + zero conversions
  if (spend >= 2 * target && conversions === 0) {
    return {
      verdict: "kill",
      rule: "K1",
      reason: `في آخر 3 أيام: صرف ${money(spend)} (ضعف هدفك ${money(target)}) بدون أي نتيجة — لا يبيع أصلًا`,
      action: "أوقِف هذه المجموعة",
    };
  }

  // K2: spend ≥ 3×target AND actual CPA > 1.5×target over 2–3 day rolling
  // (suppressed when W3 applies — the ad is innocent, the page is broken)
  if (!innocent && spend >= 3 * target && cpa !== null && cpa > 1.5 * target) {
    return {
      verdict: "kill",
      rule: "K2",
      reason: `في آخر 3 أيام: صرف ${money(spend)} وتكلفة العميل ${money(cpa)} أعلى بكثير من هدفك (${money(target)}) — خسارة مستمرة وليست يومًا سيئًا`,
      action: "أوقِف هذه المجموعة",
    };
  }

  // K6/K7 — free-lead funnels (CPL anchors)
  if (archetype === "free_lead" && cpa !== null && !innocent) {
    const baseline =
      t.unitTargetSource === "cpl_baseline" || t.unitTargetSource === "cpl_benchmark"
        ? target
        : baselines.cpaMedian30 ?? target;
    // K7: CPL touches the economic ceiling (anchor 1) — structural loss
    if (t.cplCeiling !== null && cpa >= t.cplCeiling && killCpaGateMet(o, target)) {
      return {
        verdict: "kill",
        rule: "K7",
        reason: `في آخر 3 أيام: تكلفة العميل المحتمل ${money(cpa)} وصلت للحد الذي تخسر بعده (${money(t.cplCeiling)})`,
        action: "أوقِفها وراجع عرضك وأسعارك — المشكلة أكبر من الإعلانات",
      };
    }
    // K6: CPL > 2× rolling baseline with gates met
    if (cpa > 2 * baseline && killCpaGateMet(o, target)) {
      return {
        verdict: "kill",
        rule: "K6",
        reason: `في آخر 3 أيام: تكلفة العميل المحتمل ${money(cpa)} أصبحت ضعف متوسطك المعتاد (${money(baseline)})`,
        action: "أوقِف هذه المجموعة",
      };
    }
  }

  return null;
}

// K3: dead hook (ad level)
function killK3(o: NormalizedObject): Fired | null {
  if (o.w3d.impressions >= 1500 && o.w3d.ctrLink < 0.5) {
    return {
      verdict: "kill",
      rule: "K3",
      reason: `في آخر 3 أيام: من كل 1000 شاهدوا الإعلان، أقل من 5 ضغطوا (${o.w3d.ctrLink.toFixed(2)}%) بعد ${nf(o.w3d.impressions)} مشاهدة — الهوك لا يوقف أحدًا`,
      action: "الجملة الافتتاحية لم توقف أحدًا — المشكلة في المفهوم لا في الشكل. غيّر المفهوم كاملًا، لا تكتفِ بتغيير اللون أو الحجم. إذا احتجت إلى بناء مفهوم جديد من الصفر، احجز مكالمة: https://eslamsalah.com/team-discovery-call",
    };
  }
  return null;
}

// ============================================================
// Starved-ad matrix — K5 (5.0)
// ============================================================

// Hotfix T7: same step-6 preconditions as diagnose(). The K5 kill branch
// detects this and swaps in a coherent "the ad is fine, the funnel/page
// is the real problem" message instead of the contradictory "turn it off".
function isStep6Candidate(
  ad: NormalizedObject,
  archetype: FunnelInputs["archetype"]
): boolean {
  const w = ad.w3d;
  if (w.lpViews < 100) return false;
  if (w.linkClicks <= 0) return false;
  if (w.lpViews / w.linkClicks < 0.75) return false;
  // T025 / FR-031 — cvr denominator is the archetype-aware count.
  // FR-026a — 15% lead-generation floor is Phase 7 (T064); Phase 2 keeps
  // the legacy 2% product-purchase floor for every non-`free_lead`
  // archetype so the Phase 2/3 checkpoint does not silently widen it.
  const conversions = effectiveConversions(ad, archetype) ?? 0;
  const cvr = (conversions / w.lpViews) * 100;
  return archetype === "free_lead" ? cvr < 15 : cvr < 2;
}

function starvedAdMatrix(
  ad: NormalizedObject,
  parent: NormalizedObject | undefined,
  t: JudgeableTargets,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"]
): Fired | null {
  // Trigger: < 10% of ad-set spend for 3 days, age > 48h
  if (ad.spendSharePct === null || ad.spendSharePct >= 10 || ad.ageDays <= 2) return null;

  const ctrMedian = baselines.ctrLinkMedian90 ?? 1.0;
  // T025 — cpa read for the high-efficiency check is archetype-aware
  // (cost-per-lead for the new archetypes, cost-per-purchase otherwise).
  const adCpa = effectiveCpa(ad, archetype);
  const highEfficiency =
    ad.w3d.ctrLink > ctrMedian ||
    (adCpa !== null && adCpa <= t.unitTarget);

  // Any ad-set state + high efficiency on its small spend → rescue 🛟
  if (highEfficiency) {
    return {
      verdict: "rescue",
      rule: "K5",
      reason: `تمنحه ميتا ${ad.spendSharePct.toFixed(1)}% فقط من ميزانية المجموعة لكنه ممتاز في القليل الذي يصرفه — ناجح مخنوق`,
      action: "انسخه لمجموعة جديدة وحده ليأخذ فرصته (مع الحفاظ على تفاعلاته)، ثم أوقِف الأصل بعد استقرار النسخة",
    };
  }

  const parentWinning =
    parent !== undefined &&
    // T025 — parent cpa is read through the archetype-aware selector so
    // appointment/webinar compare on cost-per-lead (target unit), not on
    // the legacy cost-per-purchase figure that `parent.w3d.cpa` carries.
    // For `paid_lto` / `free_lead` this resolves to the same field as
    // before — SC-025, no behavior change for legacy archetypes.
    effectiveCpa(parent, archetype) !== null &&
    (effectiveCpa(parent, archetype) as number) <= t.unitTarget;

  if (parentWinning) {
    // ad set hitting target + normal/weak ad → leave it
    return {
      verdict: "continue",
      rule: "K5",
      reason: `تمنحه ميتا ${ad.spendSharePct.toFixed(1)}% فقط من ميزانية المجموعة، لكن المجموعة كلها تحقق هدفك`,
      action: "اتركه كما هو — لا تلمس شيئًا في مجموعة ناجحة",
    };
  }

  // T025 — zero-result detection uses the archetype-aware count so
  // appointment / webinar compare on leads (their judgement unit), not on
  // the legacy purchase count which they don't have.
  const weak =
    ad.w3d.ctrLink < ctrMedian &&
    (effectiveConversions(ad, archetype) ?? 0) === 0;
  if (weak) {
    // Hotfix T7: if the ad's diagnosis will be step 6 (ad+page clean, weak
    // CVR), kill with the funnel message instead of the generic "turn it
    // off" — those two are contradictory together.
    if (isStep6Candidate(ad, archetype)) {
      return {
        verdict: "kill",
        rule: "K5",
        reason: `تمنحه ميتا ${ad.spendSharePct.toFixed(1)}% فقط من ميزانية المجموعة — أوقفه الآن لأن مشكلتك الأساسية في العرض أو الفانل بعد البيع، وليس في هذا الإعلان تحديدًا. أصلح الفانل أولًا ثم أعد اختباره.`,
        action: "أوقِف الإعلان ثم أصلح صفحة البيع والعرض — ثم أَعِد اختبار مفهوم جديد",
      };
    }
    return {
      verdict: "kill",
      rule: "K5",
      reason: `تمنحه ميتا ${ad.spendSharePct.toFixed(1)}% فقط من ميزانية المجموعة وأداؤه ضعيف (ضغط قليل وبدون نتائج) داخل مجموعة متعثرة`,
      action: "أوقِفه — ركّز الميزانية على الأفضل",
    };
  }

  return {
    verdict: "watch",
    rule: "K5",
    reason: `تمنحه ميتا ${ad.spendSharePct.toFixed(1)}% فقط من ميزانية المجموعة — أداؤه متوسط والمجموعة تحت الهدف`,
    action: "راقبه — إن بقي محرومًا بنفس الأداء فأوقِفه",
  };
}

// ============================================================
// 72-hour decay map (الجزء السادس) — ads ≤ 4 days old
// ============================================================

function decayMap(ad: NormalizedObject, baselines: Baselines): Fired | null {
  if (ad.ageDays > 4 || ad.daily7.length < 3) return null;
  // need a real day-1 with meaningful volume
  const days = ad.daily7.filter(d => d.impressions > 100);
  if (days.length < 3) return null;

  const day1 = days[0];
  const last = days[days.length - 1];
  // performance proxy: Link CTR (primary creative signal)
  if (day1.ctrLink <= 0) return null;
  const dropPct = ((day1.ctrLink - last.ctrLink) / day1.ctrLink) * 100;

  if (dropPct >= 50) {
    return {
      verdict: "kill",
      rule: "K4",
      reason: `في آخر 3 أيام: اليوم الأول كان ممتازًا ثم هبط الأداء ${dropPct.toFixed(0)}% — نجاح لم يدُم`,
      action: "يوم أول قوي ثم انهيار — هذا إعلان برّاق استُنفدت شريحته. لا ترفع الميزانية محاولًا استعادة اليوم الأول، رفعها يكسر تعلّم الخوارزمية ويسرّع الانهيار. جهّز إعلانًا جديدًا بمفهوم مختلف كليًا.",
    };
  }
  if (dropPct > 0 && dropPct <= 30) {
    return {
      verdict: "continue",
      rule: "W2",
      reason: `في آخر 3 أيام: نزل قليلًا (${dropPct.toFixed(0)}%) بعد حماس اليوم الأول — هذا طبيعي وهو يستقر الآن`,
      action: "واصل — هذا مستواه الحقيقي، احكم عليه بمتوسط الأيام التالية لا باليوم الأول",
    };
  }
  if (dropPct <= 0) {
    const beatsMedian =
      baselines.ctrLinkMedian90 !== null && last.ctrLink > baselines.ctrLinkMedian90;
    return {
      verdict: "continue",
      rule: "S1",
      reason: `في آخر 3 أيام: أداؤه ثابت أو يتحسن${beatsMedian ? " والناس تضغط عليه أكثر من المعتاد" : ""} — إعلان قوي`,
      action: "مرشح للتوسيع — جهّز نسخه لجمهور أوسع بعد أن يثبت 3 أيام تحت الهدف",
      promotionEligible: beatsMedian,
      promotionNote: beatsMedian
        ? "انسخ هذا الإعلان باستخدام Post ID حتى تنتقل معه الإعجابات والتعليقات ويقل سعر الظهور (CPM). انقله من حملة الاختبار إلى حملة التوسيع. انسخ الـ Post ID لا الإعلان نفسه — فالـ Post ID يحمل معه كل التفاعل المتراكم."
        : null,
    };
  }
  // between 30% and 50% — middle zone: watch
  return {
    verdict: "watch",
    rule: "W1",
    reason: `في آخر 3 أيام: نزل ${dropPct.toFixed(0)}% — لم يتضح بعد هل سيستقر أم سيستمر في الهبوط`,
    action: "راقبه يومًا أو يومين إضافيين بدون أي تعديل",
  };
}

// ============================================================
// Fatigue signals (الجزء السابع) — previously-performing ads
// ============================================================

function fatigueSignals(ad: NormalizedObject, baselines: Baselines): Fired | null {
  if (ad.ageDays <= 4 || ad.daily7.length < 4) return null;

  const days = ad.daily7.filter(d => d.impressions > 100);
  if (days.length < 4) return null;

  // Signal 1: stable CPM + Link CTR down ≥25–30% from first-3-days peak
  const first3 = days.slice(0, 3);
  const peak = Math.max(...first3.map(d => d.ctrLink));
  const recent = days[days.length - 1].ctrLink;
  const cpmFirst = first3.reduce((s, d) => s + d.cpm, 0) / first3.length;
  const cpmRecent = days[days.length - 1].cpm;
  const cpmStable = cpmFirst > 0 && Math.abs(cpmRecent - cpmFirst) / cpmFirst < 0.15;
  // only meaningful if the ad was actually performing (peak above median)
  const wasWinning =
    baselines.ctrLinkMedian90 === null || peak >= baselines.ctrLinkMedian90;

  if (peak > 0 && wasWinning) {
    const ctrDrop = ((peak - recent) / peak) * 100;
    if (ctrDrop >= 25 && cpmStable) {
      return {
        verdict: "watch",
        rule: "F1",
        reason: `في آخر 3 أيام: الجمهور بدأ يملّ التصميم — ضغط الناس على الإعلان نزل ${ctrDrop.toFixed(0)}% (من ${peak.toFixed(2)}% إلى ${recent.toFixed(2)}%) بينما سعر الظهور ثابت`,
        action: "الجمهور ممتاز — لا تلمس المجموعة الإعلانية إطلاقًا. التصميم هو المنتهي. أضف نسخة بديلة جديدة في نفس المجموعة الإعلانية وانتظر 3 إلى 5 أيام: إذا عاد الأداء فالمشكلة كانت إنهاكًا، إذا بقي ضعيفًا فالمشكلة هيكلية.",
      };
    }
  }

  // Signal 3: CPM rising on this ad vs account average (recency penalty)
  if (baselines.cpmAvg14 && cpmRecent > 1.3 * baselines.cpmAvg14 && days.length >= 4) {
    const rising = cpmRecent > cpmFirst * 1.2;
    if (rising) {
      return {
        verdict: "watch",
        rule: "F2",
        reason: `في آخر 3 أيام: سعر ظهور هذا الإعلان يرتفع (${money(cpmRecent)}) عن متوسط حسابك (${money(baselines.cpmAvg14)}) — فيسبوك لم يعد يفضّل هذا التصميم`,
        action: "الخوارزمية تعاقب هذا التصميم تحديدًا في المزاد — تعتبره تجربة مستخدم ضعيفة. أضف تصميمًا جديدًا بجانبه في نفس المجموعة الإعلانية كاختبار تشخيصي: إذا نجح الجديد فالمشكلة في التصميم لا في الجمهور.",
      };
    }
  }

  return null;
}

// ============================================================
// Watch rules W1–W6 (5.2)
// ============================================================

function watchRules(
  o: NormalizedObject,
  t: JudgeableTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): Fired | null {
  const target = t.unitTarget;
  const { ctrLink, linkClicks, lpViews } = o.w3d;
  // T025 — cpa / conversions follow the archetype-aware selector.
  const cpa = effectiveCpa(o, archetype);
  const conversions = effectiveConversions(o, archetype) ?? 0;
  const ctrMedian = baselines.ctrLinkMedian90;

  // W1: CPA between 1×–1.5× target
  if (cpa !== null && cpa > target && cpa <= 1.5 * target) {
    return {
      verdict: "watch",
      rule: "W1",
      reason: `في آخر 3 أيام: تكلفة العميل ${money(cpa)} أعلى من هدفك (${money(target)}) بقليل — ليست كارثة`,
      action: "راقبه يومين أو ثلاثة بدون أي تعديل",
    };
  }

  // W2: single bad day after 2–3 good days
  if (o.daily7.length >= 3 && cpa !== null) {
    const days = o.daily7.filter(d => d.spend > 0);
    if (days.length >= 3) {
      const lastDay = days[days.length - 1];
      const prior = days.slice(-4, -1);
      // T025 — day-level CPA/conversions must follow the archetype-aware
      // selectors, otherwise appointment/webinar judge a purchase CPA
      // against a lead-based target here.
      const lastDayCpa = effectiveDailyCpa(lastDay, archetype);
      const lastBad =
        effectiveDailyConversions(lastDay, archetype) === 0 ||
        (lastDayCpa !== null && lastDayCpa > 1.5 * target);
      const priorGood =
        prior.length >= 2 &&
        prior.every(d => {
          const dCpa = effectiveDailyCpa(d, archetype);
          return dCpa !== null && dCpa <= target;
        });
      if (lastBad && priorGood) {
        return {
          verdict: "watch",
          rule: "W2",
          reason: `في آخر 3 أيام: يوم سيئ واحد بعد ${prior.length} أيام جيدة — أمر طبيعي جدًا`,
          action: "لا تلمسه — أي تعديل الآن سيخرب تعلّم فيسبوك ويزيد التكلفة",
        };
      }
    }
  }

  // W3: Link CTR above account median BUT page conversion weak — الإعلان بريء
  if (ctrMedian !== null && ctrLink > ctrMedian && lpViews >= 100) {
    const cvr = (conversions / lpViews) * 100;
    // FR-026a — the 15% lead-generation floor is Phase 7 (T064); Phase 2
    // keeps the legacy 2% product-purchase floor for every non-`free_lead`
    // archetype so the Phase 2/3 checkpoint does not silently widen it.
    const weakPage = archetype === "free_lead" ? cvr < 15 : cvr < 2;
    if (weakPage) {
      return {
        verdict: "watch",
        rule: "W3",
        reason: `في آخر 3 أيام: الناس تضغط على الإعلان أكثر من المعتاد (${ctrLink.toFixed(2)}%) لكن الصفحة لا تقنعهم بالشراء (${cvr.toFixed(1)}% فقط) — الإعلان بريء`,
        action: "⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا",
      };
    }
  }

  // W4: good clicks but LP views < 75% of clicks
  if (linkClicks >= 50 && lpViews > 0 && lpViews / linkClicks < 0.75) {
    return {
      verdict: "watch",
      rule: "W4",
      reason: `في آخر 3 أيام: من كل 100 شخص ضغطوا على الإعلان، ${((lpViews / linkClicks) * 100).toFixed(0)} فقط وصلوا للصفحة (المفترض 75 أو أكثر)`,
      action: "افحص سرعة تحميل صفحتك أولًا؛ إن كانت سريعة فتأكد أن الصفحة تطابق وعد الإعلان",
    };
  }

  // W6: CPA above target but العائد الكلي على الإنفاق ≥ breakeven (full buyer value)
  // FR-015b — SKIP entirely when `fullBuyerValue` is null (no fabricated zero).
  if (cpa !== null && cpa > target && conversions > 0 && t.fullBuyerValue !== null) {
    const fullBuyerValue = t.fullBuyerValue;
    const fullRoas = (conversions * fullBuyerValue) / o.w3d.spend;
    if (fullRoas >= 2.0) {
      return {
        verdict: "continue",
        rule: "W6",
        reason: `في آخر 3 أيام: تكلفة العميل ${money(cpa)} أعلى من هدفك، لكن عند حساب كل ما سيشتريه العميل لاحقًا (${money(fullBuyerValue)}) فأنت رابح (العائد الكلي على الإنفاق ${fullRoas.toFixed(1)}x)`,
        action: "واصل بحذر — وإن استمر هذا النمط ففكّر في رفع هدفك قليلًا",
      };
    }
  }

  // ISSUE-001 / FR-001 — zero-result fallthrough catch.
  // Sits AFTER all existing watch rules (W1–W6) and BEFORE the S2 continue
  // fallback in continueRules(). Bounded to the 1×–2× target gap so a
  // zero-result object at ≥ 2× target still reaches K1 (the ad-level
  // parity kill in evaluateAd, or the existing killRulesAdset K1).
  // Mutually exclusive with the existing W1 (which requires cpa !== null)
  // so reusing rule code "W1" never produces two different firings for
  // the same object.
  if (cpa === null && conversions === 0 && o.w3d.spend >= target && o.w3d.spend < 2 * target) {
    return {
      verdict: "watch",
      rule: "W1",
      reason: `صرف ${money(o.w3d.spend)} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة`,
      action: `راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ ${money(2 * target)} سيُوقف تلقائيًا`,
    };
  }

  return null;
}

// ============================================================
// Continue / Scale S1–S4 (5.4)
// ============================================================

function continueRules(
  o: NormalizedObject,
  t: JudgeableTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): Fired {
  const target = t.unitTarget;
  const { ctrLink } = o.w3d;
  // T025 — cpa / conversions follow the archetype-aware selector. The
  // legacy w3d cpa/conversions fields are populated for the existing
  // archetypes (SC-025); for the new archetypes the selector reads
  // `leadConversions` and synthesizes the cost-per-lead.
  const cpa = effectiveCpa(o, archetype);
  const conversions = effectiveConversions(o, archetype) ?? 0;
  const ctrMedian = baselines.ctrLinkMedian90;
  // Learning phase (الجزء الرابع): ad set لم يصل ~50 تحويلًا أسبوعيًا = حساس.
  // تجنب التعديلات الهيكلية أثناءه (القتل بالقواعد مسموح — يسبق هذه الدالة).
  // T025 — weekly total is archetype-aware (lead-based for appointment /
  // webinar, purchase-based for legacy archetypes).
  const inLearning = !!o.learningPhase || weeklyConversions(o, archetype) < 50;

  const cpaAtOrUnder = cpa !== null && cpa <= target;
  const beatsMedian = ctrMedian === null ? ctrLink >= 1.7 : ctrLink > ctrMedian;

  // Check 3 consecutive rolling days at/under target (S1 strict condition)
  let threeDaysUnder = false;
  const days = o.daily7.filter(d => d.spend > 0);
  if (days.length >= 3) {
    const last3 = days.slice(-3);
    // T025 — archetype-aware daily CPA: appointment/webinar compare a
    // per-day cost-per-lead against the CPL target, legacy archetypes keep
    // the purchase-based `d.cpa`.
    threeDaysUnder = last3.every(d => {
      const dCpa = effectiveDailyCpa(d, archetype);
      return dCpa !== null && dCpa <= target * 1.0;
    });
  }

  if (cpaAtOrUnder && threeDaysUnder && beatsMedian) {
    // S1 — promotion eligible
    return {
      verdict: "continue",
      rule: "S1",
      reason: `في آخر 3 أيام: حقق هدفك (تكلفة ${money(cpa!)}) ثلاثة أيام متتالية والناس تتفاعل معه أكثر من المعتاد (${ctrLink.toFixed(2)}%)`,
      action: "جاهز للتوسيع — انسخه لمرحلة أعلى مع الحفاظ على تفاعلاته (واترك الأصل يعمل)",
      promotionEligible: true,
      promotionNote: "انسخ هذا الإعلان باستخدام Post ID حتى تنتقل معه الإعجابات والتعليقات ويقل سعر الظهور (CPM). انقله من حملة الاختبار إلى حملة التوسيع. انسخ الـ Post ID لا الإعلان نفسه — فالـ Post ID يحمل معه كل التفاعل المتراكم.",
    };
  }

  if (cpaAtOrUnder && conversions >= 3) {
    // Learning-phase gate: structural edits (incl. budget changes) are risky
    if (inLearning && o.level === "adset") {
      return {
        verdict: "continue",
        rule: "S2",
        reason: `في آخر 3 أيام: تكلفة العميل ${money(cpa!)} أقل من هدفك، لكن فيسبوك ما زال يتعلّم على هذه المجموعة`,
        action: "واصل بدون أي تعديل — أي تغيير الآن يعيد تعلّم فيسبوك من الصفر؛ وسّع بعد خروجه من مرحلة التعلّم",
      };
    }
    // stable winner — S4 (don't touch) / S3 (horizontal) / S2 (vertical)
    const stable = days.length >= 5;
    if (stable) {
      // S3: clearly winning with headroom (CPA ≤ 80% of target) → faster
      // expansion should be HORIZONTAL (Post ID copy), not vertical jumps
      if (o.level === "adset" && cpa !== null && cpa <= 0.8 * target) {
        return {
          verdict: "continue",
          rule: "S3",
          reason: `في آخر 3 أيام: رابح بفارق كبير — تكلفة العميل ${money(cpa)} أقل بوضوح من هدفك (${money(target)}) وباستقرار`,
          action: "انسخه لجمهور جديد مع الحفاظ على تفاعلاته — أفضل من رفع الميزانية كثيرًا",
        };
      }
      return {
        verdict: "continue",
        rule: "S4",
        reason: `في آخر 3 أيام: رابح ثابت — تكلفة العميل ${money(cpa!)} أقل من هدفك باستمرار`,
        action: "لا تلمسه — أضف بجانبه نسخًا معدّلة خفيفة لتطيل عمره",
      };
    }
    return {
      verdict: "continue",
      rule: "S2",
      reason: `في آخر 3 أيام: تكلفة العميل ${money(cpa!)} أقل من هدفك (${money(target)})`,
      action: "إن أردت التوسيع: زد الميزانية 20% فقط كل يومين أو ثلاثة — الزيادة الكبيرة تخرب التعلّم",
    };
  }

  if (cpaAtOrUnder) {
    return {
      verdict: "continue",
      rule: "S2",
      reason: `في آخر 3 أيام: تكلفة العميل ${money(cpa!)} أقل من هدفك (${money(target)}) — لكن عدد النتائج ما زال قليلًا`,
      action: "واصل بنفس الميزانية — ووسّع بعد ثبات 3 أيام",
    };
  }

  // No CPA yet but gates passed and CTR healthy
  return {
    verdict: "continue",
    rule: "S2",
    reason: `في آخر 3 أيام: الأرقام في النطاق الطبيعي — نسبة الضغط على الإعلان ${ctrLink.toFixed(2)}%${ctrMedian !== null ? ` (متوسط حسابك ${ctrMedian.toFixed(2)}%)` : ""}`,
    action: "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام",
  };
}

// ============================================================
// Diagnosis (الجزء الثامن) — collect ALL broken rungs per entity
// ============================================================

/**
 * Spec 014 / contract §C3.2 — code-keyed Arabic copy for the five
 * ad-fault rules. Restates each rule's own reasoning without echoing
 * `fired.reason_ar` verbatim and without printing the code itself
 * (Constitution II). Each entry derives from `RULES[code].defAr` in
 * shared/qarar.ts:33-140.
 */
const AD_FAULT_COPY: Record<
  "K1" | "K3" | "K4" | "F1" | "F2",
  () => string
> = {
  K1: () =>
    "هذا الإعلان لم يأتِ بأي نتيجة رغم المصروف الذي صرفه — المشكلة في الإعلان نفسه، لا في الصفحة أو العرض",
  K3: () =>
    "عدد كبير شاهد الإعلان وأقل من نصف في المئة ضغط عليه — بداية الإعلان لا توقف أحدًا، غيّر التصميم",
  K4: () =>
    "أول يوم كان ممتازًا ثم هبط الأداء للنصف أو أكثر — لا تطارد نجاح اليوم الأول، فقد انتهى",
  F1: () =>
    "ضغط الناس على الإعلان نزل ربع أو ثلث عمّا كان — الجمهور ملّ التصميم، جهّز تصميمًا جديدًا",
  F2: () =>
    "سعر ظهور هذا الإعلان يرتفع عن باقي حسابك — فيسبوك لم يعد يحب هذا التصميم",
};

/**
 * Spec 014 / contract §C3.1 — `INSUFFICIENT_DATA` text. C3.1: state
 * the observed counts, then name the single gate furthest from being
 * met (spec A6). Every figure LTR per C5.2. No claim about where
 * the problem is or is not — operationally, none of `BLAME_CLAIMS`.
 */
function insufficientDataText(o: NormalizedObject): string {
  const w = o.w3d;
  // Compute each gate's deficit (positive = still need N more).
  // The single largest deficit is named (spec A6).
  const cpmGate = DIAGNOSIS_GATES.CPM_MIN_IMPRESSIONS + 1; // strict > 500
  const ctrGate = DIAGNOSIS_GATES.CTR_MIN_IMPRESSIONS;
  const lpClickGate = DIAGNOSIS_GATES.LP_MIN_LINK_CLICKS;
  const lpViewsGate = DIAGNOSIS_GATES.CVR_MIN_LP_VIEWS;
  const deficits: Array<{ label: string; need: number; current: number }> = [
    {
      label: "مرات الظهور للحكم على السعر",
      need: cpmGate,
      current: Math.round(w.impressions),
    },
    {
      label: "مرات الظهور للحكم على الهوك",
      need: ctrGate,
      current: Math.round(w.impressions),
    },
    {
      label: "ضغطات للحكم على الوصول للصفحة",
      need: lpClickGate,
      current: Math.round(w.linkClicks),
    },
    {
      label: "زيارات للصفحة للحكم على التحويل",
      need: lpViewsGate,
      current: Math.round(w.lpViews),
    },
  ];
  let best = deficits[0];
  for (const d of deficits) {
    const dBest = (best.need - best.current) / best.need;
    const dCur = (d.need - d.current) / d.need;
    if (dCur > dBest) best = d;
  }
  const stillNeed = Math.max(0, Math.ceil(best.need - best.current));
  return (
    `شُوهد ${nf(w.impressions)} مرة، ضُغط ${nf(w.linkClicks)} مرة، ووصلت ${nf(w.lpViews)} زيارة للصفحة خلال آخر 3 أيام — ` +
    `ما زالت البيانات غير كافية للحكم على هذا الإعلان. يلزم تقريبًا ${stillNeed} ${best.label} إضافية قبل أن نقدر نحكم بثقة.`
  );
}

/**
 * Spec 014 / contract §C3.3 — `NO_BLAME_ASSIGNABLE` text. State what
 * was measured and came back healthy and stop there. No `ctaUrl`,
 * no claim about where the problem is or is not.
 */
function noBlameAssignableText(
  o: NormalizedObject,
  ev: RungEvaluation,
  baselines: Baselines
): string {
  const w = o.w3d;
  const parts: string[] = [];
  if (ev[1] === "clean" && baselines.cpmAvg14 !== null) {
    parts.push(
      `سعر الظهور طبيعي (${money(w.cpm)} مقابل متوسط ${money(baselines.cpmAvg14)})`
    );
  }
  if (ev[2] === "clean") {
    const median = baselines.ctrLinkMedian90;
    parts.push(
      median !== null
        ? `نسبة الضغط أعلى من متوسط حسابك (${w.ctrLink.toFixed(2)}% مقابل ${median.toFixed(2)}%)`
        : `نسبة الضغط أعلى من عتبة 1.0% (${w.ctrLink.toFixed(2)}%)`
    );
  }
  if (ev[3] === "clean") {
    parts.push("الرسالة ودعوة الشراء متسقتان");
  }
  if (ev[4] === "clean") {
    const pct = Math.round((w.lpViews / w.linkClicks) * 100);
    parts.push(`${pct}% ممن ضغطوا وصلوا للصفحة`);
  }
  if (parts.length === 0) {
    return "ما تم قياسه من هذا الإعلان جاء ضمن الحدود الطبيعية، لكن الحكم على مكان المشكلة يحتاج بيانات إضافية.";
  }
  return "ما تم قياسه من هذا الإعلان جاء ضمن الحدود الطبيعية: " +
    parts.join("، ") +
    ". الحكم على مكان المشكلة يحتاج بيانات إضافية.";
}

/**
 * Spec 014 / contract §C3.4 — `FUNNEL_CONFIRMED` ladder text. Ordered
 * funnel from C3.4 step 1..5, conclusion last. At least three
 * distinct figures from this object's own window (SC-004). Every
 * figure LTR per C5.2; currency through `money()` per C5.3.
 *
 * `mode` selects the route:
 *   - "clause4" — the rung-precondition route (C2.2 clause 4).
 *   - "w5" — the campaign W5 evidence path (C4). The cost-per-customer
 *     figure is required by C4.4 and printed at step 5. It also
 *     suppresses the account-median comparison at step 2, because
 *     `ctrLinkMedian90` is fetched at ad level and is not like-for-like
 *     for a campaign aggregate (C4.4).
 *
 * `archetype` is REQUIRED, not defaulted. Step 4's conversion figure
 * must be computed with the same archetype `evaluateRungs` used for
 * rung 5 — otherwise an appointment/webinar account can print a
 * purchase-based percentage under a claim that rung 5 licensed on
 * leads, and the ladder contradicts its own evidence (self-review F1).
 */
function funnelConfirmedText(
  o: NormalizedObject,
  ev: RungEvaluation,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"],
  mode: "clause4" | "w5",
  campaignCpa: number | null
): string {
  const w = o.w3d;
  const lines: string[] = [];

  // Step 1 — impressions.
  lines.push(`شُوهد الإعلان ${nf(w.impressions)} مرة في آخر 3 أيام`);

  // Step 2 — link clicks + account median comparison (C3.4a when null).
  const ctrLine =
    w.linkClicks > 0
      ? `${nf(w.linkClicks)} شخص ضغط على الإعلان (نسبة الضغط ${w.ctrLink.toFixed(2)}%)`
      : `${w.ctrLink.toFixed(2)}% من المشاهدين ضغطوا`;
  if (mode === "w5") {
    // C4.4: the median step is stated unavailable for a campaign
    // because `ctrLinkMedian90` is fetched at ad level and is not a
    // like-for-like comparison for a campaign aggregate.
    lines.push(`${ctrLine} — متوسط حسابك للمقارنة غير متاح على مستوى الحملة`);
  } else if (baselines.ctrLinkMedian90 === null) {
    lines.push(`${ctrLine} — متوسط حسابك للمقارنة غير متاح`);
  } else {
    lines.push(
      `${ctrLine} — متوسط حسابك ${baselines.ctrLinkMedian90.toFixed(2)}%`
    );
  }

  // Step 3 — landing-page views as a share of link clicks. Print
  // when available; state unavailable when not (FR-007a).
  if (w.linkClicks > 0 && w.lpViews > 0) {
    const arrival = Math.round((w.lpViews / w.linkClicks) * 100);
    lines.push(`${arrival}% ممن ضغطوا وصلوا لصفحتك`);
  } else {
    lines.push(`نسبة الوصول للصفحة غير متاحة (لم تُسجَّل زيارات)`);
  }

  // Step 4 — conversions as a share of landing-page views. The unit
  // is archetype-dependent (`leadConversions` for appointment/webinar,
  // `conversions` otherwise) and MUST match the unit rung 5 was
  // evaluated on — see `evaluateRungs`.
  if (w.lpViews > 0) {
    const conv = effectiveConversions(o, archetype) ?? 0;
    const cvr = (conv / w.lpViews) * 100;
    lines.push(
      `${cvr.toFixed(1)}% من زوار الصفحة ${conversionVerb(archetype, "past")}`
    );
  } else {
    lines.push(`نسبة التحويل على الصفحة غير متاحة (لم تُسجَّل زيارات)`);
  }

  // Step 5 — conclusion. For W5: print the measured campaign CPA
  // (C4.4). For clause-4: print the leak conclusion without a CPA.
  if (mode === "w5") {
    const cpaText = campaignCpa !== null ? money(campaignCpa) : "—";
    lines.push(
      `الإعلان يجلب عملاء بسعر جيد (${cpaText} للعميل)، لكن التحويل بعد البيع ضعيف — راجع المتابعة والرسائل بعد البيع`
    );
  } else {
    lines.push(
      "الإعلان يؤدي وظيفته، لكن التحويل ضعيف — المشكلة في العرض أو مسار الفانل"
    );
  }

  return lines.join(" — ");
}

/**
 * `htoUnderperforming` is the account-level funnel flag from
 * `FunnelInputs`, passed EXPLICITLY (self-review F2). It was previously
 * inferred from `fired.ctaUrl` being set, which is not a signal at all:
 * `evaluateCampaign` attaches the discovery CTA to every W5 `Fired` it
 * returns, so that check was structurally always true and the C4 guard
 * only agreed with the intended behaviour by accident, via W5's own
 * firing condition. It defaults to `false` so the evidence path fails
 * closed for any caller that does not state the flag.
 */
export function diagnose(
  o: NormalizedObject,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"],
  fired: Fired,
  htoUnderperforming: boolean = false
): Finding[] {
  const w = o.w3d;
  const findings: Finding[] = [];

  // Step 1 — build the per-rung evaluation record (contract §C1).
  const ev = evaluateRungs(o, baselines, archetype);
  const { clean, broken } = evalSets(ev);

  // Push broken rungs in ascending order (C1.6). Each carries its
  // own `RUNG_*` outcome; no terminal outcome is appended when at
  // least one rung broke (C2.1, V7).
  if (ev[1] === "broken") {
    findings.push({
      step: 1,
      outcome: "RUNG_CPM",
      text_ar: `سعر الظهور مرتفع على هذا الإعلان تحديدًا (${money(w.cpm)} مقابل متوسط ${money(baselines.cpmAvg14 ?? 0)}) — فيسبوك يرفع سعر التصميم الذي لا يعجب الناس`,
      primary: false,
    });
  }
  if (ev[2] === "broken") {
    findings.push({
      step: 2,
      outcome: "RUNG_HOOK",
      text_ar: `ضغط الناس على الإعلان قليل (${w.ctrLink.toFixed(2)}%) رغم أن سعر الظهور طبيعي — المشكلة في التصميم نفسه، جدّده`,
      primary: false,
    });
  }
  if (ev[3] === "broken") {
    findings.push({
      step: 3,
      outcome: "RUNG_MISMATCH",
      text_ar: `الناس تتفاعل مع الإعلان (${w.ctrAll.toFixed(2)}%) لكنها لا تضغط للشراء (${w.ctrLink.toFixed(2)}%) — بداية الإعلان جيدة لكن الرسالة أو دعوة الشراء ضعيفة`,
      primary: false,
    });
  }
  if (ev[4] === "broken") {
    findings.push({
      step: 4,
      outcome: "RUNG_ARRIVAL",
      text_ar: `${Math.round((w.lpViews / w.linkClicks) * 100)}% فقط ممن ضغطوا وصلوا لصفحتك (المفترض 75%+) — افحص سرعة التحميل أولًا، ثم تأكد أن الصفحة تطابق وعد الإعلان`,
      primary: false,
    });
  }
  if (ev[5] === "broken") {
    // Rung 5 wording selector — FR-017, FR-017a. The neutral wording
    // reports the weak conversion without absolving the ad. The
    // innocence wording is selected only when the fired rule is NOT
    // ad-fault AND rungs 1–4 are ALL `clean`. C8.3 / FR-017b: the
    // outcome identity stays `RUNG_CONVERSION` in both wordings and
    // the finding keeps its `ctaUrl` in both.
    const conv = effectiveConversions(o, archetype);
    const cvr = conv !== undefined && w.lpViews > 0 ? (conv / w.lpViews) * 100 : 0;
    const adClean =
      RULE_FAULT[fired.rule] !== "ad-fault" &&
      ev[1] === "clean" &&
      ev[2] === "clean" &&
      ev[3] === "clean" &&
      ev[4] === "clean";
    findings.push({
      step: 5,
      outcome: "RUNG_CONVERSION",
      text_ar: adClean
        ? `الناس تصل لصفحتك لكن ${cvr.toFixed(1)}% فقط ${conversionVerb(archetype, "present")} — المشكلة في الصفحة أو العرض أو السعر — ⚠️ الإعلان بريء، لا تعدّله`
        : `قلة ممن يصلون لصفحتك ${conversionVerb(archetype, "present")} (${cvr.toFixed(1)}%) — راجع الصفحة أو العرض أو السعر أيضًا`,
      primary: false,
      ctaUrl: DISCOVERY_CALL_URL,
    });
  }

  // Terminal outcome — only when no rung broke (C2.1).
  if (broken.size === 0) {
    const { evaluable } = evalSets(ev);
    const faultClass: RuleFaultClass = RULE_FAULT[fired.rule];

    let terminal: Finding | null = null;

    // C4 — W5 evidence path. Opens FUNNEL_CONFIRMED without C2.2
    // clause 4's rung precondition when (a) the explicit funnel
    // flag is set, AND (b) a measured campaign CPA exists.
    const isW5Campaign =
      fired.rule === "W5" && o.level === "campaign";
    if (isW5Campaign) {
      // (b) the measured campaign CPA, read through the archetype-aware
      // selector so appointment / webinar are judged on cost-per-lead —
      // the same unit W5's own firing condition uses (T025). Reading the
      // legacy `o.w3d.cpa` here denied the evidence path to exactly the
      // archetypes T025 exists to protect (self-review F3).
      const cpa = effectiveCpa(o, archetype);
      // (a) the account-level funnel flag, passed explicitly by the
      // caller — never inferred from copy or from `fired.ctaUrl`.
      if (htoUnderperforming && cpa !== null) {
        terminal = {
          step: 6,
          outcome: "FUNNEL_CONFIRMED",
          text_ar: funnelConfirmedText(o, ev, baselines, archetype, "w5", cpa),
          primary: false,
          ctaUrl: DISCOVERY_CALL_URL,
        };
      }
    }

    if (!terminal) {
      // C2.2 precedence — clauses 1..5.
      if (evaluable.size === 0) {
        // Clause 1.
        terminal = {
          step: 6,
          outcome: "INSUFFICIENT_DATA",
          text_ar: insufficientDataText(o),
          primary: false,
        };
      } else if (faultClass === "ad-fault") {
        // Clause 2.
        const code = fired.rule as "K1" | "K3" | "K4" | "F1" | "F2";
        terminal = {
          step: 6,
          outcome: "AD_IS_THE_PROBLEM",
          text_ar: AD_FAULT_COPY[code](),
          primary: false,
        };
      } else if (faultClass === "neither") {
        // Clause 3.
        terminal = {
          step: 6,
          outcome: "NO_BLAME_ASSIGNABLE",
          text_ar: noBlameAssignableText(o, ev, baselines),
          primary: false,
        };
      } else if (
        faultClass === "funnel-fault" &&
        ev[4] === "clean" &&
        ev[5] === "clean"
      ) {
        // Clause 4 — rung-precondition route. Synthesizable; not
        // reachable through `runEngine` per C2.6 / research §R3.3.
        terminal = {
          step: 6,
          outcome: "FUNNEL_CONFIRMED",
          text_ar: funnelConfirmedText(o, ev, baselines, archetype, "clause4", null),
          primary: false,
          ctaUrl: DISCOVERY_CALL_URL,
        };
      } else if (faultClass === "funnel-fault") {
        // Clause 5 — fall-through when clause 4's rung precondition
        // is unmet.
        terminal = {
          step: 6,
          outcome: "INSUFFICIENT_DATA",
          text_ar: insufficientDataText(o),
          primary: false,
        };
      }
    }

    if (terminal) findings.push(terminal);
  }

  // Mark the first finding as primary (V14).
  if (findings.length > 0) {
    findings[0].primary = true;
  }

  return findings;
}

// ============================================================
// Spec 013 / US2 — non-sales exemption branch (FR-006..FR-014,
// contracts/non-sales-exemption.md §C1..C4). Evaluated as the FIRST
// statement of every per-object evaluator (FR-009b) and ONLY for exempt
// objects — non-exempt objects see the existing pipeline byte-identical
// (FR-020, SC-010).
// ============================================================

/**
 * Resolve the daily-rate figure an exempt object is judged against.
 * Returns BOTH the amount and its provenance (C4) so FR-012b can be
 * enforced structurally: `NS1` is unreachable with `source === "none"`
 * when a lifetime budget is present.
 *
 *   1. `dailyBudget` present → "daily"
 *   2. `lifetimeBudget` present and span resolves to ≥ 1 day → "lifetime"
 *   3. `lifetimeBudget` present, span unresolvable, delivery meaningful
 *      → "observed" (w3d.spend / 3)
 *   4. otherwise → "none"
 *
 * Span rule (R4 / C4): `ceil((flightEnd − flightStart) / 1 day)`.
 * Zero, negative, unparseable, or missing → unresolvable → next rung.
 * Never divide by zero (C4.2).
 *
 * `hadLifetime` flags whether the resolution path entered the
 * lifetime-budget branch at all — needed by the caller to distinguish
 * the genuine-no-budget `none` (FR-012c ⇒ NS1) from the lifetime-no-
 * resolvable-rate `none` (FR-009c ⇒ ⏳ GATE). Collapsing the two
 * re-opens the FR-012b hole.
 */
type DailyRateSource = "daily" | "lifetime" | "observed" | "none";

interface DailyRate {
  amount: number | null;
  source: DailyRateSource;
  hadLifetime: boolean;
}

function resolveDailyRate(o: NormalizedObject): DailyRate {
  if (o.dailyBudget != null) {
    return { amount: o.dailyBudget, source: "daily", hadLifetime: false };
  }
  if (o.lifetimeBudget != null) {
    const start = o.flightStart ?? null;
    const end = o.flightEnd ?? null;
    if (start !== null && end !== null) {
      const t0 = Date.parse(start);
      const t1 = Date.parse(end);
      if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) {
        const ms = t1 - t0;
        const days = Math.max(1, Math.ceil(ms / 86400000));
        return {
          amount: o.lifetimeBudget / days,
          source: "lifetime",
          hadLifetime: true,
        };
      }
    }
    // Span unresolvable — try the observed rung (3-day insight average).
    if (o.w3d.spend > 0) {
      return {
        amount: o.w3d.spend / 3,
        source: "observed",
        hadLifetime: true,
      };
    }
    // Lifetime budget present but neither span nor delivery — unjudgeable.
    return { amount: null, source: "none", hadLifetime: true };
  }
  // Genuine no-budget case (ad row, CBO ad set, ABO campaign).
  return { amount: null, source: "none", hadLifetime: false };
}

/**
 * Non-sales exemption branch — entered FIRST in every evaluator and
 * ONLY for exempt objects (FR-009b). Returns `null` for non-exempt
 * objects so the existing pipeline continues untouched (C2.1, SC-010).
 *
 * Ladder (C3):
 *   1. paused ⇒ existing paused GATE Fired verbatim (FR-009)
 *   2. daily rate resolves, ≤ threshold ⇒ NS1 continue (FR-013)
 *   3. daily rate resolves, > threshold ⇒ NS2 watch (FR-014)
 *   4. no budget at this level (genuine absence) ⇒ NS1 (FR-012c)
 *   5. lifetime budget with no resolvable rate ⇒ ⏳ GATE (FR-009c, FR-012b)
 *
 * The boundary is inclusive on the compliant side: equal-to-threshold ⇒
 * NS1 (C3.1).
 *
 * NS2 reason/action copy is simple Arabic at ≤6th-grade reading level
 * with the threshold rendered through the existing `money()` helper
 * bound to the account currency (FR-018, FR-019).
 */
function evaluateNonSales(
  o: NormalizedObject,
  threshold: number
): Fired | null {
  // C1 — membership-only exemption predicate. Null / unknown / future
  // values fall through and return `null` so the existing pipeline runs.
  if (!isNonSalesExempt(o.objective ?? null)) return null;

  // Row 1 (C3) — paused wins over the non-sales branch (FR-009). The
  // existing paused branch in gateVerdict produces the same GATE Fired
  // we want here — emit it verbatim so the Arabic copy stays in one
  // place rather than being duplicated across two files.
  const effectiveDelivered = o.effectiveStatus ?? o.status;
  if (effectiveDelivered !== "ACTIVE") {
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: "هذا الإعلان موقوف الآن — لا يصرف ولا يجمع بيانات",
      action: "شغّله إن أردت تقييمه، أو احذفه إن لم تعد تحتاجه",
    };
  }

  const rate = resolveDailyRate(o);

  // Row 4 (C3) — genuine no-budget at this level. Threshold is enforced
  // once at the level that actually holds the budget; the rest of the
  // tree is exempt by inheritance (FR-012c, FR-015). The `none` source
  // here means a LIFETIME-BUDGET OBJECT WITH NO RESOLVABLE RATE is
  // handled separately on row 5 (C3.3) — collapsing the two would
  // re-open the FR-012b hole.
  if (rate.source === "none" && !rate.hadLifetime) {
    return {
      verdict: "continue",
      rule: "NS1",
      reason:
        "هذه الحملة هدفها التوعية أو جذب الزيارات، لا تُحكم على المبيعات المباشرة — استمر بنفس الميزانية",
      action: "تابع أداء الحملة على المدى الطويل — الميزانية اليومية ضمن الحد المسموح",
    };
  }

  // Rows 2 & 3 (C3) — daily-rate ladder reached.
  if (rate.amount !== null && rate.amount <= threshold) {
    return {
      verdict: "continue",
      rule: "NS1",
      reason:
        "هذه الحملة هدفها التوعية أو جذب الزيارات، لا تُحكم على المبيعات المباشرة — ميزانيتها اليومية ضمن الحد المسموح",
      action: "تابع أداء الحملة على المدى الطويل — الميزانية اليومية ضمن الحد المسموح",
    };
  }
  if (rate.amount !== null && rate.amount > threshold) {
    return {
      verdict: "watch",
      rule: "NS2",
      reason: `هذه الحملة هدفها غير مباشر (التوعية أو جذب الزيارات)، لكن ميزانيتها اليومية ${money(rate.amount)} أعلى من الحد المسموح ${money(threshold)} — قلّلها`,
      action: `قلّل الميزانية اليومية إلى ${money(threshold)} أو أقل لتعود إلى المستوى المناسب`,
    };
  }

  // Row 5 (C3) — lifetime budget present, no resolvable rate. The
  // single FR-009c carve-out that lets an active exempt object read ⏳.
  // Crucially distinct from the no-budget row above (C3.3) — collapsing
  // the two re-opens the FR-012b hole.
  return {
    verdict: "too_early",
    rule: "GATE",
    reason:
      "ميزانية هذه الحملة lifetime ولا يوجد جدول زمني أو بيانات صرف كافية لتحديد المعدل اليومي — البيانات لم تكتمل بعد",
    action: "شغّل الحملة لفترة كافية لجمع بيانات، أو اضبط ميزانية يومية واضحة بدل lifetime",
  };
}

// ============================================================
// Campaign-level evaluation (5.0: judged by العائد الكلي على الإنفاق)
// ============================================================

function evaluateCampaign(
  o: NormalizedObject,
  t: JudgeableTargets,
  childRows: EngineRow[],
  htoUnderperforming: boolean,
  archetype: FunnelInputs["archetype"],
  nsThreshold: number
): Fired {
  // Spec 013 / T025 — exempt branch entered FIRST and ONLY for exempt
  // objects (FR-009b). Non-exempt objects continue with the existing
  // pipeline byte-identically (FR-020, SC-010).
  const ns = evaluateNonSales(o, nsThreshold);
  if (ns) return ns;

  // T026 — pre-separation snapshot guard (see evaluateAd for the rationale).
  // For appointment/webinar with `leadConversions === undefined` we cannot
  // judge at the campaign level either (campaign totals include those
  // child objects, all of which are also pre-separation).
  const preSep = preSeparationGate(o, archetype);
  if (preSep) return preSep;
  const { spend } = o.w3d;
  // T025 / T026 — campaign-level conversion count follows the archetype
  // selector. `paid_lto` / `free_lead` keep the legacy field (SC-025);
  // the new archetypes read `leadConversions`. A missing lead count on a
  // pre-separation snapshot falls through to `0` only at the
  // zero-result guard (FR-034, FR-035) — the engine above already
  // rejected that object at the pre-separation gate (T026) so we never
  // reach evaluateCampaign with an undefined count for the new archetypes.
  const conversions = effectiveConversions(o, archetype) ?? 0;
  if (spend < t.unitTarget) {
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: "في آخر 3 أيام: صرف الحملة أقل من تكلفة عميل واحد — لا يمكن الحكم عليها بعد",
      action: "اترك البيانات تتجمع",
    };
  }
  // FR-015b — when `fullBuyerValue` is null we cannot compute full-ROAS;
  // skip every branch that depends on it (S2, W6, the W6 fallback).
  const hasFullRoas = t.fullBuyerValue !== null;
  const fullRoas =
    hasFullRoas && spend > 0
      ? (conversions * (t.fullBuyerValue as number)) / spend
      : 0;
  const killChildren = childRows.filter(r => r.verdict === "kill").length;

  // W5 — funnel-level signal (user-reported): LTO ليدات/مبيعات جيدة لكن
  // لا حضور/مبيعات HTO. Meta's API can't see post-conversion data, so this
  // is driven by the explicit funnel-settings flag. الإعلان بريء — حُكم فانل.
  // T025 — campaign cpa is read through the archetype-aware selector so
  // appointment / webinar compare on cost-per-lead (the judgement unit),
  // not on the legacy cost-per-purchase figure that `o.w3d.cpa` carries.
  const campaignCpa = effectiveCpa(o, archetype);
  if (
    htoUnderperforming &&
    conversions > 0 &&
    campaignCpa !== null &&
    campaignCpa <= 1.5 * t.unitTarget
  ) {
    return {
      verdict: "watch",
      rule: "W5",
      reason: `في آخر 3 أيام: الإعلانات تجلب عملاء بسعر جيد (${money(campaignCpa)}) لكن المشكلة في العرض أو مسار الفانل — الإعلان بريء`,
      action: "لا تغيّر شيئًا في الإعلانات — راجع العرض ومسار التحويل بعد البيع الأول، واحجز مكالمة تشخيصية",
      ctaUrl: DISCOVERY_CALL_URL,
    };
  }

  if (hasFullRoas && fullRoas >= 2.0) {
    return {
      verdict: "continue",
      rule: "S2",
      reason: `في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع ${fullRoas.toFixed(1)}x عند حساب قيمة العميل الكاملة (${money(t.fullBuyerValue as number)})${killChildren ? ` — مع ${killChildren} إعلان/مجموعة تحتاج إيقافًا بالداخل` : ""}`,
      action: killChildren
        ? "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك"
        : "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة",
    };
  }
  if (hasFullRoas && fullRoas >= 1.0) {
    return {
      verdict: "watch",
      rule: "W6",
      reason: `في آخر 3 أيام: الحملة تغطي تكلفتها بالكاد (العائد الكلي على الإنفاق ${fullRoas.toFixed(1)}x) — فوق التعادل لكن الربح قليل`,
      action: "راقبها وأوقِف الإعلانات الحمراء بالداخل أولًا",
    };
  }
  if (conversions === 0 && spend >= 2 * t.unitTarget) {
    return {
      verdict: "kill",
      rule: "K1",
      reason: `في آخر 3 أيام: الحملة صرفت ${money(spend)} (ضعف هدفك) بدون أي نتيجة`,
      action: "أوقِف الحملة — لا تبيع أصلًا",
    };
  }
  if (!hasFullRoas) {
    // No full-buyer value to evaluate profitability against — we cannot
    // say "campaign is losing" or "campaign is winning". Fall through to
    // a neutral continue. The per-object kills/watch inside the campaign
    // are already surfaced via killChildren + childRows.
    return {
      verdict: "continue",
      rule: "S2",
      reason: "في آخر 3 أيام: الحملة صرفت ما يكفي من البيانات للحكم على الإعلانات بالداخل — راجعها",
      action: "تابع أداء الإعلانات داخل الحملة — قرار الربح الإجمالي يعتمد على إعدادات الفانل",
    };
  }
  return {
    verdict: "watch",
    rule: "W6",
    reason: `في آخر 3 أيام: الحملة تخسر حاليًا — العائد الكلي على الإنفاق ${fullRoas.toFixed(1)}x فقط`,
    action: "أوقِف الإعلانات الحمراء بالداخل وراجع عرضك وصفحتك قبل أي ميزانية إضافية",
  };
}

// ============================================================
// Ad-level evaluation pipeline
// ============================================================

function evaluateAd(
  ad: NormalizedObject,
  parent: NormalizedObject | undefined,
  t: JudgeableTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines,
  nsThreshold: number
): Fired {
  // Spec 013 / T023 — exempt branch entered FIRST and ONLY for exempt
  // objects (FR-009b). Reaches before preSeparationGate, K3 explicit
  // kill, and the starved matrix (C2.2). Non-exempt objects continue
  // with the existing pipeline byte-identically (FR-020, SC-010).
  const ns = evaluateNonSales(ad, nsThreshold);
  if (ns) return ns;

  // T026 — pre-separation snapshot guard. For `appointment` / `webinar`,
  // `leadConversions === undefined` means the snapshot predates the
  // lead/purchase split (research R6, FR-035). The unit is unknown — do
  // not judge. For `paid_lto` / `free_lead` this is a no-op (those
  // archetypes read the legacy `conversions`, which is always populated).
  const preSep = preSeparationGate(ad, archetype);
  if (preSep) return preSep;

  // K3 explicit kill allowed even at low sample (1,500 imp + CTR < 0.5%)
  const k3 = killK3(ad);
  if (k3) return k3;

  // Starved-ad matrix (K5) — evaluated BEFORE the generic data gates:
  // "الإعلان المحروم من الصرف لا يُحكم عليه بالـ CPA" — a starved ad can
  // never satisfy spend/impression gates precisely because it is starved,
  // so gating it would hide the rescue/kill decision the matrix exists for.
  const starved = starvedAdMatrix(ad, parent, t, baselines, archetype);
  if (starved) return starved;

  // 1. Gates
  const gate = gateVerdict(ad, t.unitTarget);
  if (gate) return gate;

  // 2. (circuit breaker is ad-set level)

  // 3. K1 zero-result kill (ISSUE-001 / FR-001b) — ad-level parity with
  // killRulesAdset. Without this, a zero-result ad at ≥ 2× target used to
  // fall through to the S2 continue fallback. The kill sits BEFORE the
  // decay map and BEFORE the watch catch so a zero-result ad in the kill
  // range never gets re-classified as "watch" by the new FR-001 catch.
  // T025 — the zero-result check uses the archetype-aware selector so the
  // new archetypes compare on lead counts.
  const adConv = effectiveConversions(ad, archetype) ?? 0;
  if (adConv === 0 && ad.w3d.spend >= 2 * t.unitTarget) {
    return {
      verdict: "kill",
      rule: "K1",
      reason: `في آخر 3 أيام: صرف ${money(ad.w3d.spend)} (ضعف هدفك ${money(t.unitTarget)}) بدون أي نتيجة — لا يبيع أصلًا`,
      action: "أوقِف هذه المجموعة",
    };
  }

  // 5. 72-hour decay map (ads ≤ 4 days)
  const decay = decayMap(ad, baselines);
  if (decay) return decay;

  // 6. Fatigue
  const fatigue = fatigueSignals(ad, baselines);
  if (fatigue) return fatigue;

  // 7. Watch
  const watch = watchRules(ad, t, archetype, baselines);
  if (watch) return watch;

  // 8. Continue/Scale
  return continueRules(ad, t, archetype, baselines);
}

function evaluateAdset(
  o: NormalizedObject,
  t: JudgeableTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines,
  nsThreshold: number
): Fired {
  // Spec 013 / T024 — exempt branch entered FIRST and ONLY for exempt
  // objects (FR-009b). Reaches before preSeparationGate and the circuit
  // breaker (C2.2). Non-exempt objects continue with the existing
  // pipeline byte-identically (FR-020, SC-010).
  const ns = evaluateNonSales(o, nsThreshold);
  if (ns) return ns;

  // T026 — pre-separation snapshot guard (see evaluateAd for the rationale).
  const preSep = preSeparationGate(o, archetype);
  if (preSep) return preSep;

  // 2. Circuit breaker FIRST — "يتجاوز كل البوابات"
  const cb = circuitBreaker(o, t.unitTarget);
  if (cb) return cb;

  // 1. Gates
  const gate = gateVerdict(o, t.unitTarget);
  if (gate) return gate;

  // 3. Kill rules
  const kill = killRulesAdset(o, t, archetype, baselines);
  if (kill) return kill;

  // 7. Watch
  const watch = watchRules(o, t, archetype, baselines);
  if (watch) return watch;

  // 8. Continue
  return continueRules(o, t, archetype, baselines);
}

// ============================================================
// Main entry
// ============================================================

export function runEngine(
  snapshot: AccountSnapshotPayload,
  funnel: FunnelInputs
): EngineResult {
  const baselines = snapshot.baselines;
  // Batch 2 / ISSUE-009 — convert the user-entered monetary inputs from
  // their inputCurrency to the account/snapshot currency before deriving
  // targets. funnel.inputCurrency is `string | null`; deriveTargets accepts
  // null/undefined as a safe no-op (so pre-migration rows behave identically
  // to the pre-feature code path).
  const targets = deriveTargets(funnel, baselines, funnel.inputCurrency, snapshot.currency);
  // Hotfix T2: bind the currency symbol for this run so every money() call
  // in this file (K1–K7, CB1/CB2, F1/F2, W1–W6, S1–S4, campaign reasons,
  // buildSummary) renders the account's currency, not a hardcoded "$".
  _currency = currencySymbolFor(snapshot.currency);
  // Spec 013 / T020 — compute the non-sales exemption threshold once per
  // run, beside the existing `deriveTargets` call. Direction is
  // USD → account currency; reversing these arguments produces the
  // ÷-instead-of-× bug (C5 — AED 10 ⇒ ≈2.72 instead of ≈36.70).
  // convertCurrency() is a safe no-op for null/undefined/unknown codes
  // so unknown account currencies fall back to the raw 10 USD figure.
  const nsThreshold = convertCurrency(10, "USD", snapshot.currency);

  // T015 + plan §Compile-time enforcement — every per-object evaluator below
  // takes a `JudgeableTargets` (with `unitTarget: number`). The narrow
  // happens here, ONCE. If `unitTarget === null` (no source available —
  // possible for `appointment` / `webinar` accounts with no baseline, no
  // rates, no benchmark) no rule below the gate can fire without
  // fabricating a target; every row returns `too_early GATE`.
  //
  // Phase 6 T058 will refine the no-target reason/action copy. For Phase 2
  // the message is intentionally a stub: the legacy archetypes
  // (`paid_lto`, `free_lead`) always produce a non-null `unitTarget`, so
  // this branch is only reachable for the new archetypes and any
  // future regression that breaks the legacy source selection.
  const NO_TARGET_FIRED: Fired = {
    verdict: "too_early",
    rule: "GATE",
    reason: "لم يتحدد هدف تكلفة العميل بعد — أكمل إعدادات الفانل أولًا",
    action: "افتح الإعدادات وأدخل أرقام الفانل أو سعر المنتج الغالي",
  };
  if (targets.unitTarget === null) {
    return buildNoTargetResult(snapshot, targets, NO_TARGET_FIRED, funnel.archetype);
  }
  const judgeable: JudgeableTargets = targets as JudgeableTargets;

  const byId = new Map(snapshot.objects.map(o => [o.id, o]));

  // Spec 013 / CodeRabbit round-2 — objective inheritance must be resolved
  // BEFORE the evaluation loops so child ad sets and ads read the
  // effective (inherited) objective during evaluation. The prior
  // implementation backfilled the EngineRow output AFTER evaluation,
  // which left children seeing `objective === null` for the duration of
  // `evaluateAd` / `evaluateAdset` — so an `OUTCOME_AWARENESS` campaign
  // would have its children incorrectly routed into the sales rulebook.
  //
  // Mutating `snapshot.objects` in place is safe here: meta.ts and the
  // buildSnapshot() / demo builders construct a fresh array on every
  // refresh and do not retain references past the engine call. The
  // mutation is reflected in both the EngineRow output (via `toRow`) and
  // the per-object evaluator (via `o.objective`).
  const campaignObjective = new Map<string, string | null>();
  for (const o of snapshot.objects) {
    if (o.level === "campaign") {
      campaignObjective.set(o.id, o.objective ?? null);
    }
  }
  for (const o of snapshot.objects) {
    if (o.level !== "campaign" && o.campaignId !== null) {
      if (o.objective === null || o.objective === undefined) {
        o.objective = campaignObjective.get(o.campaignId) ?? null;
      }
    }
  }

  const rows: EngineRow[] = [];

  const toRow = (o: NormalizedObject, fired: Fired, findings: Finding[]): EngineRow => {
    // T025 — the row's `cpa_3d` and `conversions_3d` carry the figure the
    // engine judged on (per FR-031, FR-035). For appointment / webinar
    // that is the lead-based number; the legacy `o.w3d.conversions` /
    // `o.w3d.cpa` are NOT the judgement unit for those archetypes.
    const rowConv = effectiveConversions(o, funnel.archetype);
    const rowCpa = effectiveCpa(o, funnel.archetype);
    return {
      id: o.id,
      name: o.name,
      status: o.status,
      level: o.level,
      parentId: o.parentId,
      campaignId: o.campaignId,
      daily_budget: o.dailyBudget,
      objective: o.objective ?? null,
      spend_3d: round2(o.w3d.spend),
      spend_today: round2(o.today.spend),
      impressions_3d: o.w3d.impressions,
      cpa_3d: rowCpa !== null ? round2(rowCpa) : null,
      ctr_link: round2(o.w3d.ctrLink),
      ctr_all: round2(o.w3d.ctrAll),
      // Pre-separation snapshots: `rowConv === undefined` for appointment /
      // webinar; render as `0` in the row but mark it conceptually as
      // "not yet measurable" via the verdict (the pre-separation gate
      // returns too_early for these rows).
      conversions_3d: rowConv ?? 0,
      frequency_3d: round2(o.w3d.frequency),
      spend_share_pct: o.spendSharePct !== null ? round2(o.spendSharePct) : null,
      age_days: Math.round(o.ageDays * 10) / 10,
      verdict: fired.verdict,
      rule: fired.rule,
      reason_ar: fired.reason,
      action_ar: fired.action,
      findings,
      promotion_eligible: !!fired.promotionEligible,
      promotion_note: fired.promotionNote ?? null,
      learning_phase: !!o.learningPhase || weeklyConversions(o, funnel.archetype) < 50,
      // Hotfix T9: 3-day ROAS = conversionValue / spend. null when either
      // is 0 — surfaces an explicit "—" in the column instead of 0.00x.
      roas_3d: o.w3d.spend > 0 && o.w3d.conversionValue > 0
        ? round2(o.w3d.conversionValue / o.w3d.spend)
        : null,
    };
  };

  // Evaluate ads first (needed for nothing), then adsets, then campaigns (need children)
  const ads = snapshot.objects.filter(o => o.level === "ad");
  const adsets = snapshot.objects.filter(o => o.level === "adset");
  const campaigns = snapshot.objects.filter(o => o.level === "campaign");

  for (const ad of ads) {
    const parent = ad.parentId ? byId.get(ad.parentId) : undefined;
    const fired = evaluateAd(ad, parent, judgeable, funnel.archetype, baselines, nsThreshold);
    // Spec 013 / T026 — hard skip at the call site, not a filter inside
    // diagnose() (FR-010a, C6.1). Exempt objects always carry
    // `findings: []` regardless of verdict; non-exempt objects follow
    // the existing verdict-based skip.
    const exempt = isNonSalesExempt(ad.objective ?? null);
    const findings =
      !exempt && (fired.verdict === "kill" || fired.verdict === "watch")
        ? diagnose(ad, baselines, funnel.archetype, fired, !!funnel.htoUnderperforming)
        : [];
    rows.push(toRow(ad, fired, findings));
  }

  for (const s of adsets) {
    const fired = evaluateAdset(s, judgeable, funnel.archetype, baselines, nsThreshold);
    const exempt = isNonSalesExempt(s.objective ?? null);
    const findings =
      !exempt && (fired.verdict === "kill" || fired.verdict === "watch")
        ? diagnose(s, baselines, funnel.archetype, fired, !!funnel.htoUnderperforming)
        : [];
    rows.push(toRow(s, fired, findings));
  }

  for (const c of campaigns) {
    const childRows = rows.filter(r => r.campaignId === c.id && r.level === "adset");
    // Spec 014 / T034 — `diagnose()` receives the account-level funnel
    // flag as its own argument (see the C4 guard). The previous
    // hand-built `Fired` that re-attached `ctaUrl` here was a no-op:
    // `evaluateCampaign` already sets `ctaUrl` on every W5 `Fired`, so
    // it carried no information the guard could read (self-review F2).
    const fired = evaluateCampaign(c, judgeable, childRows, !!funnel.htoUnderperforming, funnel.archetype, nsThreshold);
    let findings: Finding[] = [];
    const exempt = isNonSalesExempt(c.objective ?? null);
    if (!exempt && (fired.verdict === "kill" || fired.verdict === "watch")) {
      // Spec 014 / T035 / C4.5 — diagnose() now produces the single
      // correct FUNNEL_CONFIRMED line for a guarded W5. The old
      // post-hoc step-6 patch/append block is removed.
      findings = diagnose(c, baselines, funnel.archetype, fired, !!funnel.htoUnderperforming);
    }
    rows.push(toRow(c, fired, findings));
  }

  // Objective inheritance is now resolved at the top of runEngine — see
  // the early `campaignObjective` backfill block above. Each EngineRow
  // already carries the effective objective through `toRow`'s
  // `o.objective ?? null` read, so no per-row backfill is required here.
  // The shape of the output (`EngineRow.objective`) is unchanged.

  const summary = buildSummary(rows, snapshot, targets);
  return { rows, summary, targets, currencySymbol: _currency };
}

/**
 * No-target result builder (Phase 2 minimum; Phase 6 T058 refines the copy).
 *
 * When `deriveTargets` returns `unitTarget: null` no per-object rule can
 * fire without inventing a number. Every row is emitted as
 * `too_early GATE` with a simple-Arabic reason/action pointing at the
 * funnel settings. Summary counts reflect the verdict; baseline fields
 * are surfaced as-is (so the dashboard still renders the measured history
 * even when the target is absent — see FR-019a/b).
 */
function buildNoTargetResult(
  snapshot: AccountSnapshotPayload,
  targets: DerivedTargets,
  fired: Fired,
  archetype: FunnelInputs["archetype"]
): EngineResult {
  const toRow = (o: NormalizedObject): EngineRow => {
    // T025 / FR-031 — the row's `cpa_3d` and `conversions_3d` carry the
    // figure the engine judged on (per-archetype). Mirror the main
    // `toRow` so the no-target path produces the same per-row display
    // values the judged path does. `effectiveConversions` returns
    // `undefined` for appointment / webinar with a pre-separation
    // snapshot (T026) — the engine below the gate never sees those
    // rows, so this branch is unreachable for them.
    const rowConv = effectiveConversions(o, archetype);
    const rowCpa = effectiveCpa(o, archetype);
    return {
      id: o.id,
      name: o.name,
      status: o.status,
      level: o.level,
      parentId: o.parentId,
      campaignId: o.campaignId,
      daily_budget: o.dailyBudget,
      objective: o.objective ?? null,
      spend_3d: round2(o.w3d.spend),
      spend_today: round2(o.today.spend),
      impressions_3d: o.w3d.impressions,
      cpa_3d: rowCpa !== null ? round2(rowCpa) : null,
      ctr_link: round2(o.w3d.ctrLink),
      ctr_all: round2(o.w3d.ctrAll),
      conversions_3d: rowConv ?? 0,
      frequency_3d: round2(o.w3d.frequency),
      spend_share_pct: o.spendSharePct !== null ? round2(o.spendSharePct) : null,
      age_days: Math.round(o.ageDays * 10) / 10,
      verdict: fired.verdict,
      rule: fired.rule,
      reason_ar: fired.reason,
      action_ar: fired.action,
      findings: [],
      promotion_eligible: false,
      promotion_note: null,
      learning_phase: !!o.learningPhase || weeklyConversions(o, archetype) < 50,
      roas_3d:
        o.w3d.spend > 0 && o.w3d.conversionValue > 0
          ? round2(o.w3d.conversionValue / o.w3d.spend)
          : null,
    };
  };
  const rows = snapshot.objects.map(toRow);
  const summary = buildSummary(rows, snapshot, targets);
  return { rows, summary, targets, currencySymbol: _currency };
}

function computeCadence(snapshot: AccountSnapshotPayload): AccountSummary["cadence"] {
  // Find the most recent createdTime across every ad. We treat any
  // createdTime string as comparable; missing/null values are ignored.
  let mostRecent: number | null = null;
  for (const obj of snapshot.objects) {
    if (obj.level !== "ad") continue;
    if (!obj.createdTime) continue;
    const t = Date.parse(obj.createdTime);
    if (Number.isNaN(t)) continue;
    if (mostRecent === null || t > mostRecent) mostRecent = t;
  }
  if (mostRecent === null) {
    return {
      state: "unknown",
      daysSinceLast: null,
      message_ar: "تاريخ آخر إعلان غير معروف — تأكد من تواريخ الإنشاء.",
    };
  }
  const daysSinceLast = Math.max(
    0,
    Math.floor((Date.now() - mostRecent) / (1000 * 60 * 60 * 24))
  );
  if (daysSinceLast > 14) {
    return {
      state: "stall",
      daysSinceLast,
      message_ar: `المصنع متوقف — آخر إعلان قبل ${daysSinceLast} يومًا. الحد الأدنى 5 إلى 10 مفاهيم كل أسبوعين، وإلا اختل استقرار الحساب.`,
    };
  }
  if (daysSinceLast > 7) {
    return {
      state: "reminder",
      daysSinceLast,
      message_ar: `مرّ ${daysSinceLast} يومًا دون إعلان جديد — ابدأ بتجهيز المفاهيم القادمة.`,
    };
  }
  return null; // ok
}

function weeklyConversions(
  o: NormalizedObject,
  archetype: FunnelInputs["archetype"]
): number {
  // T025 — the weekly total follows the archetype-aware selector.
  // appointment / webinar read `leadConversions`; legacy archetypes read
  // `conversions`. The per-day entries are normalised the same way
  // (`d.conversions` for legacy, `d.leadConversions` for the new ones).
  if (o.daily7.length === 0) {
    return (effectiveConversions(o, archetype) ?? 0) * 2.33;
  }
  return o.daily7.reduce(
    (s, d) => s + (effectiveDailyConversions(d, archetype) ?? 0),
    0
  );
}

/**
 * Mirror of `effectiveConversions` for `DailyMetrics`. The per-day
 * `d.conversions` already follows the legacy ordering (CONVERSION_ACTION_TYPES
 * for legacy archetypes; would need a separate field for the new ones).
 * For Phase 2 the daily breakdown is derived from the same Meta response,
 * so `d.leadConversions` is the lead-based counterpart.
 */
function effectiveDailyConversions(
  d: { conversions: number; leadConversions?: number },
  archetype: FunnelInputs["archetype"]
): number | undefined {
  if (archetype === "appointment" || archetype === "webinar") {
    return d.leadConversions;
  }
  return d.conversions;
}

/**
 * Mirror of `effectiveCpa` for `DailyMetrics` (T025 / FR-031). The per-day
 * gating rules (W2 "one bad day", S1's `threeDaysUnder`) compare a daily
 * cost against the lead-based `target`. For appointment / webinar the
 * legacy `d.cpa` is a cost-per-PURCHASE, so those sites must synthesize a
 * cost-per-LEAD from `d.leadConversions` — otherwise a purchase CPA is
 * judged against a CPL target (the exact unit mismatch `effectiveCpa`
 * removed at the 3-day level). Legacy archetypes keep `d.cpa` unchanged,
 * so their behaviour is byte-identical.
 *
 * Returns `null` when there is no usable count (pre-separation snapshot,
 * captured zero, or no spend) — the same "no cpa" signal the callers
 * already branch on.
 */
function effectiveDailyCpa(
  d: { spend: number; cpa: number | null; leadConversions?: number },
  archetype: FunnelInputs["archetype"]
): number | null {
  if (archetype === "appointment" || archetype === "webinar") {
    const conv = d.leadConversions;
    if (conv === undefined || conv === 0 || d.spend <= 0) return null;
    return d.spend / conv;
  }
  return d.cpa;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// Account summary + top-3 actions
// ============================================================

function buildSummary(
  rows: EngineRow[],
  snapshot: AccountSnapshotPayload,
  targets: DerivedTargets
): AccountSummary {
  // Spec 013 / US1 — the three live-state elements (counts, bleed,
  // top_3_actions) describe only the LIVE account. `EngineRow` has no
  // `effectiveStatus`; `NormalizedObject` does. Build the snapshot-object
  // map once and resolve status with the same three-step fallback the
  // DecisionTable applies (research R7, contracts/summary-strip.md §S1):
  //   effectiveStatus ?? snapshotObject.status ?? row.status
  const snapObjById = new Map<string, NormalizedObject>();
  for (const o of snapshot.objects) snapObjById.set(o.id, o);
  const isActive = (row: EngineRow): boolean => {
    const o = snapObjById.get(row.id);
    const status = o?.effectiveStatus ?? o?.status ?? row.status;
    return status === "ACTIVE";
  };

  const counts: Record<Verdict, number> = {
    kill: 0, watch: 0, continue: 0, rescue: 0, too_early: 0,
  };
  for (const r of rows) {
    if (!isActive(r)) continue; // FR-001 — active rows only
    counts[r.verdict]++;
  }

  // Spend totals from campaign level (avoid double counting).
  // FR-005b — historical, not live-state; remain computed over ALL rows.
  const campaignRows = rows.filter(r => r.level === "campaign");
  const total_spend_3d = round2(campaignRows.reduce((s, r) => s + r.spend_3d, 0));
  const total_spend_today = round2(campaignRows.reduce((s, r) => s + r.spend_today, 0));

  // Bleed: daily budgets of kill-verdict units (adset/campaign level only to
  // avoid double counting; ads inherit parent budgets).
  // Spec 013 / T008 — filter BEFORE populating killAdsetIds so a paused
  // kill ad set does not erroneously suppress its active kill child's
  // bleed (which would enter via the "ad" loop and be skipped as a
  // parent-already-counted duplicate).
  let bleed = 0;
  const killAdsetIds = new Set<string>();
  for (const r of rows) {
    if (r.verdict !== "kill") continue;
    if (!isActive(r)) continue; // FR-005 — paused kill rows contribute nothing
    if (r.level === "adset") {
      bleed += r.daily_budget ?? r.spend_3d / 3;
      killAdsetIds.add(r.id);
    }
  }
  for (const r of rows) {
    if (r.verdict !== "kill" || r.level !== "ad") continue;
    if (!isActive(r)) continue; // FR-005
    if (r.parentId && killAdsetIds.has(r.parentId)) continue; // parent already counted
    // estimate ad's share of parent budget by its today spend
    bleed += r.spend_today > 0 ? r.spend_today : r.spend_3d / 3;
  }
  // campaign-level kills (CBO) where no adset already counted
  for (const r of rows) {
    if (r.verdict !== "kill" || r.level !== "campaign") continue;
    if (!isActive(r)) continue; // FR-005
    const childCounted = rows.some(
      x => x.level === "adset" && x.campaignId === r.id && killAdsetIds.has(x.id)
    );
    if (!childCounted) bleed += r.daily_budget ?? r.spend_3d / 3;
  }

  // Top-3: kills with biggest bleed first, then rescues, then scales (S1).
  // Spec 013 / T009 — paused objects never enter the recommended-actions
  // list (SC-002b); no element can recommend "stop this ad" for an ad
  // that is already paused.
  const actions: TopAction[] = [];
  const killRows = rows
    .filter(r => r.verdict === "kill" && isActive(r))
    .sort((a, b) => (b.daily_budget ?? b.spend_3d / 3) - (a.daily_budget ?? a.spend_3d / 3));
  for (const r of killRows) {
    const impact = r.daily_budget ?? round2(r.spend_3d / 3);
    actions.push({
      key: `${r.id}:${r.rule}`,
      rank: 0,
      objectId: r.id,
      objectName: r.name,
      level: r.level,
      parentId: r.parentId,
      campaignId: r.campaignId,
      rule: r.rule,
      verdict: "kill",
      action_ar: r.action_ar,
      impact_ar: `يوفّر لك حوالي ${money(impact)} كل يوم`,
      impactValue: impact,
    });
  }
  const rescueRows = rows.filter(r => r.verdict === "rescue" && isActive(r));
  for (const r of rescueRows) {
    actions.push({
      key: `${r.id}:${r.rule}`,
      rank: 0,
      objectId: r.id,
      objectName: r.name,
      level: r.level,
      parentId: r.parentId,
      campaignId: r.campaignId,
      rule: r.rule,
      verdict: "rescue",
      action_ar: r.action_ar,
      impact_ar: `إعلان ممتاز (ضغط ${r.ctr_link}%) لا يأخذ فرصته في المصروف`,
      impactValue: r.ctr_link,
    });
  }
  // Scale-ready rows are inherently produced by the sales rulebook and
  // only ever fire for non-exempt objects (FR-010c). The isActive filter
  // mirrors the kill / rescue filters so the three live-state elements
  // never disagree about what counts as live.
  const scaleRows = rows.filter(r => r.promotion_eligible && isActive(r));
  for (const r of scaleRows) {
    actions.push({
      key: `${r.id}:${r.rule}`,
      rank: 0,
      objectId: r.id,
      objectName: r.name,
      level: r.level,
      parentId: r.parentId,
      campaignId: r.campaignId,
      rule: r.rule,
      verdict: r.verdict,
      action_ar: r.action_ar,
      impact_ar: `إعلان ناجح مُثبَت جاهز للتوسيع`,
      impactValue: r.spend_3d,
    });
  }
  const top3 = actions.slice(0, 3).map((a, i) => ({ ...a, rank: i + 1 }));

  // Spec 014 / contract §C6.1, §C6.1a — account-level funnel card.
  // Set when any row carries a `RUNG_CONVERSION` or `FUNNEL_CONFIRMED`
  // finding AND is not excluded by the ad-blame predicate (the row's
  // fired rule is ad-fault, or any of its rung-1..4 findings is an
  // ad-side finding).
  const qualifyingOutcome = (outcome: DiagnosisOutcome): boolean =>
    outcome === "RUNG_CONVERSION" || outcome === "FUNNEL_CONFIRMED";
  const adBlameExcluded = (row: EngineRow): boolean => {
    if (RULE_FAULT[row.rule] === "ad-fault") return true;
    return row.findings.some(f =>
      f.outcome === "RUNG_CPM" ||
      f.outcome === "RUNG_HOOK" ||
      f.outcome === "RUNG_MISMATCH" ||
      f.outcome === "RUNG_ARRIVAL"
    );
  };
  const accountRowQualifies = rows.some(
    r => !adBlameExcluded(r) && r.findings.some(f => qualifyingOutcome(f.outcome))
  );
  const account_funnel_cta = accountRowQualifies
    ? {
        // Spec 014 / C6.4 — card copy carries no ad-health claim
        // (operationally, none of `AD_HEALTH_CLAIMS`). States the
        // measured funnel leak and routes to the call.
        reason_ar:
          "التحويل على الصفحة أو بعد البيع ضعيف — احجز مكالمة تشخيصية مجانية مع الفريق لمراجعة العرض أو مسار الفانل",
        ctaUrl: DISCOVERY_CALL_URL,
      }
    : null;

  return {
    total_spend_3d,
    total_spend_today,
    bleed_daily: round2(bleed),
    counts,
    baselines: snapshot.baselines,
    top_3_actions: top3,
    attributionStraddle: snapshot.attributionStraddle,
    fetchedAt: snapshot.fetchedAt,
    currency: snapshot.currency,
    account_funnel_cta,
    account_alert:
      snapshot.baselines.cpmNow !== null &&
      snapshot.baselines.cpmAvg14 !== null &&
      snapshot.baselines.cpmAvg14 > 0 &&
      snapshot.baselines.cpmNow > 1.3 * snapshot.baselines.cpmAvg14
        ? {
            cpmNow: snapshot.baselines.cpmNow,
            cpmAvg14: snapshot.baselines.cpmAvg14,
            deltaPct: Math.round(
              (snapshot.baselines.cpmNow / snapshot.baselines.cpmAvg14 - 1) * 100
            ),
          }
        : null,
    // US9 / T056 — creative-factory cadence. Find the most recent
    // createdTime across every ad in the snapshot. If none, state is
    // "unknown". Otherwise bucket by days since last new ad: stall
    // (>14), reminder (>7), ok (≤7 → null).
    cadence: computeCadence(snapshot),
  };
}
