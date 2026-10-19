# Data Model: Verdict Accuracy — Stop False Kills

**Feature**: `015-verdict-accuracy` · **Date**: 2026-10-19 · **Plan**: [plan.md](./plan.md)

No database migration. Every change below is either a TypeScript shape change on data that
already flows through `snapshots.payload`, or a new derived field computed at evaluation time.
`drizzle/schema.ts` is read-only for this feature.

## 1. `WindowMetrics` (`shared/qarar.ts`)

| Field | Before | After | Why |
|---|---|---|---|
| `conversionValue` | `number` | `number \| null` | FR-026. `null` when Meta returned no `action_values` array at all. Never coerced to `0` |
| `resultsUnknown` | — | `boolean \| undefined` (new, optional) | FR-027. `true` only when the `actions` array was absent **and** `linkClicks > 0` — an inconsistent payload |

**Inheritance**: `DailyMetrics extends WindowMetrics`, so both changes propagate to every
`daily7[]` and `daily30[]` entry as well as to `w3d` and `today`.

**Why `resultsUnknown` is a new field and not `undefined` on the count fields**:
`leadConversions?` and `purchaseConversions?` already reserve `undefined` for "snapshot captured
before the spec-012 lead/purchase separation — unit unknown", formalised in
`specs/012-appointment-webinar-archetypes/contracts/conversion-measurement.md` §5 where `?? 0` is
forbidden. See research.md R1.

### Validation rules

- `resultsUnknown === true` ⇒ the zero-result rules (K1) and the click-through kill (K3) MUST NOT
  fire on that window; the object takes ⏳ with a reason naming the missing data (FR-028).
- `resultsUnknown` absent or `false` ⇒ counts are a genuine zero and all rules evaluate normally.
- `conversionValue === null` ⇒ only the `roas_3d` display goes blank. No verdict rule reads it:
  S2/W6 use result counts × the configured buyer value and stand down on `resultsUnknown`
  instead (contracts/unknown-vs-zero.md §U2).
- `conversionValue === 0` with the array present ⇒ a real zero, used as before.

### Three payload shapes (the test matrix)

| `actions` array | `linkClicks` | `resultsUnknown` | Counts mean | K1 / K3 |
|---|---|---|---|---|
| absent | `> 0` | `true` | unknown | stand down |
| absent | `0` | `false` | genuine zero | evaluate |
| present, no purchase/lead entry | any | `false` | genuine zero | evaluate |

## 2. `Baselines` (`shared/qarar.ts`)

| Field | Before | After | Why |
|---|---|---|---|
| `purchases30` | — | `number \| null` (new) | FR-025. 30-day purchase total |
| `leads30` | — | `number \| null` (new) | FR-025. 30-day registration total |

Both are summed inside the loop at `server/meta.ts:1371–1409`, which already computes per-day
purchase and lead counts for `cpaMedian30` / `cplMedian30` and discards them. **No new Graph
call** — identical manoeuvre to spec 012's `cplMedian30` (research.md R2). `null` when the
baselines request produced no usable rows, per principle 10.

Persisted with the rest of `baselines` into `snapshots.payload` at `server/meta.ts:1203`.

### Validation rules

- The save-time funnel check (FR-025) reads only these two totals, from the cached snapshot.
- Absent snapshot or either total `null` ⇒ the check is skipped silently and the save proceeds
  (FR-025, spec Assumptions).
- Mismatch condition: chosen funnel type counts registrations and `purchases30 >= 3 * leads30`,
  or counts purchases and `leads30 >= 3 * purchases30`.

## 3. Row / verdict output (`server/engine.ts`)

| Field | Before | After | Why |
|---|---|---|---|
| `statusBadge` | — | `string \| null` (new, display-only) | FR-008. Names the real non-active state |

`statusBadge` is **not** a verdict and must never be treated as one (FR-008, Principle VI). The
verdict for every gated row stays `too_early` with rule code `GATE`.

### Badge mapping (FR-008)

| Effective status | `statusBadge` | Rendered |
|---|---|---|
| `PAUSED`, `CAMPAIGN_PAUSED`, `ADSET_PAUSED` | "موقوف" | yes |
| `PENDING_REVIEW` | "قيد المراجعة" | yes |
| `DISAPPROVED` | "مرفوض" | yes |
| `WITH_ISSUES`, `PENDING_BILLING_INFO` | "به مشكلة — راجعه في مدير الإعلانات" | yes |
| `ARCHIVED`, `DELETED` | — | row not rendered at all |
| `ACTIVE`, `IN_PROCESS`, `PREAPPROVED` | `null` | row evaluated normally |

### State resolution

Effective status is resolved as `effectiveStatus ?? status` (FR-007b), preserving the existing
chain at `server/engine.ts:341` and `2130–2136`. `IN_PROCESS` and `PREAPPROVED` resolve to active
(FR-007a) so verdicts do not flicker after an edit.

## 4. Account summary (`server/engine.ts` `buildSummary()`)

