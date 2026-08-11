# Phase 0 Research: Verdict Accuracy Fixes

**Feature**: `specs/013-verdict-accuracy-fixes` · **Date**: 2026-08-09

All items the spec deferred to planning are resolved below against the current
code. No `NEEDS CLARIFICATION` remains.

---

## R1 — Objective allow-list membership

**Decision.** Exemption is an explicit allow-list keyed on the effective campaign
objective. Membership:

**Exempt** (awareness / traffic / engagement / video / reach family):

| Era | Values |
|-----|--------|
| Current (ODAX) | `OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_APP_PROMOTION` |
| Legacy | `BRAND_AWARENESS`, `REACH`, `LINK_CLICKS`, `POST_ENGAGEMENT`, `PAGE_LIKES`, `EVENT_RESPONSES`, `VIDEO_VIEWS`, `LOCAL_AWARENESS` |
| Legacy app | `APP_INSTALLS`, `MOBILE_APP_INSTALLS`, `MOBILE_APP_ENGAGEMENT`, `CANVAS_APP_ENGAGEMENT`, `CANVAS_APP_INSTALLS` |

**Not exempt** (runs the full rulebook): `OUTCOME_LEADS`, `OUTCOME_SALES`,
`CONVERSIONS`, `PRODUCT_CATALOG_SALES`, `LEAD_GENERATION`, `MESSAGES`, plus
`null`, `undefined`, and every unlisted value.

**Rationale.** FR-006b fixes the fail-safe direction: unrecognised ⇒ fully
judged. The list is therefore written as an allow-list constant, and membership
is only granted where the objective is unambiguously a non-converting one.

**Deliberate omissions.** `STORE_VISITS` and `OFFER_CLAIMS` are *not* on the
allow-list. Both are plausibly conversion-adjacent (offline visits, offer
redemption), and under FR-006b uncertainty resolves to non-exempt. Adding either
later is a safe additive change; removing a wrongly-granted exemption is not.

**Alternatives considered.** A deny-list of the two outcome objectives (the
original spec draft) — rejected in clarification because pre-ODAX `CONVERSIONS` /
`PRODUCT_CATALOG_SALES` / `LEAD_GENERATION` campaigns would have been silently
exempted, disabling all diagnosis on live sales spend.

**Verification note.** `server/demo.ts` sets **no** `objective` on any object
(confirmed: zero matches). Every demo object therefore resolves to `null` ⇒
non-exempt ⇒ the demo account's verdicts are untouched by Issue B. New fixtures
are required for coverage (see R8).

---

## R2 — Objective inheritance

**Decision.** Reuse, but resolve inheritance BEFORE evaluation. `server/engine.ts:1340`
backfills ad-set/ad `objective` from a `Map<campaignId, objective>` at the top of
`runEngine` — runs against `snapshot.objects` so the backfilled value is what
`evaluateAd` / `evaluateAdset` see, not just what the EngineRow output carries.
`server/engine.test.ts:270-288` covers both inheritance and the
objective-less→`null` case.

**Round-2 correction.** The pre-round-1 implementation backfilled objectives
into `EngineRow` AFTER evaluation, which left children seeing `objective === null`
during the per-object evaluator. Under an exempt campaign that meant the
exempt branch returned `null` and the sales rulebook fired on children —
exactly the bug CodeRabbit round-2 caught (`server/engine.ts:1340` now resolves
inheritance on the underlying snapshot objects before any evaluator runs).

**Consequence.** The exemption predicate reads `o.objective` and needs no
level-specific logic; by the time evaluators run, every object carries its
effective objective.

---

## R3 — Currency conversion for the $10/day threshold

**Decision.** `convertCurrency(10, "USD", snapshot.currency)` from
`shared/qarar.ts:502`, computed once per run alongside the existing
`deriveTargets` call in `runEngine` (`engine.ts:1112`).

**Rationale.** Same pivot table (`EXCHANGE_RATES_TO_USD`, `qarar.ts:468-486`)
and same no-op semantics the target derivation already relies on: unknown or
null target currency returns the amount unchanged (`qarar.ts:510-513`), which is
exactly the fallback FR-011 and the spec's edge case describe.

**Direction matters.** `from = "USD"`, `to = snapshot.currency`. Reversing these
would divide instead of multiply — for AED (rate 3.67) that turns a 10 threshold
into ≈2.72 instead of 36.70, flagging almost every campaign. Contract test
required (see contracts/).

**Alternatives considered.** Hardcoding per-currency thresholds — rejected,
duplicates the rate table and reintroduces the AED/USD mismatch class of bug this
project already has history with.

---

## R4 — Lifetime budget and flight window (FR-012a)

**Current state.**

| Field | Campaign | Ad set |
|-------|----------|--------|
| `daily_budget` | fetched (`meta.ts:417`), mapped (`:944`) | fetched (`:427`), mapped (`:969`) |
| `lifetime_budget` | **fetched (`:417`), discarded** | **not fetched** |
| `start_time` / end | **not fetched** | **not fetched** |

