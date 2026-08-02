export type FunnelArchetype = "paid_lto" | "free_lead" | "appointment" | "webinar";

/**
 * Spec 012 / contracts/settings-fields.md §3 — VISIBLE_FIELDS is the
 * union of every field that MAY be visible for SOME archetype. The
 * per-archetype visibility is decided in `isFieldVisible`, which is
 * now a real per-archetype matrix (not a single-field special case).
 */
export const VISIBLE_FIELDS = [
  "archetype",
  "inputCurrency",
  "aov",
  "frontEndRoas",
  "htoPrice",
  "htoConversionRate",
  "marketCplBenchmark",
  "htoUnderperforming",
  "dailyBudget",
  "bookRate",
  "showRate",
  "showUpRate",
  "closeRate",
] as const;

export const HIDDEN_FIELDS = [
  "liveComponent",
  "offerDescription",
  "ticketPrice",
  "arena",
  "bestInterest",
  "geoTiers",
] as const;

export type VisibleFieldName = (typeof VISIBLE_FIELDS)[number];
export type HiddenFieldName = (typeof HIDDEN_FIELDS)[number];
export type SettingsFieldName = VisibleFieldName | HiddenFieldName;

export type FieldCopy = { label: string; hint: string };

/**
 * T039 / contracts/settings-fields.md §1 — the inline archetype
 * selector helper. Distinguishes any upfront-paid funnel (`paid_lto`)
 * from completely free booking/attendance funnels (`appointment`,
 * `webinar`, future options). Renders as the `archetype.hint` line.
 */
export const ARCHETYPE_SELECTOR_HELPER =
  "إن كان العميل يدفع أي مبلغ للحجز أو الحضور، اختر الخيار المدفوع. " +
  "أما إن كان الحجز أو الحضور مجانيًا تمامًا والبيع لاحقًا، اختر أحد الخيارات المجانية.";

export const FIELD_COPY: { [K in VisibleFieldName]: FieldCopy } = {
  archetype: {
    label: "كيف تبيع؟",
    // Mirrors the selectable options in the Settings dropdown. `free_lead`
    // is deliberately absent: the archetype still exists and every saved
    // row keeps working, but it is no longer offered as a new choice —
    // `appointment` / `webinar` replace it going forward.
    hint:
      "أبيع منتجًا أو خدمة مباشرة، أو أقدم فعالية أو استشارة مدفوعة · " +
      "أحجز استشارة مجانية ثم أبيع بعدها · " +
      "أدعو الناس إلى فعالية مجانية: ندوة أو تحدٍّ أو ماستر كلاس، ثم أبيع بعدها",
  },
  inputCurrency: {
    label: "ما عملة أسعارك؟",
    hint: "سيتم تحويل الأسعار تلقائيًا إلى عملة حسابك — كل ما تكتبه هنا بعملتك، والتطبيق يحسب الأهداف بعملة حسابك.",
  },
  aov: {
    label: "متوسط قيمة الطلب الواحد ({عملة})",
    hint: "كم يدفع العميل في المتوسط عند أول شراء؟",
  },
  frontEndRoas: {
    label: "كم ضعفًا تريد استرداده من الإعلان؟",
    hint: "1 = تسترد أموالك بالضبط · أقل من 1 = تقبل خسارة بسيطة مقابل كسب عملاء",
  },
  htoPrice: {
    label: "سعر المنتج الغالي ({عملة})",
    hint: "العرض الكبير الذي تبيعه بعد المنتج الرخيص",
  },
  htoConversionRate: {
    label: "من كل 100 مشترٍ، كم واحدًا يشتري الغالي؟ (%)",
    hint: "مثال: 4 تعني 4 من كل 100",
  },
  marketCplBenchmark: {
    label: "سعر العميل المحتمل المعتاد في مجالك ({عملة}) — اختياري",
    hint: "إن كان حسابك جديدًا ولا يوجد تاريخ نقيس عليه",
  },
  htoUnderperforming: {
    // T043 / FR-028c/d — the W5 wording is archetype-dependent: the
    // canonical "first sale" phrasing for paid_lto / free_lead stays;
    // appointment / webinar get wording that fits their own final step.
    label:
      "htoUnderperforming", // sentinel — actual label resolved by `htoUnderperformingLabel`
    hint: "فعّل هذا الخيار إن كان الناس يشترون الرخيص ولا يكملون للغالي — سينبهك التطبيق إلى أن المشكلة ليست في الإعلانات نفسها",
  },
  dailyBudget: {
    label: "ميزانيتك اليومية للإعلانات ({عملة}) — اختياري",
    hint: "يساعدنا في اقتراح ميزانية لكل مجموعة إعلانية جديدة",
  },
  bookRate: {
    // FR-005 — appointment only.
    label: "من كل 100 عميل محتمل، كم واحدًا يحجز مكالمة؟ (%)",
    hint: "نسبة الحجز من العملاء المحتملين. مثال: 6 تعني 6 من كل 100",
  },
  showRate: {
    // FR-005 — appointment only.
    label: "من كل 100 حجز، كم واحدًا يحضر المكالمة؟ (%)",
    hint: "نسبة الحضور من الحجوزات المؤكدة. مثال: 70 تعني 70 من كل 100",
  },
  showUpRate: {
    // FR-006 — webinar only (Phase 4 / T048). Label is in place for the
    // per-archetype selector; the field is hidden for appointment.
    label: "من كل 100 مسجّل في الندوة، كم واحدًا يحضر؟ (%)",
    hint: "نسبة الحضور من المسجّلين. مثال: 25 تعني 25 من كل 100",
  },
  closeRate: {
    // FR-007 — appointment + webinar share this column with two labels
    // (resolve via `closeRateLabel`). The closure-rate question asked of
    // the funnel's final step.
    label: "closeRate", // sentinel — actual label resolved by `closeRateLabel`
    hint: "نسبة الإغلاق في خطوة الفانل الأخيرة",
  },
};

