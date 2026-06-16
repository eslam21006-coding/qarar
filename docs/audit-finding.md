# Qarar — Implementation Spec

**Author:** engineering audit · **Target:** the developer/agent making the changes
**Source of truth for rules:** `محرك-القرار-الإعلاني-v2.1.md` (the SOP). Rule codes (K1, W3…) must appear verbatim in engine output. All user-facing copy stays simple Arabic, ≤6th-grade, no jargon, no colloquial slang. Verdict emoji set is fixed: 🔴 🟡 🟢 🛟 ⏳.

This spec covers six reported problems plus a UX pass and the three requested next-steps. Each task lists **exact files + line anchors**, the **change**, and **how it's verified**. Tasks are ordered so that shared prerequisites (data plumbing, type changes) land before the UI that depends on them.

A guiding principle for the whole job: **the data the UI needs is almost all already in `rows`/`series`; most bugs are wiring, not missing computation.** The one true architectural fix is the diagnosis engine (Task 6). Do that one carefully.

---

## Phase 0 — Prerequisites (data + types). Do these first.

### Task 0.1 — Fetch `objective` end-to-end (unblocks Task 4)

`objective` is never fetched, so objective filtering cannot exist until it flows through three layers.

1. **`server/meta.ts`, `fetchHierarchy`, campaign fields (~line 290).**
   Add `objective` to the campaign field list:
   ```
   fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,created_time",
   ```
2. **`server/meta.ts`, `buildSnapshot`, campaign object (~lines 416–434).**
   Add `objective: c.objective ?? null,` to the pushed campaign object.
3. **`shared/qarar.ts`, `NormalizedObject` (lines 155–178).**
   Add `objective?: string | null;`
4. **`shared/qarar.ts`, `EngineRow` (lines 238–264).**
   Add `objective: string | null;`
5. **`server/engine.ts`, `toRow` (~lines 772–798).**
   Add `objective: o.objective ?? null,`

**Objective inheritance:** objective exists only at campaign level. Ad-set/ad rows must resolve it from their campaign. In `runEngine` after rows are built, backfill child rows: for each adset/ad row, set `objective` from the campaign row with matching `campaignId` if the child's own is null. (Cheap: build a `Map<campaignId, objective>` from campaign rows, then patch.)

**Verify:** demo + real snapshot; every row has a non-null `objective` once a campaign objective exists. Add a test asserting an ad row inherits its campaign's objective.

---

### Task 0.2 — Surface `impressions` as a column (unblocks Task 5a clarity)

`EngineRow.impressions_3d` already exists (line 248) but isn't selectable.

1. **`client/src/components/DecisionTable.tsx`, `ColKey` (lines 160–172).** Add `"impressions"`.
2. **`ALL_COLUMNS` (174–187).** Add `{ key: "impressions", label: "Impressions" }` (place after `spend`).
3. **`Agg` (87–99) + `aggFromWindow` (101–121) + `aggregate` (123–157).** `Agg` already carries `impressions`. No math change; it's summed correctly already.
4. **`cellValue` (362–390).** Add `case "impressions": return num(a?.impressions ?? 0);`
5. **`cellClass` (392–399).** No special color for impressions (return `""`).

**Verify:** toggle Impressions on; values match Ads Manager for the selected range; footer total (Task 3) sums correctly.

---

## Phase 1 — The six reported problems.

### Task 1 — Search must find objects at any drill-down level (Problem 1)

**Root cause:** in `DecisionTable.tsx` the `visible` memo (lines 303–315) filters by the current `level` *first*, then applies the name query. The table opens at `level === "campaign"`, so searching an ad-set name filters a campaign-only list → no matches.

**Change A — global search when a query/filter is active.**
In the `visible` memo, when `q.trim()` is non-empty (and/or verdict filters are active), search across **all** `rows`, not just the current level. Concretely:

```ts
const visible = useMemo(() => {
  const hasTextOrVerdict = q.trim() !== "" || verdicts.size > 0;
  let list: EngineRow[];
  if (hasTextOrVerdict) {
    // Cross-level search: ignore drill-down scope so a card's ad-set name
    // is always findable from any level.
    list = rows.slice();
  } else if (level === "campaign") {
    list = rows.filter(r => r.level === "campaign");
  } else if (level === "adset") {
    list = rows.filter(r => r.level === "adset" && r.campaignId === path.campaign!.id);
  } else {
    list = rows.filter(r => r.level === "ad" && r.parentId === path.adset!.id);
  }
  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    list = list.filter(r => r.name.toLowerCase().includes(needle));
  }
  if (verdicts.size > 0) list = list.filter(r => verdicts.has(r.verdict));
  return list;
}, [rows, level, path, q, verdicts]);
```

When cross-level results are shown, render a small level pill on each row (Campaign / Ad set / Ad) so the user knows what they're looking at — otherwise mixed levels are confusing. The row already knows `r.level`; add a tiny badge next to the name (reuse existing muted-text style).

**Caveat — drill-down click on a cross-level ad row.** The row click handler (lines 605–608) only navigates for campaign/adset. For ad rows it's a no-op, which is fine. But when search is cleared, `path` should remain valid. No change needed beyond leaving ad-row clicks inert.

**Change B — top-3 cards drive the table.**
Today `TodayActions` (Dashboard.tsx 348–444) renders cards that aren't clickable. Make a card click focus the matching row.

1. **`shared/qarar.ts`, `TopAction` (266–277).** Add `parentId: string | null;` and `campaignId: string | null;`
2. **`server/engine.ts`, `buildSummary` action builders (~893–941).** Populate `parentId: r.parentId, campaignId: r.campaignId,` for each pushed action (kill/rescue/scale).
3. **State lift.** The table owns `path`/`q`. Easiest minimal approach: lift a `focusObject` callback to Dashboard. In `Dashboard`, hold `const [focus, setFocus] = useState<{id:string; level:string; parentId:string|null; campaignId:string|null}|null>(null)` and pass it to `DecisionTable` as a prop. In `DecisionTable`, a `useEffect` on `focus` sets `path` to the object's ancestors and (for an ad set/ad) drills in:
   - campaign → `setPath({campaign: row})`
   - adset → find its campaign row, `setPath({campaign, adset: row})` … actually for an ad set you want to *land on* the ad-set row inside its campaign, so `setPath({campaign})` and set `q` to the ad-set name, or scroll to it. Simplest robust behavior: **set `q` to the object name and clear level scoping** (Change A already makes it findable). So `focus` handler = `setQ(objectName); scrollToTable()`.
   - Make each card a `<button>`/clickable row that calls `setFocus({...a})`.

   The pragmatic version: clicking a card just does `setQ(a.objectName)` on the table via the lifted callback and scrolls the table into view. That reuses Change A, needs no ancestor-walking, and always works.

**Verify:** from a fresh dashboard, type any of the three top-3 ad-set names → the ad set appears. Click a top-3 card → table scrolls and shows that ad set. Add a frontend test or manual check with the demo snapshot (demo has named ad sets).

---

### Task 2 — Make the CPM "market, not your designs" claim auditable + stop it dominating

Two parts. The dominance fix is folded into Task 6 (the account-level CPM check must move out of the per-row ladder). Here, fix **auditability**: show the numbers behind the claim.

**`server/engine.ts`, `diagnosisLadder` per-ad CPM branch (lines 588–590)** already prints the ad CPM vs account average. The **account-level** message (585–587) prints no numbers. After Task 6 moves the account check to account level, render it as a banner with the figures:

> سعر الظهور على حسابك كله في آخر 3 أيام **{cpmNow}** مقابل متوسط آخر 14 يومًا **{cpmAvg14}** (أعلى بنسبة {delta}%). الغالب أن السبب السوق أو الموسم أو المنافسة — وليس تصاميمك. توقّع تكلفة أعلى مؤقتًا.

Compute `delta = round((cpmNow/cpmAvg14 - 1) * 100)`. Pull `cpmNow`/`cpmAvg14` from `summary.baselines` (already present, shared/qarar.ts 180–189). This is display-only; the numbers already exist.