`NormalizedObject` (`shared/qarar.ts:177-201`) has `dailyBudget` only. Ad objects
hardcode `dailyBudget: null` (`meta.ts:1000`), confirming FR-015.

**Decision.** Add to the existing `fetchHierarchy` field lists — no new call, no
new scope:

- campaigns: `start_time`, `stop_time` (`lifetime_budget` already requested)
- ad sets: `lifetime_budget`, `start_time`, `end_time`

**API asymmetry to respect.** Meta names the campaign end field `stop_time` and
the ad-set end field `end_time`. Using one name for both silently yields
`undefined` at the level that doesn't have it, collapsing every lifetime-budget
object of that level to the observed-spend rung. Explicit per-level mapping
required.

**Money units.** `daily_budget` arrives in minor units and is divided by 100
(`meta.ts:944`). `lifetime_budget` uses the same convention and must be divided
identically — an undivided value would be 100× too large and flag everything.

**Decision — new fields on `NormalizedObject`.** `lifetimeBudget: number | null`,
`flightStart: string | null`, `flightEnd: string | null`. All optional and
absent-tolerant, matching how `asOfDate` and `daily30` handle snapshots cached
before the field existed (`qarar.ts:230-238`) — cached snapshots stay readable
and fall to the observed-spend rung.

**Daily-equivalent formula.** `lifetimeBudget ÷ ceil((flightEnd −
flightStart) / 1 day)`, applied only when the span is a positive, parseable
interval. A zero, negative, unparseable, or missing span is treated as
unresolvable and drops to the next rung — the ladder's
`source === "none" && hadLifetime === true` branch produces ⏳ `GATE`
instead of a synthetic 1-day fallback. No `max(1, …)` clamp is applied;
`ceil` is not called on an invalid span.

---

## R5 — Where the exempt branch goes

**Current per-level order** (this is the crux; the three levels differ):

| Level | Sequence today | Entry point |
|-------|----------------|-------------|
| Ad | `preSeparationGate` → K3 explicit kill → starved → `gateVerdict` → decay/fatigue/watch/continue | `evaluateAd` (`engine.ts:1012`) |
| Ad set | `preSeparationGate` → **circuit breaker** → `gateVerdict` → kill rules → … | `evaluateAdset` (`:1074`) |
| Campaign | `preSeparationGate` → spend-below-target GATE (`:914`) → W5 → … | `evaluateCampaign` (`:903`) |

The paused check lives *inside* `gateVerdict` (`:182-190`) — third in that
function, and at every level it sits **behind** at least one rule that can return
a `kill`.

**Decision.** A single shared helper, called as the first statement of all three
evaluators:

```
evaluateNonSales(o, threshold) : Fired | null
  ├─ not exempt → return null            // pipeline continues untouched
  ├─ paused     → return existing paused GATE Fired   (FR-009)
  └─ resolve daily rate → NS1 | NS2 | too_early GATE  (FR-012a, FR-009c)
```

Each evaluator gains exactly one guard line: `const ns =
evaluateNonSales(o, threshold); if (ns) return ns;`.

