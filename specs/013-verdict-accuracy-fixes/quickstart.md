# Quickstart: Validating Verdict Accuracy Fixes

**Feature**: `specs/013-verdict-accuracy-fixes` · **Date**: 2026-08-09

How to prove the feature works. Contracts and field details live in
[contracts/](./contracts/) and [data-model.md](./data-model.md) — not repeated here.

## Prerequisites

```powershell
npm install
```

Two verification commands, both must be clean (constitution, Engineering
constraints):

```powershell
npm run check     # tsc --noEmit
npm test          # vitest
```

Pre-implementation baseline (recorded in `baseline.md`) was **484 passed /
24 skipped** tests; the final suite reported **558 passed / 39 skipped**, all
74 new tests landing in new test files (SC-010).

Two failure classes are recorded against the final run, both out of scope for
spec 013:

1. **`server/auth-flow.e2e.test.ts`** — pre-existing DB-connection failure
   (MySQL unreachable in the local sandbox; the suite is not skipped because
   Vitest reports it as a "Failed Suite" rather than an explicit skip).
   Unchanged before and after — local-only; CI runs against MySQL and must see
   a clean pass for that suite.
2. **`server/funnelIntegrity.test.ts` mock pollution (full-suite only)** —
   the suite passes in isolation (7/7) but fails when the full suite runs
   because a mock leaks into the new spec-013 exemption suites; tracked
   separately, not in scope for spec 013.

---

## Baseline first (do this before writing code)

Capture the pre-change state so the non-regression claim is evidence, not
assertion:

```powershell
npm test 2>&1 | Select-String -Pattern "Tests|passed|failed" | Select-Object -Last 5
```

Record the pass/skip counts. **SC-010 requires that every test passing at
baseline still passes after implementation, with no existing test file
modified** — the total passing count WILL grow because this feature adds new
test files. Research R8 established that no current test asserts either
behaviour being corrected — so a failure here is a real regression, not an
expected update. Do not amend a failing test without first proving it asserted
old behaviour.

---

## Validation 1 — Summary strip is active-only (User Story 1)

**What to build**: fixtures with paused objects, including at least one paused
object holding a `kill` verdict (reachable via K3 or the starved matrix at ad
level, or CB1/CB2 at ad-set level — these precede the paused check).

**Assertions**:

| # | Check | Requirement |
|---|-------|-------------|
| 1 | Five counters sum to the number of active objects, not `rows.length` | FR-001, SC-001 |
| 2 | Each counter equals a manual tally of active rows with that verdict | FR-001 |
| 3 | A paused `kill` row is absent from `counts.kill`, contributes `0` to `bleed_daily`, and does not appear in `top_3_actions` | FR-005, SC-002b |
| 4 | All-paused account ⇒ every counter `0`, bleed `0`, actions empty | SC-002a |
| 5 | `total_spend_3d` / `total_spend_today` unchanged from baseline | FR-005b |
| 6 | Paused rows keep their verdict, rule, reason, action | FR-004, SC-006 |
| 7 | `effectiveStatus` overrides `status` (configured ACTIVE, delivery paused ⇒ excluded) | FR-002 |

**Note on the existing suite**: `engine.test.ts:190-194` asserts
`sum === rows.length`. It passes today and continues to pass, because every demo
object is `ACTIVE`. Leave it alone — it is a weaker assertion, not a wrong one.

---

## Validation 2 — Exemption classification (User Story 2)

**Assertions** — one case per row, all through `runEngine`. The exempt cases
mirror the full `NON_SALES_OBJECTIVES` allow-list; the test suite
parameterises over every member so adding a new value automatically widens
coverage (T011, SC-004):

| Objective | Expected |
|-----------|----------|
| `OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_APP_PROMOTION` | exempt ⇒ `NS1`/`NS2` |
| `BRAND_AWARENESS`, `REACH`, `VIDEO_VIEWS`, `LINK_CLICKS`, `POST_ENGAGEMENT`, `PAGE_LIKES`, `EVENT_RESPONSES`, `LOCAL_AWARENESS` | exempt (legacy awareness / reach / engagement / video family) |
| `APP_INSTALLS`, `MOBILE_APP_INSTALLS`, `MOBILE_APP_ENGAGEMENT`, `CANVAS_APP_ENGAGEMENT`, `CANVAS_APP_INSTALLS` | exempt (legacy app family) |
| `OUTCOME_LEADS`, `OUTCOME_SALES` | not exempt ⇒ ordinary verdict |
| `CONVERSIONS`, `PRODUCT_CATALOG_SALES`, `LEAD_GENERATION` | **not exempt** (SC-011) |
| `MESSAGES` | **not exempt** (SC-011) |
| `null` | not exempt (FR-008) |
| `"SOME_FUTURE_OBJECTIVE"` | **not exempt** (FR-006b, SC-012) |

Plus: an ad set and an ad under an exempt campaign inherit exemption and receive
no sales rule (FR-007, SC-004).