**Optional accuracy hardening (note for owner, not required to ship):** the SOP wants a 7–14 day rolling **median** excluding Gulf Fri/Sat; the code uses Meta's `last_14d` **mean** (meta.ts 532–537). If you want stricter fidelity, fetch `last_14d` with `time_increment:1`, drop weekend days, take the median. Flag this as a follow-up; don't block the release on it.

**Verify:** trigger the account-CPM condition in a crafted snapshot (`cpmNow > 1.3×cpmAvg14`); banner shows both numbers and the % delta; it appears **once**, not per row (that's Task 6's assertion).

---

### Task 3 — Column totals footer with type-correct aggregation (Problem 3)

**Root cause:** no `<tfoot>`. The correct weighted-ratio math already exists in `aggregate()` (123–157) — reuse the pattern; never average rates.

1. **Add a totals computation in `DecisionTable.tsx`.** Write `aggregateTotals(visibleRows, seriesMap, range, from, to)` that re-walks the same windows `aggregate()` uses and accumulates **raw** components across all visible rows:
   - sum: `spend`, `impressions`, `clicks`, `linkClicks`, `results(conversions)`, `lpViews`, `videoViews3s`, `thruplays`
   - then recompute ratios from sums:
     - `cpa = results>0 ? spend/results : null`
     - `ctrLink = imps>0 ? linkClicks/imps*100 : null`
     - `ctrAll = imps>0 ? clicks/imps*100 : null`
     - `cpm = imps>0 ? spend/imps*1000 : null`
     - `cpc = linkClicks>0 ? spend/linkClicks : null`
     - `lpRate = linkClicks>0 ? lpViews/linkClicks*100 : null`
     - `hookRate = imps>0 && v3>0 ? v3/imps*100 : null`
     - `holdRate = v3>0 && tp>0 ? tp/v3*100 : null`
   - `spendShare`, `frequency`: leave blank in footer (`—`). Spend-share trivially sums to ~100% and frequency can't be summed meaningfully.

   Implementation note: rather than duplicate the day-walk, refactor `aggregate()` to optionally return the raw sums too (e.g. add an internal `rawSums(s, range, from, to)` helper that both `aggregate` and `aggregateTotals` call). DRY and avoids drift.

2. **Render `<tfoot>`** after `</tbody>` (after line 697). One row:
   - first cell: `الإجمالي ({visibleRows.length})`
   - one cell per `activeCols` using the footer agg, formatted exactly like body cells (reuse `cellValue` formatting by passing a synthetic row, or inline the same `money/num/pct` calls)
   - verdict + reason + control columns: empty cells
   - style: `border-t-2`, slightly bolder, sticky-bottom optional.

3. **Footer must respect filters.** It aggregates `visible` (post-filter, post-search), not all rows — so totals reflect what the user is looking at. Use the same `visible`/`sorted` source.

**Verify:** sum of Spend column equals footer Spend; footer CTR equals Σlinkclicks/Σimps (NOT the mean of row CTRs — test this explicitly with two rows of very different impression volumes); ratios show `—` when denominators are zero.

---

### Task 4 — Meta-style filter builder: name OR objective, multi-condition (Problem 4)

Depends on Task 0.1 (objective).

**`client/src/components/DecisionTable.tsx`.** Replace the single name input + verdict chips with a composable filter system. Keep it client-side over `rows` (composes with everything already built).

**Data model:**
```ts
type FilterField = "name" | "objective" | "verdict" | "status" | "level"
                 | "spend" | "impressions" | "cpa" | "ctrLink" | "cpm";
type TextOp = "contains" | "is" | "is_not";
type NumOp = ">=" | "<=" | "between";
interface FilterRule {
  id: string;
  field: FilterField;
  op: TextOp | NumOp;
  value: string;          // for text/enum
  value2?: string;        // for "between"
}
const [filters, setFilters] = useState<FilterRule[]>([]);
const [filterJoin, setFilterJoin] = useState<"AND" | "OR">("AND"); // Meta supports both
```