**Rationale.** Satisfies FR-009b (reached before any sales rule at every level),
FR-009 (paused wins inside the branch), and FR-020/SC-010 (a `null` return leaves
today's sequence byte-identical for non-exempt objects). It also keeps the paused
message in one place rather than duplicating the Arabic copy.

**Alternatives considered.** Hoisting the paused check to the front of all three
evaluators — rejected in clarification: it changes verdicts for non-exempt
objects (a paused ad currently reachable by K3 would flip to ⏳), violating FR-022
and SC-003.

**Out of scope — `buildNoTargetResult` (`engine.ts:1270`).** When
`targets.unitTarget === null` the engine returns early and emits every row as
`too_early GATE` ("complete your funnel settings"). The exempt branch is **not**
added there. That state is a configuration prompt, not a misleading sales
verdict, so User Story 2's problem does not arise; showing `NS1`/`NS2` for a
subset of rows while the rest say "configure me" would be less coherent, not
more. Recorded as a deliberate decision, not an oversight.

---

## R6 — Diagnosis skip (FR-010a)

**Current state.** Diagnosis is gated on **verdict**, not rule code, in three
identical spots: `engine.ts:1198-1201` (ad), `:1207-1210` (ad set),
`:1217-1219` (campaign) — all `verdict === "kill" || verdict === "watch"`.

`NS2` is a `watch`, so without an explicit skip an exempt object would be
diagnosed. `diagnose()` (`:803-885`) always returns at least one finding
(`:871-873` appends a fallback when empty), so an exempt row would never come
back clean.

**Downstream blast radius.** `account_funnel_cta` (`:1533-1547`) fires when any
row has a step-5 finding with no step 1–4 finding. An exempt campaign could
therefore trigger the account-level "your offer or funnel is the problem" banner
and the discovery-call CTA — constitution principle VII.

**Decision.** Extend each of the three conditions with an exemption guard so
`diagnose()` is never invoked for an exempt object, per FR-010a's "hard skip at
the call site, not a filter inside the routine". Exempt rows carry
`findings: []`, which makes them structurally incapable of contributing to
`account_funnel_cta`, and `promotion_eligible: false` satisfies FR-010c.

---

## R7 — Summary strip: counters, bleed, top actions

**Decision.** All three fixes land inside `buildSummary`
(`engine.ts:1431-1556`). It is called from **both** result paths — `runEngine`
(`:1256`) and `buildNoTargetResult` (`:1320`) — so a single change covers both.

**The status-resolution problem.** `EngineRow` (`shared/qarar.ts:345-374`) has
`status` but **no** `effectiveStatus`; only `NormalizedObject` carries it
(`:198`). `buildSummary` already receives `snapshot`, so it can build
`Map<id, NormalizedObject>` and resolve the full three-step fallback that
`DecisionTable.tsx:560-564` uses:

```
effectiveStatus ?? snapshotObject.status ?? row.status   →  !== "ACTIVE" ⇒ paused
```

**Decision — do not add `effectiveStatus` to `EngineRow`.** Resolving from
`snapshot` inside `buildSummary` keeps the wire shape unchanged and avoids a
second source of truth for a value the client already resolves its own way.

**Three call sites to filter** (all currently unfiltered on status):

| Element | Location | Change |
|---------|----------|--------|
| counters | `:1436-1439` | tally active rows only |
| `bleed_daily` | `:1448-1470` (three loops over kill rows) | skip paused rows |
| `top_3_actions` | `:1474-1527` (`killRows`, `rescueRows`, `scaleRows`) | skip paused rows |

**Unchanged** per FR-005b: `total_spend_3d` / `total_spend_today`
(`:1442-1444`) and `baselines`.

**Why this is not cosmetic.** A paused object *can* hold a `kill` verdict —
K3/starved (ad) and CB1/CB2 (ad set) precede the paused check (R5). Filtering
counters alone would leave the strip self-contradictory (0 kills beside non-zero
bleed and a "stop this ad" card for a stopped ad), which is FR-005a.

---

## R8 — Test impact

**No existing test asserts the behaviour being corrected.** Verified:

- `server/demo.ts` — every object is `status: "ACTIVE"` (18/18) and none has an
  `objective`. So the demo snapshot exercises neither new code path.
- `server/engine.test.ts:190-194` — "verdict counts add up to total rows"
  (`sum === rows.length`) continues to **pass**, because all demo rows are
  active. It becomes a weaker assertion rather than a broken one.
- `server/engine.test.ts:270-288` — objective-inheritance tests use
  `OUTCOME_SALES` and `null`, both non-exempt. Unaffected.
- `server/control.budget.test.ts` — uses `objective: null` throughout. Unaffected.

**Consequence.** The constitution's "tests that assert old/incorrect behaviour
are updated deliberately" clause is expected **not** to be invoked. If any test
does fail, that is a signal of unintended regression and must be investigated,
not amended. This is a stronger safety property than the spec assumed and should
be stated as such in tasks.

**Coverage gap to close.** New fixtures are needed for: paused objects (all
verdicts, including a paused `kill`), each exempt objective family, legacy
conversion objectives, `MESSAGES`, an unrecognised objective value, lifetime
budget with/without a valid flight window, and a non-USD account currency.

---

## R9 — Rule catalog and UI surfacing

**Decision.** Add `"NS1" | "NS2"` to the `RuleCode` union
(`shared/qarar.ts:24-30`) and matching `{ titleAr, defAr }` entries to `RULES`
(`:32`).

**Type safety is free.** `RULES` is typed `Record<RuleCode, …>`, so extending the
union without adding catalog entries is a compile error — `npm run check` will
enforce it.

**No client change required.** `RuleChip` and `RuleTitle`
(`client/src/components/Verdict.tsx:33,53`) and `VerdictHistoryDialog.tsx` all
read `RULES[rule]` generically, so `NS1`/`NS2` inherit the existing faded/tooltip
treatment automatically, satisfying FR-017 with no new UI component.

**Arabic copy** (simple MSA, ≤6th grade, FR-018/FR-019):

- `NS1` reason — this campaign is not judged on direct sales; it plays an
  indirect role building awareness that supports sales over the long term.
- `NS2` reason — the same, plus: its daily budget is above the ceiling for a
  campaign that does not sell directly.
- `NS2` action — reduce the daily budget below the threshold (rendered with the
  converted figure via the existing `money()` helper, which is already bound to
  the account currency at `engine.ts:1116`, keeping numerals LTR).
