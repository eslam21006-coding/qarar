export type FunnelArchetype = "paid_lto" | "free_lead" | "direct_call";

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

export const FIELD_COPY: { [K in VisibleFieldName]: FieldCopy } = {
  archetype: {
    label: "كيف تبيع؟",
    hint: "أبيع منتجًا رخيصًا أولًا ثم أعرض منتجًا غاليًا · أجمع بيانات عملاء مجانًا ثم أبيع منتجًا غاليًا · العميل يحجز مكالمة مباشرة",
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
    label: "البيع الأول جيد، لكن المنتج الغالي لا يُباع؟",
    hint: "فعّل هذا الخيار إن كان الناس يشترون الرخيص ولا يكملون للغالي — سينبهك التطبيق إلى أن المشكلة ليست في الإعلانات نفسها",
  },
  dailyBudget: {
    label: "ميزانيتك اليومية للإعلانات ({عملة}) — اختياري",
    hint: "يساعدنا في اقتراح ميزانية لكل مجموعة إعلانية جديدة",
  },
};

export function isFieldVisible(
  field: SettingsFieldName,
  archetype: FunnelArchetype
): boolean {
  if ((HIDDEN_FIELDS as readonly string[]).includes(field)) return false;
  if (field === "marketCplBenchmark") return archetype === "free_lead";
  return true;
}
