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
  DerivedTargets,
  EngineResult,
  EngineRow,
  Finding,
  FunnelInputs,
  NormalizedObject,
  RuleCode,
  TopAction,
  Verdict,
  median,
  deriveTargets,
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
  const { ctrLink, lpViews, conversions } = o.w3d;
  const ctrMedian = baselines.ctrLinkMedian90;
  if (ctrMedian === null || ctrLink <= ctrMedian || lpViews < 100) return false;
  const cvr = (conversions / lpViews) * 100;
  return archetype === "free_lead" ? cvr < 15 : cvr < 2;
}

function killRulesAdset(
  o: NormalizedObject,
  t: DerivedTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): Fired | null {
  const target = t.unitTarget;
  const { spend, conversions, cpa } = o.w3d;
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
  const cvr = (w.conversions / w.lpViews) * 100;
  return archetype === "free_lead" ? cvr < 15 : cvr < 2;
}

function starvedAdMatrix(
  ad: NormalizedObject,
  parent: NormalizedObject | undefined,
  t: DerivedTargets,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"]
): Fired | null {
  // Trigger: < 10% of ad-set spend for 3 days, age > 48h
  if (ad.spendSharePct === null || ad.spendSharePct >= 10 || ad.ageDays <= 2) return null;

  const ctrMedian = baselines.ctrLinkMedian90 ?? 1.0;
  const highEfficiency =
    ad.w3d.ctrLink > ctrMedian ||
    (ad.w3d.cpa !== null && ad.w3d.cpa <= t.unitTarget);

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
    parent.w3d.cpa !== null &&
    parent.w3d.cpa <= t.unitTarget;

  if (parentWinning) {
    // ad set hitting target + normal/weak ad → leave it
    return {
      verdict: "continue",
      rule: "K5",
      reason: `تمنحه ميتا ${ad.spendSharePct.toFixed(1)}% فقط من ميزانية المجموعة، لكن المجموعة كلها تحقق هدفك`,
      action: "اتركه كما هو — لا تلمس شيئًا في مجموعة ناجحة",
    };
  }

  const weak = ad.w3d.ctrLink < ctrMedian && ad.w3d.conversions === 0;
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
  t: DerivedTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): Fired | null {
  const target = t.unitTarget;
  const { cpa, ctrLink, linkClicks, lpViews, conversions } = o.w3d;
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
      const lastBad =
        lastDay.conversions === 0 ||
        (lastDay.cpa !== null && lastDay.cpa > 1.5 * target);
      const priorGood =
        prior.length >= 2 &&
        prior.every(d => d.cpa !== null && d.cpa <= target);
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
  if (cpa !== null && cpa > target && conversions > 0) {
    const fullRoas = (conversions * t.fullBuyerValue) / o.w3d.spend;
    if (fullRoas >= 2.0) {
      return {
        verdict: "continue",
        rule: "W6",
        reason: `في آخر 3 أيام: تكلفة العميل ${money(cpa)} أعلى من هدفك، لكن عند حساب كل ما سيشتريه العميل لاحقًا (${money(t.fullBuyerValue)}) فأنت رابح (العائد الكلي على الإنفاق ${fullRoas.toFixed(1)}x)`,
        action: "واصل بحذر — وإن استمر هذا النمط ففكّر في رفع هدفك قليلًا",
      };
    }
  }

  return null;
}

// ============================================================
// Continue / Scale S1–S4 (5.4)
// ============================================================

