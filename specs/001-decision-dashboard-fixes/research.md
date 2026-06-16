# Phase 0 Research: Decision Dashboard Fixes & Next-Step Features

All Technical Context items resolved. No outstanding NEEDS CLARIFICATION. Each decision
below is grounded in the existing codebase (`docs/audit-finding.md` anchors) and the
platform reference docs under `references/`.

---

## R1 — Diagnosis engine: early-return ladder → finding collector

**Decision**: Replace `diagnosisLadder(o, baselines, archetype): string` (a chain of
`if (...) return text`) with `diagnose(o, baselines, archetype): Finding[]` that evaluates
**every** journey rung, pushes a `Finding` for each broken one, and marks the **first**
pushed finding `primary: true`. `EngineRow.diagnosis: string | null` becomes
`EngineRow.findings: Finding[]`.

**Rationale**: Problems 2 and 5b are the same flaw — the ladder's first rung is an
account-wide CPM check identical for every row, so it short-circuits before reaching the
offer/funnel rungs (W3 / step-5 / step-6) that are the path to the booking. Collecting
instead of short-circuiting preserves the SOP's "fix the first broken level" guidance
(via `primary`) while exposing the rest as "also failing." The verdict pipeline is not
touched, so all verdict/rule tests stay green.

**Alternatives considered**:
- *Keep ladder, append a second pass for funnel rungs* — rejected: duplicates rung logic
  and risks drift between the verdict path and the diagnosis path.
- *Compute findings in the client* — rejected: violates Principle I (diagnosis must be
  deterministic, server-side, rule-coded) and would duplicate baseline math client-side.

**Account-level extraction**: The account-wide CPM finding is removed from the per-row
function and computed **once** in `buildSummary` as `AccountSummary.account_alert`
(`cpmNow > 1.3 × cpmAvg14`), rendered as a single banner. Suppressed when `cpmAvg14` or
`cpmNow` is null.

**Funnel CTA synthesis**: Findings at step 5 (page CVR — the W3 "الإعلان بريء" pattern),
step 6 (post-conversion), and the campaign-level W5 (`htoUnderperforming` + good LTO) carry
`ctaUrl = "https://eslamsalah.com/team-discovery-call"`. If **any** row/campaign produces
such a finding, `buildSummary` sets `AccountSummary.account_funnel_cta` for the prominent
account-level card.

---

## R2 — `objective` end-to-end plumbing (unblocks filters)

**Decision**: Fetch `objective` on campaigns in `meta.ts` (`fetchHierarchy` field list +
`buildSnapshot` campaign object), add `objective?: string | null` to `NormalizedObject` and
`objective: string | null` to `EngineRow`, set it in `toRow`. After rows are built in
`runEngine`, **backfill** ad-set/ad rows from a `Map<campaignId, objective>` so children
inherit their campaign's objective when their own is null.

**Rationale**: Objective exists only at campaign level in Meta. Filtering by objective at
every level (FR-021) requires inheritance. The data is one extra field on an existing fetch
— cheap, no new API call.

**Edge case**: Campaign with no objective → children inherit `null` → treated as
"no objective" for filters (excluded from `is`, included from `is-not`), per spec edge case.

**Alternatives**: Storing objective as a DB column — rejected; it lives naturally in the
snapshot JSON payload alongside the rest of the normalized tree.

---

## R3 — Client-side filter builder

**Decision**: Implement a composable, **client-side** filter model over the already-loaded
`rows`, combined with the existing date-range `aggs` for numeric fields:

```ts
type FilterField = "name" | "objective" | "verdict" | "status" | "level"
                 | "spend" | "impressions" | "cpa" | "ctrLink" | "cpm";
type TextOp = "contains" | "is" | "is_not";
type NumOp  = ">=" | "<=" | "between";
interface FilterRule { id: string; field: FilterField; op: TextOp|NumOp; value: string; value2?: string }
// + filterJoin: "AND" | "OR"
```

Numeric fields read from `aggs.get(r.id)` (so they honor the selected date range and
re-evaluate on range change). Existing free-text `q` and verdict chips continue to work and
are treated as additional predicates (empty `filters` = match all). Labels in simple Arabic.

**Rationale**: All filterable data is already in memory; client-side composes with
cross-level search, the totals footer, and the paused toggle without server round-trips.
Reuses shadcn `DropdownMenu`/`Select` already imported.

**Alternatives**: Server-side filter params on `dashboard.get` — rejected: adds latency,
duplicates client state, and the dataset is small enough to filter locally.

---

