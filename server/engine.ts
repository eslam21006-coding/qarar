/**
 * engine.ts — محرك القرار الإعلاني
 * Pure, deterministic implementation of the rulebook
 * (محرك-القرار-الإعلاني-v2.1.md). No AI/LLM — fixed math only.
 *
 * Evaluation order per object (STOP at first firing verdict):
 *   1. Data gates → ⏳
 *   2. Daily circuit breaker (CB1/CB2)
 *   3. Kill rules K1–K7
 *   4. Starved-ad matrix (K5)
 *   5. 72-hour decay map (K4 / real / strong)
 *   6. Fatigue signals (F1/F2)
 *   7. Watch W1–W6
 *   8. Continue/Scale S1–S4
 */
import {
  AccountSnapshotPayload,
  AccountSummary,
  Baselines,
  DerivedTargets,
  EngineResult,
  EngineRow,
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

const money = (n: number) => `$${nf(n, n < 10 ? 2 : 0)}`;

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
  // Minimum age gate: < 48h → no judgment at all (quick matrix: عمره < 48 ساعة → لا شيء)
  if (o.ageDays < 2 && !explicitCtrKillAllowed(o)) {
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: `عمره ${o.ageDays < 1 ? "أقل من يوم" : "يوم واحد"} — بوابات البيانات لم تكتمل`,
      action: "لا شيء — استنى 48 ساعة على الأقل قبل أي حكم",
    };
  }
  const ctrOk = ctrGateMet(o, target);
  const cpaOk = cpaGateMet(o, target);
  if (!ctrOk && !cpaOk && !explicitCtrKillAllowed(o)) {
    const needImp = Math.max(0, 2000 - o.w3d.impressions);
    return {
      verdict: "too_early",
      rule: "GATE",
      reason: `لسه بدري — محتاج ${nf(needImp)} impressions إضافية أو صرف ${money(target)}`,
      action: "سيب البيانات تكتمل — لا قرار قبل البوابة",
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
      reason: `صرف النهاردة ${money(o.today.spend)} ≥ 2.5 × الهدف (${money(target)}) بصفر تحويلات`,
      action: "إيقاف فوري — قاطع الدائرة؛ أعد التقييم يدويًا قبل أي تشغيل",
    };
  }
  if (o.today.spend >= 1.5 * target) {
    return {
      verdict: "watch",
      rule: "CB1",
      reason: `صرف النهاردة ${money(o.today.spend)} ≥ 1.5 × الهدف بصفر تحويلات`,
      action: "مراجعة إجبارية بكرة الصبح قبل تجديد الصرف",
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
      reason: `صرف ${money(spend)} ≥ 2 × الهدف (${money(target)}) بصفر تحويلات — لا يحوّل أصلًا`,
      action: "اقفل الـ ad set",
    };
  }

  // K2: spend ≥ 3×target AND actual CPA > 1.5×target over 2–3 day rolling
  // (suppressed when W3 applies — the ad is innocent, the page is broken)
  if (!innocent && spend >= 3 * target && cpa !== null && cpa > 1.5 * target) {
    return {
      verdict: "kill",
      rule: "K2",
      reason: `صرف ${money(spend)} ≥ 3 × الهدف والـ CPA الفعلي ${money(cpa)} > 1.5 × الهدف — نزيف مستمر لا تذبذب`,
      action: "اقفل الـ ad set",
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
        reason: `CPL ${money(cpa)} لامس السقف الاقتصادي (${money(t.cplCeiling)}) — الفانل يخسر بنيويًا`,
        action: "اقفل + راجع اقتصاد الفانل نفسه (مش الإعلانات)",
      };
    }
    // K6: CPL > 2× rolling baseline with gates met
    if (cpa > 2 * baseline && killCpaGateMet(o, target)) {
      return {
        verdict: "kill",
        rule: "K6",
        reason: `CPL ${money(cpa)} > 2 × خط الأساس (${money(baseline)}) مع اكتمال البوابات`,
        action: "اقفل الـ ad set",
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
      reason: `Link CTR ${o.w3d.ctrLink.toFixed(2)}% < 0.5% بعد ${nf(o.w3d.impressions)} impressions — الهوك ميت`,
      action: "اقفل الإعلان واستبدل الكريتف — المصنع يجهّز البديل",
    };
  }
  return null;
}

// ============================================================
// Starved-ad matrix — K5 (5.0)
// ============================================================