**The critical negative test**: assert that a `CONVERSIONS` campaign never
produces `NS1` or `NS2`. This is the failure this design exists to prevent —
silently disabling diagnosis on live sales spend.

---

## Validation 3 — Budget threshold and currency

| Scenario | Expected |
|----------|----------|
| USD account, `dailyBudget` 10 | `NS1` — boundary inclusive |
| USD account, `dailyBudget` 10.01 | `NS2` |
| AED account, `dailyBudget` 36 | `NS1` (threshold ≈ 36.70) |
| AED account, `dailyBudget` 40 | `NS2` |
| Unknown currency code | threshold stays `10`, no error |

**Direction guard** — assert the AED threshold is ≈36.70, not ≈2.72. A reversed
`convertCurrency` argument order produces the latter and flags almost everything;
without this assertion the bug ships looking plausible.

---

## Validation 4 — Lifetime budget ladder

| Scenario | Expected rung | Verdict |
|----------|---------------|---------|
| `dailyBudget` present | `daily` | `NS1`/`NS2` |
| Lifetime 700, 7-day window | `lifetime` (100/day) | `NS2` |
| Lifetime 70, 7-day window | `lifetime` (10/day) | `NS1` |
| Lifetime present, no/broken window, **`w3d.spend > 0`** | `observed` | per `w3d.spend / 3` |
| Lifetime present, no window, **`w3d.spend === 0`** | `none` | ⏳ `GATE` — **never `NS1`** |
| No budget at all (ad row, CBO ad set, ABO campaign) | `none` | `NS1` |
| Window with zero / negative / unparseable span | falls to `observed` **only when `w3d.spend > 0`**, otherwise `none` | no divide-by-zero, no silent clamp |

The observed rung is gated on `w3d.spend > 0`: a lifetime object that has not
begun delivering carries no meaningful average, and `none` is the only honest
answer.

**Two assertions that catch quiet failures** (see contracts/meta-import-fields.md):

1. Per level: a campaign reads `stop_time`, an ad set reads `end_time`. Using one
   name for both silently collapses that level to the observed rung.
2. `lifetime_budget` is divided by 100. Undivided, every lifetime campaign lands
   in `NS2`.

---

## Validation 5 — Diagnosis containment

| # | Check | Requirement |
|---|-------|-------------|
| 1 | An `NS2` row has `findings: []` despite being a `watch` | FR-010a |
| 2 | `diagnose()` is not called for exempt objects at any of the three sites | FR-010a |
| 3 | Account whose only non-continue verdicts are `NS2` ⇒ `account_funnel_cta === null` | FR-010b, SC-013 |
| 4 | Exempt rows have `promotion_eligible === false` | FR-010c |

Check 3 is the constitution-VII guard: an awareness campaign must never be the
reason the user is told their offer or funnel is broken.

---

## Validation 6 — Ordering and non-regression

| # | Check | Requirement |
|---|-------|-------------|
| 1 | Active exempt object under 48h with compliant budget ⇒ `NS1`, not ⏳ | FR-009a, SC-009 |
| 2 | Active exempt object with near-zero impressions ⇒ `NS1`/`NS2`, never the "needs N more impressions" message | FR-009a |
| 3 | Paused exempt object ⇒ ⏳ with the existing paused copy | FR-009, SC-006 |
| 4 | Exempt ad that would trigger K3, and exempt ad set that would trip CB ⇒ neither fires | FR-009b, SC-004 |
| 5 | Exempt campaign in an appointment/webinar pre-split snapshot ⇒ budget verdict, not the pre-separation gate | FR-009a |
| 6 | Demo account verdicts identical to baseline (no objectives ⇒ nothing exempt) | SC-003 |

---

## Manual UI check

```powershell
npm run dev
```

Two accounts to verify:

1. **Demo account** (objectives are all `null` ⇒ non-exempt ⇒ no `NS1`/`NS2`
   ever appear): confirms the non-exempt rendering path is unchanged. Rule
   codes render faded via the existing `RuleChip`, so `NS1`/`NS2` need no UI
   work for this path.
2. **Exempt seeded snapshot or dedicated fixture** (an account whose
   campaigns carry `OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`,
   `OUTCOME_ENGAGEMENT`, or any legacy member of the allow-list): use this
   one to confirm `NS1`/`NS2` chips render faded and appear in the tooltip,
   never as primary copy (FR-017).

On the exempt fixture: confirm `NS1`/`NS2` appear faded and in the tooltip,
never as primary copy (FR-017). Confirm the strip's Arabic copy still reads at
6th-grade level and figures render LTR inside the RTL layout (FR-019).

---

## Definition of done

- [ ] `npm run check` clean
- [ ] `npm test` — every baseline test still passes, **no existing test file modified** (the total passing count grows by the new test files)
- [ ] All six validations above covered by new tests
- [ ] `CONVERSIONS` / `MESSAGES` negative tests present (SC-011)
- [ ] Unrecognised-objective negative test present (SC-012)
- [ ] Lifetime-budget-never-`NS1` test present (SC-009a)
- [ ] Funnel-CTA containment test present (SC-013)
