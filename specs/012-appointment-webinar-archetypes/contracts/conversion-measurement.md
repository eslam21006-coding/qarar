# Contract: Conversion measurement (FR-030 … FR-035)

## 1. The defect

`server/meta.ts:241-247`:

```js
const CONVERSION_ACTION_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "lead",
  "offsite_conversion.fb_pixel_lead",
];
```

`pickAction` (line 249) returns the **first** type present in the response. Purchases precede leads,
so any account reporting purchases is measured on purchases.

Appointment and webinar funnels report both by definition — the funnel is lead → call/webinar → sale.
So `w.conversions` becomes the sale count while `unitTarget` is a cost per lead. At the spec's own
sanity-check rates (`p = 0.924%`), those differ by ~108×.

Two consequences, both **introduced or amplified** by this feature:

- Every cost rule compares a cost per sale against a cost-per-lead target.
- `cvr = conversions / lpViews` (`engine.ts:192, 284`) sits near 0.01%, so the **15% weak-page floor
  this feature enables (FR-026a)** fires on essentially every account.

This is why P1 is sequenced before P6 (plan §Phase 2 sketch).

## 2. Split lists

```text
LEAD_ACTION_TYPES     = ["lead", "offsite_conversion.fb_pixel_lead"]
PURCHASE_ACTION_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]
CONVERSION_ACTION_TYPES = [...PURCHASE_ACTION_TYPES, ...LEAD_ACTION_TYPES]   // UNCHANGED order
```

`CONVERSION_ACTION_TYPES` must keep its **exact current ordering** — it is what `free_lead` and
`paid_lto` are judged on today, and FR-032/SC-025 require that to be untouched. Deriving it from the
two new lists is a convenience, not a redefinition; the concatenation order is load-bearing.

## 3. `parseInsightsRow` (`server/meta.ts:258-278`)

```text
w.conversions         = pickAction(row.actions, CONVERSION_ACTION_TYPES)   // unchanged
w.leadConversions     = pickAction(row.actions, LEAD_ACTION_TYPES)         // NEW
w.purchaseConversions = pickAction(row.actions, PURCHASE_ACTION_TYPES)     // NEW
```

`w.cpa` (line 276) stays derived from `w.conversions`. The archetype-aware cost per result is computed
in the engine, where the archetype is known — `parseInsightsRow` has no access to funnel settings and
must not gain any.

## 4. Archetype selection (FR-031)

| Archetype | Count judged on |
|---|---|
| `paid_lto`, `free_lead` | `conversions` — unchanged |
| `appointment`, `webinar` | `leadConversions` |

Everything derived from the count follows the same selection: cost per result, page conversion rate
(`cvr`), zero-result checks, and the full-ROAS numerator in W6/S2.

## 5. Snapshot compatibility (FR-035)

`snapshots.payload` is an untyped `json` column with no version marker (`drizzle/schema.ts:171-181`),
so absence of the optional field is the discriminator (research R6):

| `leadConversions` | Meaning | `appointment` / `webinar` |
|---|---|---|
| `undefined` | captured before separation — unit unknown | **not measurable**; not judged |
| `0` | captured; genuinely no leads | zero results; ordinary zero-result rules apply |
| `> 0` | captured | judged on this count |

`?? 0` conflates the first two rows and is forbidden. Existing archetypes are unaffected —
`conversions` is populated in both old and new payloads.

Self-clearing: the first refresh after deploy writes the new shape. **Back-filling historical
snapshots is out of scope.**

## 6. Baselines (FR-033)

`server/meta.ts:1207-1229` issues one `last_30d, time_increment=1, fields=spend,actions` call and
currently narrows each day with `pickAction(r.actions, CONVERSION_ACTION_TYPES)` (line 1220).

Add a second median over the same rows using `LEAD_ACTION_TYPES`:

```text
cpaMedian30  = median(spend/day ÷ conversions/day)        // unchanged
cplMedian30  = median(spend/day ÷ leadConversions/day)    // NEW
```

**No new Graph call** — the `actions` array already carries every type and the lead entries are being
discarded today (research R4). Days with a zero denominator are excluded, matching the existing
`conv > 0 ? spend / conv : NaN` + `.filter(Number.isFinite)` shape at lines 1219-1225.

## 7. Invariants

1. `conversions` is byte-identical before and after this change, for every input (SC-025).
2. For `appointment`/`webinar`, no rule reads `conversions` or `cpaMedian30`.
3. For `paid_lto`/`free_lead`, no rule reads `leadConversions` or `cplMedian30`.
4. `leadConversions === undefined` never becomes `0` through a default.
5. Target and measurement always share a unit: `cplMedian30` with `leadConversions`; `cpaMedian30`
   with `conversions`.
6. No new Meta API request is issued.