function starvedAdMatrix(
  ad: NormalizedObject,
  parent: NormalizedObject | undefined,
  t: DerivedTargets,
  baselines: Baselines
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
      reason: `محروم (${ad.spendSharePct.toFixed(1)}% من صرف الـ ad set) لكن كفاءته عالية على عينته — رابح مخنوق من منافسة إخوته`,
      action: "انسخه بالـ Post ID لـ ad set جديد وأعطه فرصة صرف عادلة، ثم أطفئ الأصل بعد استقرار النسخة",
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
      reason: `محروم (${ad.spendSharePct.toFixed(1)}% من الصرف) لكن الـ ad set ضارب الهدف — بياخد فتات`,
      action: "اتركه — لا تلمس شيئًا؛ إطفاؤه عبث في وحدة تعمل",
    };
  }

  const weak = ad.w3d.ctrLink < ctrMedian && ad.w3d.conversions === 0;
  if (weak) {
    return {
      verdict: "kill",
      rule: "K5",
      reason: `محروم (${ad.spendSharePct.toFixed(1)}%) وكفاءته ضعيفة (CTR ${ad.w3d.ctrLink.toFixed(2)}% تحت ميديان الحساب، صفر تحويلات) في ad set تعبان`,
      action: "اطفئه — تركيز الإشارات على الأفضل",
    };
  }

  return {
    verdict: "watch",
    rule: "K5",
    reason: `محروم من الصرف (${ad.spendSharePct.toFixed(1)}%) — كفاءته متوسطة والـ ad set تحت الهدف`,
    action: "راقب — لو فضل محروم بنفس الكفاءة، اطفئه مع التجديد القادم",
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
      reason: `قمة يوم أول (CTR ${day1.ctrLink.toFixed(2)}%) ثم تراجع ${dropPct.toFixed(0)}% خلال 72 ساعة — flash creative`,
      action: "اقفل — لا تزد الميزانية محاولًا استرجاع يوم 1؛ النية المركزة استُنفدت",
    };
  }
  if (dropPct > 0 && dropPct <= 30) {
    return {
      verdict: "continue",
      rule: "W2",
      reason: `تراجع تدريجي ${dropPct.toFixed(0)}% بعد موجة اليوم الأول — كريتف حقيقي يستقر`,
      action: "كمّل — ده مستواه الواقعي، احكم عليه بمتوسط أيام 2–4 لا بيوم 1",
    };
  }
  if (dropPct <= 0) {
    const beatsMedian =
      baselines.ctrLinkMedian90 !== null && last.ctrLink > baselines.ctrLinkMedian90;
    return {
      verdict: "continue",
      rule: "S1",
      reason: `أداء مستقر/صاعد عبر 72 ساعة — كريتف عميق${beatsMedian ? " وغالب ميديان الحساب" : ""}`,
      action: "مرشح ترقية قوي — جهّزه للنسخ بالـ Post ID عند اكتمال 3 أيام تحت الهدف",
      promotionEligible: beatsMedian,
      promotionNote: beatsMedian ? "🔁 مرشح ترقية — استقرار 72 ساعة + CTR فوق الميديان" : null,
    };
  }
  // between 30% and 50% — middle zone: watch
  return {
    verdict: "watch",
    rule: "W1",
    reason: `تراجع ${dropPct.toFixed(0)}% خلال 72 ساعة — بين الاستقرار والـ flash`,
    action: "راقب 24–48 ساعة إضافية بلا تعديل — الحكم بمتوسط أيام 2–4",
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
        reason: `إنهاك إبداعي: CTR نزل ${ctrDrop.toFixed(0)}% من قمة أول 3 أيام (${peak.toFixed(2)}% → ${recent.toFixed(2)}%) والـ CPM ثابت`,
        action: "جدّد الكريتف — الجمهور سليم، لا تلمس الـ ad set",
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
        reason: `CPM يتصاعد على هذا الإعلان (${money(cpmRecent)}) مقابل متوسط الحساب (${money(baselines.cpmAvg14)}) — عقوبة حداثة`,
        action: "الخوارزمية بتعاقب الكريتف — حضّر بديلًا وادخله بجانبه",
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
      reason: `CPA ${money(cpa)} بين 1×–1.5× الهدف (${money(target)}) — تذبذب محتمل`,
      action: "راقب 48–72 ساعة بلا أي تعديل",
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
          reason: `يوم سيئ منفرد بعد ${prior.length} أيام جيدة — تذبذب توزيع طبيعي`,
          action: "انتظر — لا تلمس؛ التعديل يكسر الـ learning",
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
        reason: `CTR ${ctrLink.toFixed(2)}% فوق ميديان الحساب لكن تحويل الصفحة ${cvr.toFixed(1)}% ضعيف — الإعلان بريء`,
        action: "⚠️ جمّد القرارات الإعلانية — المشكلة في الصفحة/العرض؛ أي تعديل إعلاني هنا حرق فلوس",
      };
    }
  }

  // W4: good clicks but LP views < 75% of clicks
  if (linkClicks >= 50 && lpViews > 0 && lpViews / linkClicks < 0.75) {
    return {
      verdict: "watch",
      rule: "W4",
      reason: `LP Views ${nf(lpViews)} = ${((lpViews / linkClicks) * 100).toFixed(0)}% من النقرات (< 75%)`,
      action: "افحص سرعة الصفحة أولًا؛ لو سليمة → congruency: وعد الإعلان لا يطابق الصفحة",
    };
  }

  // W6: CPA above target but full-funnel ROAS ≥ breakeven (full buyer value)
  if (cpa !== null && cpa > target && conversions > 0) {
    const fullRoas = (conversions * t.fullBuyerValue) / o.w3d.spend;
    if (fullRoas >= 2.0) {
      return {
        verdict: "continue",
        rule: "W6",
        reason: `CPA ${money(cpa)} فوق الهدف لكن Full-Funnel ROAS ${fullRoas.toFixed(1)} ≥ 2.0 بقيمة المشتري الكاملة (${money(t.fullBuyerValue)})`,
        action: "كمّل بحذر — الحكم النهائي للفانل، وراجع الـ Target لو النمط ثبت",
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
      reason: `CPA ${money(cpa!)} ≤ الهدف عبر 3 أيام rolling + CTR ${ctrLink.toFixed(2)}% غالب ميديان الحساب`,
      action: "مؤهل للترقية — انسخه بالـ Post ID للمرحلة التالية (الأصل يفضل شغال)",
      promotionEligible: true,
      promotionNote: "🔁 رقِّ بالـ Post ID — الكومبو مُثبَت",
    };
  }

  if (cpaAtOrUnder && conversions >= 3) {
    // Learning-phase gate: structural edits (incl. budget changes) are risky
    if (inLearning && o.level === "adset") {
      return {
        verdict: "continue",
        rule: "S2",
        reason: `CPA ${money(cpa!)} تحت الهدف لكن الوحدة لسه في الـ Learning (< 50 تحويل/أسبوع)`,
        action: "كمّل بلا أي تعديل هيكلي — التوسيع بعد خروج الـ learning؛ أي تعديل دلوقتي يعيد التعلم من الصفر",
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
          reason: `رابح بهامش واسع — CPA ${money(cpa)} ≤ 80% من الهدف (${money(target)}) باستقرار`,
          action: "توسيع أفقي: انسخ الكومبو الرابح بالـ Post ID لـ ad set/جمهور إضافي — بدل القفزات الرأسية",
        };
      }
      return {
        verdict: "continue",
        rule: "S4",
        reason: `رابح مستقر — CPA ${money(cpa!)} تحت الهدف باستمرار`,
        action: "لا تلمسه — أضف variations خفيفة بجانبه لتمديد عمره",
      };
    }
    return {
      verdict: "continue",
      rule: "S2",
      reason: `CPA ${money(cpa!)} تحت الهدف (${money(target)})`,
      action: "لو عايز توسيع: +20% فقط على الميزانية كل 48–72 ساعة — أكثر يعيد الـ learning",
    };
  }

  if (cpaAtOrUnder) {
    return {
      verdict: "continue",
      rule: "S2",
      reason: `CPA ${money(cpa!)} ≤ الهدف (${money(target)}) — عينة تحويلات لسه صغيرة`,
      action: "كمّل بنفس الميزانية — التوسيع بعد ثبات 3 أيام",
    };
  }

  // No CPA yet but gates passed and CTR healthy
  return {
    verdict: "continue",
    rule: "S2",
    reason: `المؤشرات داخل النطاق الطبيعي — CTR ${ctrLink.toFixed(2)}%${ctrMedian !== null ? ` (ميديان الحساب ${ctrMedian.toFixed(2)}%)` : ""}`,
    action: "كمّل بلا تعديل وراجع بعد اكتمال نافذة 3 أيام",
  };
}

