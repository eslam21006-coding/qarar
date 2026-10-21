# Data Model: Judgment Model & Single Source of Numbers

No database change and no migration. Every change below is to in-memory types in `shared/qarar.ts`
and `client/src/lib/filters.ts`, and to engine outputs computed on read (the dashboard runs the
engine on every request — research.md §1.2 item 12).

## 1. Shared helpers (new, `shared/qarar.ts`)

| Name | Signature | Rule |
|---|---|---|
| `countedResults` | `(w: WindowMetrics, a: FunnelArchetype) => number \| null` | appointment/webinar → `leadConversions`; else `conversions`; `null` if `resultsUnknown` or field `undefined` |
| `otherFamilyResults` | `(w, a) => number \| undefined` | paid_lto → `leadConversions`; else `purchaseConversions` |
| `arabicCount` | `(n: number, forms: { one; two; few; many }) => string \| null` | 0 → null; 1 → one; 2 → two; 3–10 → few; 11+ → many; `{n}` substituted |
| `VERDICT_SEVERITY` | `Record<Verdict, number>` | kill 0, watch 1, rescue 2, continue 3, too_early 4 |

## 2. `EngineRow` (changed)

| Field | Before | After | Notes |
|---|---|---|---|
| `conversions_3d` | `number` (`?? 0`) | `number \| null` | `null` = Meta did not send the count (FR-015) |
| `full_roas_3d` | — | `number \| null` | **new**, campaign rows only; display data (FR-006) |
| `budget_control` | — | `"enabled" \| "disabled" \| null` | **new**, placement of ±20% (FR-008/009) |
| `derived_from_adset` | — | `{ id: string; name: string } \| null` | **new**, set on derived campaign rows to the ad set whose rule code they carry (FR-004, D-R1); `null` elsewhere |
| `findings` | campaign: diagnosed when kill/watch | derived campaign: always `[]` (display) | FR-020a; card input kept internally (§6) |
| `verdict`/`rule`/`reason_ar`/`action_ar` | campaign: own rules | campaign: gates 1–4, W5, or derived | FR-001–FR-005 |

Unchanged: `cpa_3d`, `roas_3d`, `daily_budget`, `statusBadge`, `campaignId`, `parentId`.

### `TopAction` (changed)

| Field | Change |
|---|---|
| `derived_from_adset` | **new**, `{ id; name } \| null`, copied from the row (owner decision Q2) |

### Verdict history display (no data change)

`verdictHistory` is unchanged. The dialog derives its prefix from `(level, verdict, rule)` only —
campaign + watch + one of K1, K2, K3, K4, K6, K7, CB2 → "من إحدى مجموعاتها: " (FR-004a).

## 3. `EngineResult` (changed)

| Field | Change |
|---|---|
| `archetype` | **new**, `FunnelArchetype`, also on the no-target result (D9) |

## 4. `FilterAgg` (`client/src/lib/filters.ts:44` area, changed)

| Field | Before | After |
|---|---|---|
| `results` | `number` | `number \| null` (unknown) |
| `cpa` | `number \| null` | unchanged type; `null` at 0 or unknown |
| `conversionValue` | `number` | `number \| null` (unknown) |
| `roasUnknown` | — | `boolean` (new) |

Consumers to update: `aggFromWindow`, `aggregate`, `aggregateTotals`, `cellValue`/`cellClass`/
`totalCell`, sort comparators, and any filter predicate on `results` (treat `null` as not matching
numeric filters).

## 5. `DailyMetrics` series (server, `routers.ts` `dailyOf` children-sum)

Per-date child sum now also carries `leadConversions`, `purchaseConversions` (sum or `undefined`),
`conversionValue` (sum or `null`), `resultsUnknown` (OR). Type unchanged.

## 6. Derived campaign verdict (computed, not stored)

| Input | From |
|---|---|
| P — active child ad sets | ad-set rows after R3 guard, `campaignId === c.id`, status gate passed |
| R — rescue-worthy ads | ad rows `rescue`, active, parent ∈ P |
| Output | `verdict`, `rule`, `reason_ar`, `action_ar`, `findings: []`, `budget_control`, `full_roas_3d` |
| Card entry (internal) | `{ rule: derived rule, findings: diagnose(…, derivedFired) }` for derived 🔴/🟡 campaigns, passed to `buildSummary` only; not on `EngineRow`, not sent to the client (campaign-derivation.md C7a) |

State: a campaign's verdict is a pure function of P and R on each run; there is no lifecycle.
`verdictHistory` records it like any row; `varchar(8)` rule / `varchar(16)` verdict already fit.

## 7. Validation rules

- Derived `verdict === "kill"` ⇒ no member of P is `continue` (SC-001).
- Derived row with P ≠ ∅ ⇒ `derived_from_adset !== null` and its `rule` equals that ad set's rule;
  that ad set's verdict equals the campaign's unless no member of P has the campaign's verdict.
- `budget_control === "enabled"` on a campaign ⇒ P ≠ ∅ and every member of P is `continue` (SC-009).
- `conversions_3d > 0` ⇒ `cpa_3d !== null` (SC-002).
- `findings.length > 0` on a campaign ⇒ its rule is from steps 1–4 or W5.
- `account_funnel_cta !== null` ⇔ a qualifying, non-ad-blamed finding exists among ad-set rows, ad
  rows, W5 campaign rows and derived campaigns' card entries (FR-021a part 1).
