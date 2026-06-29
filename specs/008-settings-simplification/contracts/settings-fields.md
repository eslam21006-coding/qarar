# Contract: Settings Field Visibility & Copy

This is the UI contract for the simplified Settings page. It is the authoritative source for the
field matrix, the archetype-conditional visibility rules, and the baseline Arabic copy. The pure
helper `client/src/lib/settingsFields.ts` implements this contract and `settingsFields.test.ts`
verifies it.

## 1. Field sets

```
VISIBLE_FIELDS = [
  "archetype", "inputCurrency", "aov", "frontEndRoas", "htoPrice",
  "htoConversionRate", "marketCplBenchmark", "htoUnderperforming", "dailyBudget"
]

HIDDEN_FIELDS = [
  "liveComponent", "offerDescription", "ticketPrice",
  "arena", "bestInterest", "geoTiers"
]
```

Invariant: the two sets are disjoint and their union equals the complete set of `funnelSettings`
input fields. Hidden fields are never rendered but always retained in `FormState` and the save
payload.

## 2. Visibility predicate

```
isFieldVisible(field, archetype):
  if field in HIDDEN_FIELDS            -> false
  if field == "marketCplBenchmark"     -> archetype == "free_lead"
  otherwise                            -> true
```

- No field other than `marketCplBenchmark` changes visibility by archetype.
- `aov`, `frontEndRoas`, `htoPrice`, `htoConversionRate` are visible for all three archetypes,
  including `direct_call`.

## 3. Section grouping

| Section header (Arabic) | Fields (in order) | Notes |
|---|---|---|
| `نوع الفانل` | `archetype` | top card |
| `أرقام البيع` | `inputCurrency`, `aov`, `frontEndRoas`, `htoPrice`, `htoConversionRate` | `inputCurrency` selector + conversion notice preserved verbatim from Batch 2 |
| `إعدادات متقدمة` | `marketCplBenchmark` (free_lead only), `htoUnderperforming`, `dailyBudget` | collapsible via `<details open>` — **expanded by default** |

The derived-targets preview card (right column) is preserved exactly as in Batch 2, including the
dual-currency display, the `capped` warning, the free_lead CPL ceiling row, the "كيف حسبنا هذا
الرقم؟" breakdown, and the suggested-budget hint (which depends on the still-visible `dailyBudget`).

## 4. Baseline Arabic copy (label + hint)

Copy is ≤ 6th-grade fusha, no English, no jargon. Currency-symbol interpolation (e.g.
`(${currencySymbol(form.inputCurrency)})`) in labels is retained from the existing implementation.
These are the baseline strings; minor wording polish during implementation is acceptable as long as
it stays within the constitution's simple-Arabic rule and remains English-free.

| Field | Label | Hint / help |
|---|---|---|
| `archetype` | كيف تبيع؟ | (options) أبيع منتجًا رخيصًا أولًا ثم أعرض منتجًا غاليًا · أجمع بيانات عملاء مجانًا ثم أبيع منتجًا غاليًا · العميل يحجز مكالمة مباشرة |
| `inputCurrency` | ما عملة أسعارك؟ | (conversion notice when ≠ account currency) سيتم تحويل الأسعار تلقائيًا إلى {عملة الحساب} — كل ما تكتبه هنا بعملتك، والتطبيق يحسب الأهداف بعملة حسابك. |
| `aov` | متوسط قيمة الطلب الواحد ({عملة}) | كم يدفع العميل في المتوسط عند أول شراء؟ |
| `frontEndRoas` | كم ضعفًا تريد استرداده من الإعلان؟ | 1 = تسترد أموالك بالضبط · أقل من 1 = تقبل خسارة بسيطة مقابل كسب عملاء |
| `htoPrice` | سعر المنتج الغالي ({عملة}) | العرض الكبير الذي تبيعه بعد المنتج الرخيص |
| `htoConversionRate` | من كل 100 مشترٍ، كم واحدًا يشتري الغالي؟ (%) | مثال: 4 تعني 4 من كل 100 |
| `marketCplBenchmark` | سعر العميل المحتمل المعتاد في مجالك ({عملة}) — اختياري | إن كان حسابك جديدًا ولا يوجد تاريخ نقيس عليه |
| `htoUnderperforming` | البيع الأول جيد، لكن المنتج الغالي لا يُباع؟ | فعّل هذا الخيار إن كان الناس يشترون الرخيص ولا يكملون للغالي — سينبهك التطبيق إلى أن المشكلة ليست في الإعلانات نفسها |
| `dailyBudget` | ميزانيتك اليومية للإعلانات ({عملة}) — اختياري | يساعدنا في اقتراح ميزانية لكل مجموعة إعلانية جديدة |

## 5. Removed UI

- The entire "الاستهداف (اختياري)" card (which held `bestInterest` + `geoTiers`) is removed.
- The `arena` ("طريقة الاستهداف") selector is removed.
- The `offerDescription` ("وصف العرض") textarea is removed.
- The `liveComponent` ("هل تقدم بثًا مباشرًا…") toggle is removed.
- The `ticketPrice` field (if previously rendered) is removed.

All five remain in `FormState` (hydrated from server / `DEFAULTS`) and in the save payload.

## 6. Non-functional contract

- Dark theme, RTL layout, mobile responsiveness preserved (reuse existing card/grid classes).
- Numeric inputs keep `dir="ltr"` + `.num` class.
- No English text visible anywhere in the form.
- `npm run check` passes (zero TS errors); `npm test` stays green; new `settingsFields.test.ts`
  passes.