// ============================================================
// Diagnosis ladder (الجزء الثامن) — for every kill/watch
// ============================================================

export function diagnosisLadder(
  o: NormalizedObject,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"]
): string {
  const w = o.w3d;
  const ctrMedian = baselines.ctrLinkMedian90;

  // 1. CPM
  if (baselines.cpmAvg14 && baselines.cpmNow && baselines.cpmNow > 1.3 * baselines.cpmAvg14) {
    return "المستوى 1 (CPM): مرتفع على الحساب كله مقابل آخر 14 يومًا → سوق/موسم/منافسة — لا تعالج بالكريتف؛ راجع توقعات التكلفة مؤقتًا";
  }
  if (baselines.cpmAvg14 && w.cpm > 1.3 * baselines.cpmAvg14 && w.impressions > 500) {
    return `المستوى 1 (CPM): مرتفع على هذه الوحدة تحديدًا (${money(w.cpm)} مقابل متوسط ${money(baselines.cpmAvg14)}) → الخوارزمية تعاقب الكريتف الباهت برفع تكلفة دخوله المزاد`;
  }

  // 2. Link CTR (hook)
  const ctrLow = ctrMedian !== null ? w.ctrLink < ctrMedian : w.ctrLink < 1.0;
  if (ctrLow && w.impressions >= 1000) {
    // 3. CTR All vs Link CTR mismatch
    if (w.ctrAll >= 2 * w.ctrLink && w.ctrAll > 1.5) {
      return `المستوى 3 (مصفوفة CTR): الإعلان مسلٍّ (CTR All ${w.ctrAll.toFixed(2)}%) لكنه لا يحرّك للفعل (Link CTR ${w.ctrLink.toFixed(2)}%) — الهوك يعمل والرسالة الوسطى/الـ CTA ضعيفة`;
    }
    return `المستوى 2 (Link CTR): ${w.ctrLink.toFixed(2)}% منخفض رغم CPM طبيعي → الكريتف/الهوك — قاعدة K3 أو تجديد`;
  }

  // 4. LP view rate
  if (w.linkClicks >= 50 && w.lpViews > 0 && w.lpViews / w.linkClicks < 0.75) {
    return `المستوى 4 (LP View Rate): ${((w.lpViews / w.linkClicks) * 100).toFixed(0)}% < 75% → افحص سرعة التحميل أولًا؛ لو سليمة → congruency بين وعد الإعلان والصفحة`;
  }

  // 5. page CVR — "ad innocent"
  if (w.lpViews >= 100) {
    const cvr = (w.conversions / w.lpViews) * 100;
    const weakPage = archetype === "free_lead" ? cvr < 15 : cvr < 2;
    if (weakPage) {
      return `المستوى 5 (تحويل الصفحة): LP Views جيدة بتحويل ${cvr.toFixed(1)}% → الصفحة/العرض/السعر — ⚠️ الإعلان بريء؛ لا تعدّله بينما العطل في العرض`;
    }
  }

  // 6. post-conversion
  return "المستوى 6 (ما بعد التحويل): مقاييس الإعلان والصفحة سليمة — لو النتائج النهائية ضعيفة فالمشكلة في الـ nurture/الإيميلات/الـ show-up/سكربت المكالمات";
}