function continueRules(
  o: NormalizedObject,
  t: DerivedTargets,
  baselines: Baselines
): Fired {
  const target = t.unitTarget;
  const { cpa, ctrLink, conversions } = o.w3d;
  const ctrMedian = baselines.ctrLinkMedian90;
  // Learning phase (الجزء الرابع): ad set لم يصل ~50 تحويلًا أسبوعيًا = حساس.
  // تجنب التعديلات الهيكلية أثناءه (القتل بالقواعد مسموح — يسبق هذه الدالة).
  const inLearning = !!o.learningPhase || weeklyConversions(o) < 50;

  const cpaAtOrUnder = cpa !== null && cpa <= target;
  const beatsMedian = ctrMedian === null ? ctrLink >= 1.7 : ctrLink > ctrMedian;

  // Check 3 consecutive rolling days at/under target (S1 strict condition)
  let threeDaysUnder = false;
  const days = o.daily7.filter(d => d.spend > 0);
  if (days.length >= 3) {
    const last3 = days.slice(-3);
    threeDaysUnder = last3.every(d => d.cpa !== null && d.cpa <= target * 1.0);
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

const DISCOVERY_CALL_URL = "https://eslamsalah.com/team-discovery-call";

export function diagnose(
  o: NormalizedObject,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"]
): Finding[] {
  const w = o.w3d;
  const ctrMedian = baselines.ctrLinkMedian90;
  const findings: Finding[] = [];

  // 1. Per-ad CPM (account-wide CPM removed — handled at summary level)
  if (baselines.cpmAvg14 && w.cpm > 1.3 * baselines.cpmAvg14 && w.impressions > 500) {
    findings.push({
      step: 1,
      text_ar: `الخطوة 1 — سعر الظهور مرتفع على هذا الإعلان تحديدًا (${money(w.cpm)} مقابل متوسط ${money(baselines.cpmAvg14)}) — فيسبوك يرفع سعر التصميم الذي لا يعجب الناس`,
      primary: false,
    });
  }

  // 2. Link CTR (hook) + 3. CTR All vs Link CTR mismatch
  const ctrLow = ctrMedian !== null ? w.ctrLink < ctrMedian : w.ctrLink < 1.0;
  if (ctrLow && w.impressions >= 1000) {
    // 3. CTR All vs Link CTR mismatch
    if (w.ctrAll >= 2 * w.ctrLink && w.ctrAll > 1.5) {
      findings.push({
        step: 3,
        text_ar: `الخطوة 3 — الناس تتفاعل مع الإعلان (${w.ctrAll.toFixed(2)}%) لكنها لا تضغط للشراء (${w.ctrLink.toFixed(2)}%) — بداية الإعلان جيدة لكن الرسالة أو دعوة الشراء ضعيفة`,
        primary: false,
      });
    } else {
      findings.push({
        step: 2,
        text_ar: `الخطوة 2 — ضغط الناس على الإعلان قليل (${w.ctrLink.toFixed(2)}%) رغم أن سعر الظهور طبيعي — المشكلة في التصميم نفسه، جدّده`,
        primary: false,
      });
    }
  }

  // 4. LP view rate
  if (w.linkClicks >= 50 && w.lpViews > 0 && w.lpViews / w.linkClicks < 0.75) {
    findings.push({
      step: 4,
      text_ar: `الخطوة 4 — ${((w.lpViews / w.linkClicks) * 100).toFixed(0)}% فقط ممن ضغطوا وصلوا لصفحتك (المفترض 75%+) — افحص سرعة التحميل أولًا، ثم تأكد أن الصفحة تطابق وعد الإعلان`,
      primary: false,
    });
  }

  // 5. page CVR — "ad innocent"
  if (w.lpViews >= 100) {
    const cvr = (w.conversions / w.lpViews) * 100;
    const weakPage = archetype === "free_lead" ? cvr < 15 : cvr < 2;
    if (weakPage) {
      // Only absolve the ad ("الإعلان بريء") when no earlier rung (1–4) fired.
      // If the ad/landing flow is already flagged above, step 5 must not
      // contradict it by declaring the ad innocent.
      const adClean = findings.length === 0;
      findings.push({
        step: 5,
        text_ar: adClean
          ? `الخطوة 5 — الناس تصل لصفحتك لكن ${cvr.toFixed(1)}% فقط يشترون — المشكلة في الصفحة أو العرض أو السعر — ⚠️ الإعلان بريء، لا تعدّله`
          : `الخطوة 5 — قلة ممن يصلون لصفحتك يشترون (${cvr.toFixed(1)}%) — راجع الصفحة أو العرض أو السعر أيضًا`,
        primary: false,
        ctaUrl: DISCOVERY_CALL_URL,
      });
    }
  }

  // 6. post-conversion (fallback — ad and page look fine). Hotfix T8: now
  // carries the discovery-call CTA so a clean ad + bad funnel still points
  // the user to the right next step (matching the step-5 "page is broken"
  // booking CTA logic, but for the "everything looks clean" case).
  if (findings.length === 0) {
    findings.push({
      step: 6,
      text_ar: "الخطوة 6 — المشكلة ليست بالإعلانات حالياً. المشكلة في العرض أو المسار التسويقي — احجز مكالمة تشخيصية مجانية.",
      primary: false,
      ctaUrl: DISCOVERY_CALL_URL,
    });
  }

  // Mark the first finding as primary
  if (findings.length > 0) {
    findings[0].primary = true;
  }

  return findings;
}

// ============================================================
// Campaign-level evaluation (5.0: judged by العائد الكلي على الإنفاق)
// ============================================================

function evaluateCampaign(
  o: NormalizedObject,
  t: DerivedTargets,
  childRows: EngineRow[],
  htoUnderperforming: boolean
): Fired {
  const { spend, conversions } = o.w3d;
  if (spend < t.unitTarget) {
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: "في آخر 3 أيام: صرف الحملة أقل من تكلفة عميل واحد — لا يمكن الحكم عليها بعد",
      action: "اترك البيانات تتجمع",
    };
  }
  const fullRoas = spend > 0 ? (conversions * t.fullBuyerValue) / spend : 0;
  const killChildren = childRows.filter(r => r.verdict === "kill").length;

  // W5 — funnel-level signal (user-reported): LTO ليدات/مبيعات جيدة لكن
  // لا حضور/مبيعات HTO. Meta's API can't see post-conversion data, so this
  // is driven by the explicit funnel-settings flag. الإعلان بريء — حُكم فانل.
  if (htoUnderperforming && conversions > 0 && o.w3d.cpa !== null && o.w3d.cpa <= 1.5 * t.unitTarget) {
    return {
      verdict: "watch",
      rule: "W5",
      reason: `في آخر 3 أيام: الإعلانات تجلب عملاء بسعر جيد (${money(o.w3d.cpa)}) لكن المشكلة في العرض أو مسار الفانل — الإعلان بريء`,
      action: "لا تغيّر شيئًا في الإعلانات — راجع العرض ومسار التحويل بعد البيع الأول، واحجز مكالمة تشخيصية",
      ctaUrl: DISCOVERY_CALL_URL,
    };
  }

  if (fullRoas >= 2.0) {
    return {
      verdict: "continue",
      rule: "S2",
      reason: `في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع ${fullRoas.toFixed(1)}x عند حساب قيمة العميل الكاملة (${money(t.fullBuyerValue)})${killChildren ? ` — مع ${killChildren} إعلان/مجموعة تحتاج إيقافًا بالداخل` : ""}`,
      action: killChildren
        ? "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك"
        : "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة",
    };
  }
  if (fullRoas >= 1.0) {
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
  t: DerivedTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): Fired {
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
  return continueRules(ad, t, baselines);
}

function evaluateAdset(
  o: NormalizedObject,
  t: DerivedTargets,
  archetype: FunnelInputs["archetype"],
  baselines: Baselines
): Fired {
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
  return continueRules(o, t, baselines);
}

// ============================================================
// Main entry
// ============================================================

export function runEngine(
  snapshot: AccountSnapshotPayload,
  funnel: FunnelInputs
): EngineResult {
  const baselines = snapshot.baselines;
  const targets = deriveTargets(funnel, baselines);
  // Hotfix T2: bind the currency symbol for this run so every money() call
  // in this file (K1–K7, CB1/CB2, F1/F2, W1–W6, S1–S4, campaign reasons,
  // buildSummary) renders the account's currency, not a hardcoded "$".
  _currency = currencySymbolFor(snapshot.currency);

  const byId = new Map(snapshot.objects.map(o => [o.id, o]));
  const rows: EngineRow[] = [];

  const toRow = (o: NormalizedObject, fired: Fired, findings: Finding[]): EngineRow => ({
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
    cpa_3d: o.w3d.cpa !== null ? round2(o.w3d.cpa) : null,
    ctr_link: round2(o.w3d.ctrLink),
    ctr_all: round2(o.w3d.ctrAll),
    conversions_3d: o.w3d.conversions,
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
    learning_phase: !!o.learningPhase || weeklyConversions(o) < 50,
    // Hotfix T9: 3-day ROAS = conversionValue / spend. null when either
    // is 0 — surfaces an explicit "—" in the column instead of 0.00x.
    roas_3d: o.w3d.spend > 0 && o.w3d.conversionValue > 0
      ? round2(o.w3d.conversionValue / o.w3d.spend)
      : null,
  });

  // Evaluate ads first (needed for nothing), then adsets, then campaigns (need children)
  const ads = snapshot.objects.filter(o => o.level === "ad");
  const adsets = snapshot.objects.filter(o => o.level === "adset");
  const campaigns = snapshot.objects.filter(o => o.level === "campaign");

  for (const ad of ads) {
    const parent = ad.parentId ? byId.get(ad.parentId) : undefined;
    const fired = evaluateAd(ad, parent, targets, funnel.archetype, baselines);
    const findings =
      fired.verdict === "kill" || fired.verdict === "watch"
        ? diagnose(ad, baselines, funnel.archetype)
        : [];
    rows.push(toRow(ad, fired, findings));
  }

  for (const s of adsets) {
    const fired = evaluateAdset(s, targets, funnel.archetype, baselines);
    const findings =
      fired.verdict === "kill" || fired.verdict === "watch"
        ? diagnose(s, baselines, funnel.archetype)
        : [];
    rows.push(toRow(s, fired, findings));
  }

  for (const c of campaigns) {
    const childRows = rows.filter(r => r.campaignId === c.id && r.level === "adset");
    const fired = evaluateCampaign(c, targets, childRows, !!funnel.htoUnderperforming);
    let findings: Finding[] = [];
    if (fired.verdict === "kill" || fired.verdict === "watch") {
      findings = diagnose(c, baselines, funnel.archetype);
      // W5 campaign: ensure the discovery-call ctaUrl is present. If diagnose()
      // already produced a step-6 fallback, attach the CTA to it instead of
      // appending a second step-6 (which would render a duplicate post-sale
      // message in the diagnosis list).
      if (fired.ctaUrl && !findings.some(f => f.ctaUrl === fired.ctaUrl)) {
        const existingStep6 = findings.find(f => f.step === 6);
        if (existingStep6) {
          existingStep6.ctaUrl = fired.ctaUrl;
        } else {
          findings.push({
            step: 6,
            text_ar: "المشكلة في العرض أو مسار الفانل — الإعلانات تجلب عملاء بسعر جيد لكن التحويل بعد البيع يحتاج إصلاح",
            primary: false,
            ctaUrl: fired.ctaUrl,
          });
        }
      }
    }
    rows.push(toRow(c, fired, findings));
  }

  // Objective inheritance: objective exists only at campaign level in Meta.
  // Backfill ad-set/ad rows from a Map<campaignId, objective> so children
  // inherit their campaign's objective when their own is null.
  const campaignObjective = new Map<string, string | null>();
  for (const r of rows) {
    if (r.level === "campaign") {
      campaignObjective.set(r.id, r.objective);
    }
  }
  for (const r of rows) {
    if (r.objective === null && r.campaignId !== null) {
      r.objective = campaignObjective.get(r.campaignId) ?? null;
    }
  }

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

function weeklyConversions(o: NormalizedObject): number {
  if (o.daily7.length === 0) return o.w3d.conversions * 2.33;
  return o.daily7.reduce((s, d) => s + d.conversions, 0);
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
  const counts: Record<Verdict, number> = {
    kill: 0, watch: 0, continue: 0, rescue: 0, too_early: 0,
  };
  for (const r of rows) counts[r.verdict]++;

  // Spend totals from campaign level (avoid double counting)
  const campaignRows = rows.filter(r => r.level === "campaign");
  const total_spend_3d = round2(campaignRows.reduce((s, r) => s + r.spend_3d, 0));
  const total_spend_today = round2(campaignRows.reduce((s, r) => s + r.spend_today, 0));

  // Bleed: daily budgets of kill-verdict units (adset/campaign level only to
  // avoid double counting; ads inherit parent budgets)
  let bleed = 0;
  const killAdsetIds = new Set<string>();
  for (const r of rows) {
    if (r.verdict !== "kill") continue;
    if (r.level === "adset") {
      bleed += r.daily_budget ?? r.spend_3d / 3;
      killAdsetIds.add(r.id);
    }
  }
  for (const r of rows) {
    if (r.verdict !== "kill" || r.level !== "ad") continue;
    if (r.parentId && killAdsetIds.has(r.parentId)) continue; // parent already counted
    // estimate ad's share of parent budget by its today spend
    bleed += r.spend_today > 0 ? r.spend_today : r.spend_3d / 3;
  }
  // campaign-level kills (CBO) where no adset already counted
  for (const r of rows) {
    if (r.verdict !== "kill" || r.level !== "campaign") continue;
    const childCounted = rows.some(
      x => x.level === "adset" && x.campaignId === r.id && killAdsetIds.has(x.id)
    );
    if (!childCounted) bleed += r.daily_budget ?? r.spend_3d / 3;
  }

  // Top-3: kills with biggest bleed first, then rescues, then scales (S1)
  const actions: TopAction[] = [];
  const killRows = rows
    .filter(r => r.verdict === "kill")
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
  const rescueRows = rows.filter(r => r.verdict === "rescue");
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
  const scaleRows = rows.filter(r => r.promotion_eligible);
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

  // Account-level funnel CTA: only count a step-5 finding as funnel evidence
  // when the row has NO earlier 1–4 finding (otherwise the "ads are good"
  // headline contradicts the per-row verdict). Campaign W5 still counts.
  const hasFunnelFinding = rows.some(r => {
    const step5 = r.findings.find(f => f.step === 5);
    if (!step5) return false;
    const hasEarlierIssue = r.findings.some(f => f.step >= 1 && f.step <= 4);
    return !hasEarlierIssue;
  });
  const hasW5 = rows.some(r => r.rule === "W5");
  const account_funnel_cta =
    hasFunnelFinding || hasW5
      ? {
          reason_ar:
            "مؤشرات إعلاناتك جيدة لكن مشكلتك الأساسية في التحويل بسبب العرض أو مسار الفانل — احجز مكالمة تشخيصية مجانية مع الفريق",
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