## R4 — Totals footer: weighted-ratio aggregation (DRY with `aggregate`)

**Decision**: Add `aggregateTotals(visibleRows, seriesMap, range, from, to)` that
re-walks the same day windows `aggregate()` uses, accumulates **raw** components
(spend, impressions, clicks, linkClicks, results, lpViews, v3, thruplays) across visible
rows, then recomputes ratios from sums (cpa = spend/results; ctrLink = linkClicks/imps×100;
cpm = spend/imps×1000; cpc = spend/linkClicks; lpRate = lpViews/linkClicks×100). Refactor
`aggregate()` to expose an internal `rawSums()` helper both call, to avoid drift. Render a
single `<tfoot>` row over `visible` (post-filter, post-search). Rates with zero denominator
and non-summable fields (spendShare, frequency) show `—`.

**Rationale**: The correct weighted-ratio math already exists in `aggregate()`; averaging
rates would be silently wrong (SC-006 tests two rows of very different volumes).

---

## R5 — Daily scheduled refresh (Heartbeat cron, project-level)

**Decision**: Use a **project-level Heartbeat cron** (`references/periodic-updates.md` §4a),
created via the in-sandbox `manus-heartbeat create` CLI under the project-owner identity,
firing daily (6-field UTC cron, e.g. `0 0 6 * * *`) and POSTing to a new endpoint
`/api/scheduled/dailyRefresh` mounted in `server/_core/index.ts` before the Vite fallthrough.
The handler authenticates via `sdk.authenticateRequest` (requires `user.isCron`), then
iterates **each user's explicitly selected accounts with an active connection** (per
clarification), and for each:
1. reads the **previous** saved snapshot and runs `runEngine` to capture its kill-set,
2. calls `buildSnapshot` → `runEngine` on fresh data,
3. diffs kill object IDs (new ∖ old), `saveSnapshot`,
4. on new kills → `notifyOwner` with count + names + `summary.bleed_daily`,
5. on auth error → mark connection `expired` and `notifyOwner` to reconnect.

**Rationale**: Cloud Run kills idle instances — in-process timers (`setInterval`/`node-cron`)
are **forbidden** by the platform. Heartbeat is the sanctioned mechanism; this job is not
end-user-configurable, so it is owner-level (§4a), not the end-user tRPC flow (§3). No agent
capabilities are needed (no browsing/LLM), so Heartbeat — not AGENT cron — is correct.

**Idempotency & timeout**: Handler must be idempotent (platform retries 5xx/429) and finish
within 2 minutes. New-🔴 detection is naturally idempotent (re-running diffs against the
now-saved snapshot yields an empty new-set). If account count risks exceeding the 2-min
window, the handler processes accounts in a bounded loop and relies on the next day's run;
**[deferred to tasks: confirm expected account volume; chunk if needed]** — not blocking at
expected single-owner scale.

**Previous-run comparison**: Because `saveSnapshot` deletes the prior snapshot before
insert, the job reads + evaluates the old payload **before** saving the new one (audit
option (a)). The `verdictHistory` table (R6) provides a secondary durable record but the
diff itself uses the read-before-overwrite approach for self-containment.

**Deployment note**: Per platform rule, the callback handler must be **deployed** before the
cron is created (dev sandboxes are unreachable). Task ordering reflects this:
implement+deploy handler → then `manus-heartbeat create`.

**Alternatives**: AGENT cron (§4b) — rejected, no agentic work needed. End-user Heartbeat
(§3) — rejected, the schedule is system-fixed, not user-picked.

---

## R6 — Verdict history: transitions-only log

**Decision**: New additive table `verdictHistory` (userId-scoped). On every evaluation
(manual `dashboard.refresh` and the daily job), `recordVerdicts(userId, accountId, rows)`
inserts a row **only for objects whose verdict OR rule differs from that object's last
logged state** (per clarification — transitions, not every evaluation). First-ever
evaluation writes one baseline row. Read path: `history.getForObject(adAccountId, objectId)`
returns that object's ordered transitions, scoped by `userId`. UI: a per-object timeline
dialog reachable from a row icon.

**Rationale**: Writing every object every day would bloat storage and fill the timeline with
identical repeated entries; transitions give a meaningful, compact audit trail. Mirrors the
`getChecks`/`setCheck` isolation pattern exactly.

**Last-logged lookup**: For each object, fetch its most recent `verdictHistory` row
(`ORDER BY evaluatedAt DESC LIMIT 1`, scoped by userId+account+objectId) and compare
verdict+rule before inserting. Batch-friendly: one query per refresh keyed by object IDs.