**UI:** a "فلتر" dropdown (reuse shadcn `DropdownMenu` already imported) that adds a rule row: field `<select>` → operator `<select>` (operators depend on field type) → value input (text input, enum `<select>` for verdict/status/level, or two number inputs for `between`). Show active filters as removable chips. Provide an AND/OR toggle. Keep the existing verdict chips as a fast-path shortcut that writes into `filters` (or keep both; chips are nice UX).

**Field metadata:** map each field to type:
- text: `name`, `objective`
- enum: `verdict` (5 values), `status` (ACTIVE/PAUSED), `level` (campaign/adset/ad)
- numeric: `spend`, `impressions`, `cpa`, `ctrLink`, `cpm` (read from the per-row `aggs`, so they respect the selected date range)

**Predicate** in the `visible` memo (after Task 1's changes): reduce `filters` against each row. For numeric fields pull the value from `aggs.get(r.id)`; for `objective` use `r.objective` (string contains/equals); for enum compare directly. Combine with `filterJoin`. Keep the free-text quick search (`q`) working *in addition* — treat empty `filters` as "match all" so `q` alone still works.

**Localized labels** for fields/operators in simple Arabic (الاسم / الهدف / الحكم / الحالة / المستوى / الصرف / المشاهدات / تكلفة العميل / نسبة النقر; يحتوي / يساوي / لا يساوي / أكبر من أو يساوي / أصغر من أو يساوي / بين).

**Verify:** filter `objective is OUTCOME_LEADS AND spend >= 100` returns the right rows; OR mode broadens; clearing filters restores all; date-range change re-evaluates numeric filters (because they read `aggs`).

---

### Task 5a — Fix the "needs 2,000 more views" message for paused objects (Problem 5a)

**Root cause:** the subtraction *is* implemented (engine.ts 94–98: `Math.max(0, 2000 - o.w3d.impressions)`). The flat "2,000" appears because paused ads have **0 impressions in the last 3 days**, so `2000 − 0 = 2000`. The math is right; the message is wrong **for paused objects** — a paused ad can never gather more views, so "leave the data to gather" is nonsensical.

**Change — branch on delivery status in `gateVerdict` (engine.ts 81–103).**
`effectiveStatus` is available on `NormalizedObject` (shared/qarar.ts 175) but `gateVerdict` only receives the object — pass/inspect it. At the top of `gateVerdict`, before the age/impression gates:

```ts
const isActive = (o.effectiveStatus ?? o.status) === "ACTIVE";
if (!isActive) {
  return {
    verdict: "too_early",        // or introduce a dedicated paused state — see note
    rule: "GATE",
    reason: "هذا الإعلان موقوف الآن — لا يصرف ولا يجمع بيانات",
    action: "شغّله إن أردت تقييمه، أو احذفه إن لم تعد تحتاجه",
  };
}
```

**Note on verdict choice:** keeping it `too_early`/⏳ is acceptable and won't break the gate test (Task 7). If the product wants paused objects visually distinct, the cleaner option is to **not surface a verdict at all for paused rows** and instead show a "موقوف" chip (the table already renders one, DecisionTable 645). Recommended: keep `too_early` verdict for engine simplicity but ensure the message is the paused-specific copy above, and rely on the existing "موقوف" badge for the visual. Don't add a new Verdict enum value — that would ripple through `VERDICT_META`, counts, colors, and tests.

**Also:** the generic pre-gate message (lines 95–100) is correct for *active* low-volume ads. Leave it, but it's now only reachable for active objects.

**Verify:** a paused ad shows the paused message, not "needs 2,000 more views"; an active ad with 300 impressions shows "needs 1,700 more views"; impressions column (Task 0.2) shows the underlying number so the user can see why.

---

### Task 6 — The big one: diagnosis engine must report all problems per entity + surface funnel/offer + add the discovery-call CTA (Problems 2 & 5b)

This is the core architectural fix. Problems 2 and 5b are the same flaw: `diagnosisLadder` (engine.ts 576–618) is a chain of `if (...) return`, and its **first** rung is an **account-wide** CPM check (585–587) that uses only `baselines` — identical for every row — so every 🔴/🟡 unit returns the same "market, not your designs" line and the ladder never reaches the offer/funnel rungs (W3 / level-5 / level-6), which are the path to the call.

**The CTA `eslamsalah.com/team-discovery-call` does not exist anywhere in the codebase. It was never built.** This task builds it.

#### 6.1 — Move the account-level CPM finding OUT of the per-row ladder

- Delete lines 585–587 (the account-wide block) from `diagnosisLadder`. The function now starts at the **per-ad** CPM rung (588). Each row reports *its own* bottleneck.
- Compute the account-CPM finding **once** in `runEngine`/`buildSummary`. Add to `AccountSummary` (shared/qarar.ts 279–289) a field:
  ```ts
  account_alert: { kind: "cpm_market"; reason_ar: string } | null;
  ```
  Populate it in `buildSummary` when `baselines.cpmAvg14 && baselines.cpmNow && baselines.cpmNow > 1.3 * baselines.cpmAvg14`, using the numbers-included copy from Task 2.
- Render it as a single banner in `Dashboard.tsx` (near the attribution banner, ~143) — one finding, account-wide.

#### 6.2 — Collect ALL broken rungs per entity, not just the first

Refactor `diagnosisLadder` to return a structured result instead of one string:

```ts
export interface Finding {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  text_ar: string;
  primary: boolean;      // first broken rung = where to fix
  ctaUrl?: string;       // set on funnel/offer findings (step 5/6)
}
export function diagnose(o, baselines, archetype): Finding[] { ... }
```

- Evaluate every rung (ad-CPM, Link-CTR/hook, CTR-All-vs-Link mismatch, LP-view-rate, page-CVR, post-conversion). Push a `Finding` for each that is broken. Mark the **first** pushed as `primary: true` (preserves SOP's "fix the first broken level" guidance) — the rest are "also failing," shown secondary.
- Keep the existing per-rung Arabic copy (lines 588–617) as the `text_ar` values; just stop early-returning.
- `EngineRow.diagnosis: string | null` (shared/qarar.ts 260) becomes `EngineRow.findings: Finding[]`. Keep a `diagnosis` string getter (the primary finding's text) for backward compatibility if easier, but prefer migrating the UI (6.4).

#### 6.3 — Emit funnel/offer findings with the CTA

The "ad innocent / problem is the offer or funnel" signals are the product's bridge to the program. Two sources:

- **Per-row (page CVR), step 5** — in `diagnose`, the page-CVR rung (current lines 607–614, the W3 "الإعلان بريء" pattern: Link CTR above account median + weak CVR). When it fires, set on that finding:
  ```ts
  ctaUrl: "https://eslamsalah.com/team-discovery-call"
  text_ar: "الخطوة 5 — الناس تصل لصفحتك لكن قلة تشتري — المشكلة في العرض أو الصفحة أو السعر. هذه مشكلة في الفانل، مش في الإعلان."
  ```
- **Campaign-level (HTO underperforming), W5** — `evaluateCampaign` (624–652) already detects good LTO + `htoUnderperforming` flag. Attach the same `ctaUrl` to that finding and to the campaign row's reason/action. This is the strongest "book a call" signal (the funnel converts cold→buyer but not buyer→HTO — pure offer/back-end problem).
- **Step 6 (post-conversion)** likewise gets the CTA (the ad and page are clean; the problem is nurture/sales — program scope).

**Account-level synthesis:** in `buildSummary`, if **any** row has a step-5/6 finding **or** the campaign W5 fired, add a second account-level item:
```ts
account_funnel_cta: { reason_ar: string; ctaUrl: string } | null;
```
with copy like: *"عندك إعلانات شغالة كويس بس المشكلة في العرض أو الفانل — ده اللي بيحدد نجاحك على المدى الطويل. لو عايز تحلها صح، احجز مكالمة."* + the URL. Render it as a distinct, prominent card.

#### 6.4 — Render findings (Dashboard.tsx `DiagnosisSection`, 450–484)

- Show **all** findings per row: the primary one bold/highlighted, secondaries muted beneath it.
- Any finding with `ctaUrl` renders a button: «احجز مكالمة استكشافية» linking to the URL (`target="_blank" rel="noopener noreferrer"`).
- The account-level `account_funnel_cta` card renders at the top of the section (or just below the summary strip) as the headline call-to-action.

#### 6.5 — Keep it deterministic and rule-coded

Every finding still traces to a rung/rule; the SOP's evaluation order is unchanged — you're collecting instead of short-circuiting. No new heuristics; no AI. The verdict pipeline (`evaluateAd`/`evaluateAdset`/`evaluateCampaign`) is **untouched** — only the **diagnosis** aggregation and the **account summary** change. This keeps all verdict/rule-code tests green.

**Verify:**
- Account-CPM banner appears once, never per row.
- A row failing CTR *and* page-CVR shows two findings (primary = CTR, secondary = CVR).
- A crafted "good CTR + good LP views + weak CVR" ad produces a step-5 finding **with** the CTA button.
- A campaign with `htoUnderperforming=true` + good LTO CPA shows W5 **and** the account funnel CTA card.
- The CTA URL is exactly `https://eslamsalah.com/team-discovery-call`.

---

## Phase 2 — UX correctness pass.

### Task 7 — "∞" CPA must not look like catastrophe on pre-gate rows

**`DecisionTable.tsx` `cellValue` (370)** returns `"∞"` for any zero-result row, and `cellClass` (394) + `cpaColorClass` (format.ts) paint `null` CPA red. For ⏳ too-early / pre-gate rows this reads as "disaster."

- In `cellValue` CPA case: if the row's verdict is `too_early` **or** it hasn't met the CPA gate, render `—` (or `قيد التجميع`) instead of `∞`.
- In `cellClass`: don't apply `text-v-kill` to CPA when verdict is `too_early`; use neutral.
- `money()` in format.ts also returns `"∞"` for null (line: `if (!Number.isFinite(n)) return "∞"`). Keep that for genuine zero-conversion kills, but the call site decides: pass `null`→`—` for pre-gate, keep `∞` only when the **verdict is kill on zero conversions** (K1/CB2), where "∞" correctly signals "spend with no results."

**Verify:** a too-early row shows `—` CPA in neutral color; a K1 zero-conversion kill still shows red `∞`.

### Task 8 — CTR colors must follow the SOP tiers against the account median

**`client/src/lib/format.ts` `ctrColorClass`** uses fixed bands. The SOP §9.1 says the governing rule is *beat the account's own 90-day median*; absolute tiers are guardrails. Two fixes:

- Pass the account median into the color function: `ctrColorClass(ctr, median?: number|null)`. If median is known, the key threshold (acceptable→good) keys off `ctr > median`; keep absolute bands only as fallback when median is null.
- Align absolute bands to §9.1 exactly: `<0.5` dead, `0.5–1` weak, `1–2` medium, `2–3` good, `>3` excellent. (Current code uses 0.9/1.5/2.5 cutoffs — reconcile to the SOP numbers.)
- Update the call site in `DecisionTable.tsx` `cellClass` (395) to pass `summary.baselines.ctrLinkMedian90` (thread it into the component as a prop; `unitTarget` is already passed, add `ctrMedian`).

**Verify:** with account median 1.7%, a 1.35% CTR shows below-median color, a 1.9% shows above-median; with null median, falls back to the SOP bands.

### Task 9 — Top-3 savings number must cite its rule

**`Dashboard.tsx` `TodayActions`** shows "يوفّر لك حوالي $X كل يوم" (the impact, engine.ts 908) with no basis. The card already has `a.rule`. Append the rule context subtly (the `VerdictBadge` already shows the rule code via tooltip — confirm it does; if so this is covered). If not visible, add a faded rule note so the kill recommendation is auditable, matching how the table rows show reason. Keep it faded/tooltip per the product rule ("rule codes appear faded in tooltips only").

### Task 10 — Paused-row noise

Paused objects are kept by the relevance filter (meta.ts 386–391) and, post-Task-5a, show a paused message. To reduce noise:
- Add a "إخفاء الموقوفة" toggle in the toolbar (default **on** — hide paused), filtering `visible` by `isPaused(r)`.
- Or group paused rows under a collapsible "موقوفة ({n})" section. Toggle is simpler; ship that.

**Verify:** toggle hides/shows paused rows; default view is clean.

---

## Phase 3 — The three requested next-steps.

These are additive features. Each needs a schema migration (Drizzle). Follow the existing pattern in `drizzle/schema.ts` + generated SQL in `drizzle/`.

### Next-step 1 — Daily scheduled snapshot refresh + owner notification on new 🔴

**Goal:** once a day, refresh each selected account's snapshot and notify the owner if new kill verdicts appeared since the last run.

- **Scheduling:** the repo has `server/_core/periodic-updates`/`heartbeat` references and `references/periodic-updates.md` / `references/owner-notifications.md`. Use that mechanism (read those reference docs — they define how scheduled jobs and notifications work on this platform). Do **not** hand-roll cron if the platform provides a scheduler.
- **Job logic:** for each user with `selected` accounts and an `active` connection, call `buildSnapshot` (server/meta.ts) and `saveSnapshot` (db.ts 317). Wrap in the same error handling as `dashboard.refresh` (router 291–322): on auth error mark connection expired and **notify the owner to reconnect** rather than silently failing.
- **New-🔴 detection:** after building the new snapshot, run `runEngine` on both the previous saved payload and the new one; diff the set of `kill` object IDs. For IDs newly in kill state, send an owner notification (per owner-notifications.md) summarizing count + names + estimated daily bleed (you already compute `summary.bleed_daily`).
- **Schema:** `saveSnapshot` currently **deletes** the prior snapshot before inserting (db.ts 326–328), so you can't diff against history unless you capture the previous verdict set before overwriting. Either (a) read+evaluate the old snapshot in the job before saving, or (b) persist a tiny `verdictState` row (see next-step 2's table, which you can reuse). Option (a) is simplest for this feature alone.

**Verify:** force a snapshot where an ad crosses into K1; confirm one owner notification fires; confirm no notification when nothing newly killed; confirm reconnect notification on expired token.

### Next-step 2 — Verdict history log (audit trail per object over time)

**Goal:** record each object's verdict/rule on every evaluation so the owner can see how decisions changed.

- **New table** in `drizzle/schema.ts`:
  ```ts
  export const verdictHistory = mysqlTable("verdictHistory", {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    adAccountId: int("adAccountId").notNull(),
    objectId: varchar("objectId", { length: 64 }).notNull(),
    objectName: text("objectName"),
    level: mysqlEnum("level", ["campaign","adset","ad"]).notNull(),
    verdict: varchar("verdict", { length: 16 }).notNull(),
    rule: varchar("rule", { length: 8 }).notNull(),
    cpa: double("cpa"),
    spend3d: double("spend3d"),
    ctrLink: double("ctrLink"),
    evaluatedAt: timestamp("evaluatedAt").defaultNow().notNull(),
  });
  ```
  Generate the migration (`drizzle-kit`), matching the existing `drizzle/000x_*.sql` pattern.
- **Write path:** on each `dashboard.refresh` (and the daily job), after `runEngine`, insert a history row per object (or per object whose verdict **changed** since the last logged row — cheaper, more meaningful). Add `db.recordVerdicts(userId, accountId, rows)` in `server/db.ts`.
- **Scope:** every query filtered by `userId` (hard requirement). Follow `getChecks`/`setCheck` patterns (db.ts 344–360).
- **Read/UI:** a per-object timeline (sparkline or list) reachable from a row — e.g. an icon in the table that opens a dialog showing that object's verdict transitions with dates. Keep copy simple Arabic.

**Verify:** refresh twice with a changed verdict; history shows two entries with correct timestamps; switching accounts/users never leaks rows (add an isolation test mirroring `server/isolation.test.ts`).

### Next-step 3 — Budget edit controls (±20% next to pause/resume)

**Goal:** let the owner nudge an ad-set/campaign daily budget by ±20% inline, matching the SOP's S2 "raise 20% every 48–72h" rule.

- **New write op in `server/meta.ts`** alongside `setObjectStatus` (128–147): `setDailyBudget(token, objectId, newBudgetMinorUnits)`. Meta budgets are in **minor units** (cents) — the codebase divides by 100 on read (meta.ts 424, 448). So to set, multiply by 100 and round. POST to `/{objectId}` with `daily_budget`.
- **Where budget lives:** `daily_budget` exists on campaign (CBO) or ad set (ABO). `EngineRow.daily_budget` (shared/qarar.ts 245) already carries it. Only show the control where `r.daily_budget !== null`.
- **Router:** add `control.setBudget` mutation mirroring `control.setStatus` (routers.ts 346–387): account ownership check, object-in-snapshot check, demo simulation branch, auth/permission error mapping, then reflect the new budget in the cached snapshot and `saveSnapshot`. Requires `ads_management` (already in scope, meta.ts 32).
- **UI (`DecisionTable.tsx` control cell, 676–693):** add `+20%` / `−20%` buttons next to pause/resume, each behind a confirmation dialog (reuse the existing `AlertDialog` pattern, 703–752) showing old→new budget. Compute `new = round(old * 1.2)` / `round(old * 0.8)`. On success, toast + invalidate `dashboard.get`.
- **Guardrail copy:** in the confirm dialog, echo the SOP guidance in simple Arabic ("زيادة 20% كل يومين تحافظ على تعلّم فيسبوك") for the +20% case.

**Verify:** ±20% updates the budget in Meta (and simulates in demo); confirmation shows correct old→new; control hidden where no daily budget; permission error surfaces the reconnect message.

---

## Test plan delta (which existing tests change)

Existing suite: `server/engine.test.ts`, 27 `it()` blocks. The verdict/rule pipeline is untouched, so most stay green.

**Safe (no change):** all `deriveTargets` tests; K1/K3/K4/K5/CB2/GATE/S1/F1/W1/W3 verdict assertions; W5/S3 tests; summary/bleed/top-3 ordering; the data-gate `too_early` test.

**Will need updating (because diagnosis shape changes in Task 6):**
- **"kill/watch rows always carry a diagnosis line"** — update to assert `row.findings.length >= 1` and `findings.some(f => f.primary)`.
- Any assertion reading `row.diagnosis` as a string — migrate to `row.findings`.

**New tests to add:**
- ad row inherits campaign objective (Task 0.1)
- footer CTR = Σclicks/Σimps, not mean of row CTRs (Task 3)
- objective + numeric filter predicate (Task 4)
- paused object → paused message, not "2,000 more" (Task 5a)
- account-CPM finding appears once at summary level, not per row (Task 6.1)
- a row failing two rungs returns two findings, primary flagged (Task 6.2)
- step-5/W5 findings carry `ctaUrl === "https://eslamsalah.com/team-discovery-call"` (Task 6.3)
- too-early CPA renders `—` not red ∞ (Task 7)
- `verdictHistory` isolation by userId (Next-step 2)

---

## Build order (dependency-aware)

1. **Phase 0** (objective plumbing, impressions column) — unblocks 4 and 5a-clarity.
2. **Task 6** (diagnosis engine) — the core; everything diagnostic depends on its shape. Do it early so Task 2 banner + CTA land with it.
3. **Tasks 1, 3, 5a** — independent frontend/engine fixes.
4. **Task 4** (filters) — needs Phase 0.
5. **Phase 2** (UX: 7, 8, 9, 10) — polish.
6. **Phase 3** (next-steps) — additive features with migrations; ship after the six fixes are green.

## Non-negotiables (carry into every task)

- Engine evaluation order unchanged; rule codes verbatim in output; no AI in the engine.
- All user-facing strings simple Arabic, ≤6th grade, no jargon/slang.
- Every DB query scoped by `userId`; no cross-user leakage; reads stay read-only except the explicit pause/resume and the new budget write (both `ads_management`, both behind confirmation).
- Verdict emoji set fixed: 🔴 🟡 🟢 🛟 ⏳. Don't add a new verdict for "paused."
- Reading is from cache; Meta is hit only on explicit refresh and the daily job.