// ============================================================
// Campaign-level evaluation (5.0: judged by full-funnel ROAS)
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
      reason: "صرف الحملة أقل من هدف تحويل واحد — لا حكم على مستوى الفانل بعد",
      action: "سيب البيانات تتجمع",
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
      reason: `ليدات/مبيعات LTO جيدة (CPA ${money(o.w3d.cpa)}) لكن الـ HTO لا يتحول — الإعلان بريء`,
      action: "المشكلة في الـ nurture/الإيميلات/الـ show-up — جمّد قرارات الإعلانات وأصلح ما بعد التحويل",
    };
  }

  if (fullRoas >= 2.0) {
    return {
      verdict: "continue",
      rule: "S2",
      reason: `Full-Funnel ROAS ${fullRoas.toFixed(1)} ≥ 2.0 بقيمة المشتري الكاملة (${money(t.fullBuyerValue)})${killChildren ? ` — مع ${killChildren} وحدة داخلية تستوفي القفل` : ""}`,
      action: killChildren
        ? "الحملة سليمة اقتصاديًا — نفّذ قرارات القفل الداخلية لتحسين الكفاءة"
        : "كمّل — التوسيع الرأسي +20% كل 48–72 ساعة عند الحاجة",
    };
  }
  if (fullRoas >= 1.0) {
    return {
      verdict: "watch",
      rule: "W6",
      reason: `Full-Funnel ROAS ${fullRoas.toFixed(1)} بين 1.0–2.0 — فوق التعادل لكن تحت أرضية الأمان`,
      action: "راقب وأصلح الوحدات الحمراء أولًا — الحكم النهائي للفانل",
    };
  }
  if (conversions === 0 && spend >= 2 * t.unitTarget) {
    return {
      verdict: "kill",
      rule: "K1",
      reason: `صرف ${money(spend)} ≥ 2 × الهدف بصفر تحويلات على مستوى الحملة`,
      action: "اقفل الحملة — لا تحوّل أصلًا",
    };
  }
  return {
    verdict: "watch",
    rule: "W6",
    reason: `Full-Funnel ROAS ${fullRoas.toFixed(1)} < 1.0 — الفانل تحت التعادل في النافذة الحالية`,
    action: "نفّذ قرارات القفل الداخلية وراجع العرض/الصفحة قبل ضخ ميزانية إضافية",
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
  const starved = starvedAdMatrix(ad, parent, t, baselines);
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

  const byId = new Map(snapshot.objects.map(o => [o.id, o]));
  const rows: EngineRow[] = [];

  const toRow = (o: NormalizedObject, fired: Fired, diagnosis: string | null): EngineRow => ({
    id: o.id,
    name: o.name,
    status: o.status,
    level: o.level,
    parentId: o.parentId,
    campaignId: o.campaignId,
    daily_budget: o.dailyBudget,
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
    diagnosis,
    promotion_eligible: !!fired.promotionEligible,
    promotion_note: fired.promotionNote ?? null,
    learning_phase: !!o.learningPhase || weeklyConversions(o) < 50,
  });

  // Evaluate ads first (needed for nothing), then adsets, then campaigns (need children)
  const ads = snapshot.objects.filter(o => o.level === "ad");
  const adsets = snapshot.objects.filter(o => o.level === "adset");
  const campaigns = snapshot.objects.filter(o => o.level === "campaign");

  for (const ad of ads) {
    const parent = ad.parentId ? byId.get(ad.parentId) : undefined;
    const fired = evaluateAd(ad, parent, targets, funnel.archetype, baselines);
    const diag =
      fired.verdict === "kill" || fired.verdict === "watch"
        ? diagnosisLadder(ad, baselines, funnel.archetype)
        : null;
    rows.push(toRow(ad, fired, diag));
  }

  for (const s of adsets) {
    const fired = evaluateAdset(s, targets, funnel.archetype, baselines);
    const diag =
      fired.verdict === "kill" || fired.verdict === "watch"
        ? diagnosisLadder(s, baselines, funnel.archetype)
        : null;
    rows.push(toRow(s, fired, diag));
  }

  for (const c of campaigns) {
    const childRows = rows.filter(r => r.campaignId === c.id && r.level === "adset");
    const fired = evaluateCampaign(c, targets, childRows, !!funnel.htoUnderperforming);
    const diag =
      fired.verdict === "kill" || fired.verdict === "watch"
        ? diagnosisLadder(c, baselines, funnel.archetype)
        : null;
    rows.push(toRow(c, fired, diag));
  }

  const summary = buildSummary(rows, snapshot, targets);
  return { rows, summary, targets };
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
      rule: r.rule,
      verdict: "kill",
      action_ar: r.action_ar,
      impact_ar: `يوقف نزيف ~${money(impact)}/يوم`,
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
      rule: r.rule,
      verdict: "rescue",
      action_ar: r.action_ar,
      impact_ar: `كريتف بكفاءة عالية (CTR ${r.ctr_link}%) محروم من الصرف`,
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
      rule: r.rule,
      verdict: r.verdict,
      action_ar: r.action_ar,
      impact_ar: `كومبو مُثبَت جاهز للترقية بالـ Post ID`,
      impactValue: r.spend_3d,
    });
  }
  const top3 = actions.slice(0, 3).map((a, i) => ({ ...a, rank: i + 1 }));

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
  };
}