---

## R7 — Inline budget control (new Meta write)

**Decision**: Add `setDailyBudget(token, objectId, newBudgetMinorUnits)` in `meta.ts`
(POST `/{objectId}` with `daily_budget`; Meta budgets are **minor units/cents**, so multiply
the account-currency value by 100 and round). Add `control.setBudget` tRPC mutation mirroring
`control.setStatus`: account-ownership check, object-in-snapshot check, demo simulation
branch, auth/permission error mapping (`RECONNECT_REQUIRED` / `NEEDS_RECONNECT_PERMISSION`),
then reflect the new budget in the cached snapshot and `saveSnapshot`. Requires
`ads_management`. UI: `+20%`/`−20%` buttons in the control cell, shown only where
`r.daily_budget !== null`, each behind an `AlertDialog` showing old→new and SOP guidance.

**Rounding/min**: `new = round(old × 1.2)` / `round(old × 0.8)`. A −20% that would fall below
Meta's minimum daily budget surfaces a clear error and does not apply (FR-058). Meta returns
a validation error for sub-minimum budgets; the mutation maps it to a simple-Arabic message.

**Rationale**: This is the second sanctioned Meta write (constitution V), matching the SOP S2
"raise 20% every 48–72h" rule. Reuses the entire `control.setStatus` safety scaffold.

---

## R8 — Owner notification channel

**Decision**: Use the platform's existing `notifyOwner({ title, content })`
(`server/_core/notification.ts`, `references/owner-notifications.md`). Returns `true`/`false`
(false = upstream temporarily unavailable). Content authored in simple Arabic.

**Rationale**: Spec Assumption already commits to the existing mechanism; no new external
channel is introduced. Owner-facing alerts (new 🔴, reconnect) are exactly this channel's
purpose. The boolean return lets the daily job log a soft failure without crashing the run.

---

## R9 — UX-correctness formatting decisions

- **CPA ∞ vs —**: The call site (not `money()`) decides. For `too_early`/pre-gate rows, render
  `—` (neutral). Keep red `∞` only when verdict is a zero-conversion kill (K1/CB2). `money()`
  keeps returning `∞` for null; the cell chooses which to pass.
- **CTR colors**: `ctrColorClass(ctr, median?)` — when the account 90-day median CTR is known,
  the acceptable→good threshold keys off `ctr > median`; absolute SOP §9.1 bands
  (`<0.5` dead, `0.5–1` weak, `1–2` medium, `2–3` good, `>3` excellent) are the fallback when
  median is null. Reconciles the current 0.9/1.5/2.5 cutoffs to SOP numbers. `summary.baselines.ctrLinkMedian90`
  is threaded into `DecisionTable` as a prop.
- **Savings tooltip**: The top-3 kill savings figure and its rule code render only in a
  tooltip (Principle II), not as primary copy.
- **Paused toggle**: "إخفاء الموقوفة" toggle defaults **off** (paused shown on first load,
  per spec), filtering `visible` by paused status when enabled.

**Rationale**: Pure presentation; no engine/verdict impact. Aligns the UI with SOP §9.1 and
the constitution's "rule codes faded/in tooltips" rule.

---

## R10 — Creative factory cadence indicator

**Decision**: Compute, in `buildSummary` (or a small derived field on `AccountSummary`), the
max `createdTime` across all ad objects → days since last new ad. Thresholds: `>14d` →
visible stall warning; `>7d and ≤14d` → softer reminder; `≤7d` → nothing; **no creation date
known** → neutral "unknown" message (never a false 0 or huge number). Account-level only,
never attached to a verdict.

**Rationale**: `NormalizedObject.createdTime` is already fetched. This is a derived display
signal, not a rule — keeps it out of the verdict pipeline (Principle VI/I).

---

## Summary of resolved unknowns

| Unknown | Resolution |
|---------|------------|
| Scheduling mechanism | Project-level Heartbeat cron → `/api/scheduled/dailyRefresh` (R5) |
| Notification channel | `notifyOwner()` existing helper (R8) |
| History write granularity | Transitions-only (R6, per clarification) |
| Daily-job account scope | User-selected + active connection only (R5, per clarification) |
| Objective inheritance | Backfill children from campaign map (R2) |
| Diagnosis shape | `Finding[]` collector, account_alert/account_funnel_cta in summary (R1) |
| Budget units/min | Minor units ×100, block sub-minimum (R7) |
| Filter/footer math | Client-side, weighted ratios from summed raw components (R3, R4) |