| Field | Before | After | Why |
|---|---|---|---|
| `counts` | `Record<Verdict, number>` over all levels | same shape, over active ad-set and ad rows only; campaigns excluded (FR-030) | Shape kept so unrelated readers do not break mid-feature (research.md R8); a campaign summarises its ad sets, so counting it double-counts |
| `kill_adsets` | — | `number` (new) | FR-030a. N in the split counter |
| `kill_ads` | — | `number` (new) | FR-030a. M in the split counter |
| `settings_mismatch` | — | `boolean` (new) | FR-005. Drives the top-of-dashboard warning card |
| `bleed_daily` | existing | semantics unchanged | FR-030b already satisfied by the existing parent-most loops; this feature adds tests, not logic |

### Validation rules

- `kill_adsets` counts ad-set rows with verdict `kill` that pass the status gate. `kill_ads` the
  same for ad rows. **Campaign rows are never counted** (FR-030) — a campaign is a summary of its
  ad sets, so counting it double-counts the same loss.
- Both counters exclude gated objects (FR-030c), reusing the existing `isActive` resolver.
- Neither counter may vary with the table's selected level (FR-030d).
- `settings_mismatch` is `true` when objects tripping the event-match gate hold ≥ 50% of active
  spend, where "active spend" is the window spend of status-gate-passing ad sets (spec
  Assumptions).

## 5. Derived targets (`shared/qarar.ts`)

No shape change. `DerivedTargets.unitTarget` and `DerivedTargets.unitTargetSource` already exist
(`shared/qarar.ts:397–402`, union
`"effective_cpa" | "cpl_baseline" | "cpl_benchmark" | "cpl_funnel_math" | null`) and are already
set on every branch of `deriveTargets()`. FR-017–FR-020 are plumbing: return the existing pair to
the dashboard summary and to Settings, and display it.

### Source labels (FR-018)

| `unitTargetSource` | Arabic label |
|---|---|
| `cpl_baseline` | "محسوب من متوسط حسابك في آخر 30 يومًا" |
| `effective_cpa`, `cpl_funnel_math` | "محسوب من أرقام الفانل" |
| `cpl_benchmark` | "محسوب من متوسط السوق المُدخل" |
| `null` | no target — the page says what is missing |

The union has exactly these four values plus `null`; there is no separate CPA-baseline variant.
`free_lead` correctly reports `cpl_baseline` when it falls back to `cpaMedian30`
(`shared/qarar.ts:787–789`), so no archetype currently mislabels its own source — FR-018 is a
display gap, not a derivation bug.

## 6. Funnel settings (`funnelSettings` table, `FunnelInputs`)

**No schema change.** `drizzle/schema.ts:156` already enumerates
`paid_lto | free_lead | appointment | webinar`; `liveComponent` (line 164) is a non-null boolean
defaulting to `false`. `FunnelInputs.archetype` (`shared/qarar.ts:335`) and
`FunnelInputs.liveComponent` (336) already exist.

The paid-event option is a **presentation-layer mapping only** (FR-021):

| UI option | Stored `archetype` | Stored `liveComponent` | Counted event |
|---|---|---|---|
| أبيع منتجًا أو خدمة بسعر منخفض مباشرة | `paid_lto` | `false` | purchases |
| أقدّم فعالية مدفوعة: ندوة أو تحدٍّ أو ورشة أو ماستر كلاس، ثم أبيع بعدها | `paid_lto` | `true` | purchases |
| أدعو الناس إلى فعالية **مجانية**: ندوة أو تحدٍّ أو ماستر كلاس، ثم أبيع بعدها | `webinar` | unchanged | registrations |
| أحجز استشارة مجانية ثم أبيع بعدها | `appointment` | unchanged | registrations |
| أجمع بيانات عملاء مجانًا ثم أبيع منتجًا غاليًا | `free_lead` | unchanged | registrations |

### Validation rules

- Loading a stored row with `archetype === "paid_lto" && liveComponent === true` MUST re-select
  the paid-event option (FR-022).
- `free_lead` stays legacy-only — rendered solely when it is the stored value, preserving the
  existing behaviour at `Settings.tsx:512–514`.
- No engine archetype is added; target math and result counting are untouched (FR-021).

## 7. Entity relationships (unchanged, for orientation)

```text
funnelSettings (1 per user+account)
  └─ drives → counted result event + judging target
                    │
snapshots.payload (1 per user+account, JSON)
  ├─ baselines ─────┤  (+ purchases30, leads30)
  └─ tree
       campaign ──< adset ──< ad          each: w3d, today, daily7[], daily30[]
                                           each: effectiveStatus → statusBadge
                    │           │
                    └─ counted ─┘ in kill_adsets / kill_ads (campaigns excluded)

verdictHistory (append-only log)
  └─ verdict varchar(16), rule varchar(8)  — "too_early"/"GATE" both fit; no change needed
```

**Note on `verdictHistory`**: after this feature, gated objects log `too_early`/`GATE` where they
previously logged a kill. Historical rows are not rewritten; the change is forward-only.