/**
 * T043 / FR-028d — the W5 question wording depends on archetype. Paid_lto
 * and free_lead keep the canonical "first sale" wording; appointment /
 * webinar get wording that fits their own final step.
 */
export function htoUnderperformingLabel(
  archetype: FunnelArchetype
): string {
  if (archetype === "appointment") return "الناس تحجز وتحضر لكن لا تشتري؟";
  if (archetype === "webinar") return "الناس تحضر الندوة لكن لا تشتري؟";
  return "البيع الأول جيد، لكن المنتج الغالي لا يُباع؟";
}

/**
 * FR-007 — `closeRate` is one stored value serving both archetypes;
 * the label is archetype-aware. Webinar Phase 4 (T048) reuses this
 * same field with a different wording.
 */
export function closeRateLabel(archetype: FunnelArchetype): string {
  if (archetype === "webinar") return "من كل 100 حاضر، كم واحدًا يشتري؟ (%)";
  // appointment (and paid_lto fallback) — the call-rate wording.
  return "من كل 100 مكالمة، كم واحدة تنتهي ببيع؟ (%)";
}

/**
 * Spec 012 / T037 / contracts/settings-fields.md §3 — the per-archetype
 * visibility matrix. The legacy implementation special-cased one field
 * (`marketCplBenchmark`); the spec-012 form is a real matrix keyed by
 * (field, archetype) with no defaults — every cell is explicit.
 */
const VISIBILITY: Record<VisibleFieldName, Record<FunnelArchetype, boolean>> = {
  archetype: { paid_lto: true, free_lead: true, appointment: true, webinar: true },
  inputCurrency: { paid_lto: true, free_lead: true, appointment: true, webinar: true },
  // FR-028 — product-purchase fields hidden for appointment / webinar
  // because their math no longer depends on them and the inputs would be
  // confusing without effect.
  aov: { paid_lto: true, free_lead: true, appointment: false, webinar: false },
  frontEndRoas: { paid_lto: true, free_lead: true, appointment: false, webinar: false },
  htoPrice: { paid_lto: true, free_lead: true, appointment: true, webinar: true },
  htoConversionRate: { paid_lto: true, free_lead: true, appointment: false, webinar: false },
  // FR-020 — third-tier source. Was free_lead-only; widened to
  // appointment + webinar so the priority chain can fall through to it.
  marketCplBenchmark: {
    paid_lto: false,
    free_lead: true,
    appointment: true,
    webinar: true,
  },
  htoUnderperforming: {
    paid_lto: true,
    free_lead: true,
    appointment: true,
    webinar: true,
  },
  dailyBudget: { paid_lto: true, free_lead: true, appointment: true, webinar: true },
  // FR-005 / FR-006 / FR-007 — stage-rate fields are archetype-specific.
  bookRate: { paid_lto: false, free_lead: false, appointment: true, webinar: false },
  showRate: { paid_lto: false, free_lead: false, appointment: true, webinar: false },
  showUpRate: { paid_lto: false, free_lead: false, appointment: false, webinar: true },
  closeRate: { paid_lto: false, free_lead: false, appointment: true, webinar: true },
};

export function isFieldVisible(
  field: SettingsFieldName,
  archetype: FunnelArchetype
): boolean {
  if ((HIDDEN_FIELDS as readonly string[]).includes(field)) return false;
  // The matrix covers every visible field × every archetype; the lookup
  // is total. The type signature on the lookup enforces that — a
  // missing row would not type-check.
  return VISIBILITY[field as VisibleFieldName][archetype];
}
