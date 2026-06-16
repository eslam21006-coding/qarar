# Polish Phase Report — T063–T066

> **Scope**: T063 (manual demo flows, 15 items), T064 (sanity + audit), T065 (Arabic copy review), T066 (constitution compliance).
> **Caveat for T063**: I cannot open a browser from this CLI environment. T063 items are **code-verified** by direct file reading and data-path tracing, not visually confirmed. A human pass is still required for visual correctness.
> **Date**: 2026-06-16
> **Branch**: `qarar-fixes` @ `af09a79` (HEAD = remote)

---

## T063 — Manual demo flows (15 items)

> All items are code-verified, not browser-verified. Status reflects code-path confidence; a human must still click through the running app.

### T063.1 — Today's decisions panel shows top-3 cards
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `client/src/pages/Dashboard.tsx:254` passes `actions={summary.top_3_actions}` to `<TodayActions>`. The component renders the array length-3 list. `summary.top_3_actions` is built in `server/engine.ts` (kill-first ordering per `engine.test.ts:175-186`).
- **Caveat**: Confirm visually that 3 cards fit on first screen and that the verdict badge / rule-code tooltip is the muted style described in `T065`.

### T063.2 — Clicking a card focuses that object in the table
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `Dashboard.tsx:57-60` defines `focusObject(name)` which calls `setQ(name)` (or `setTableSearch`). `DecisionTable.tsx:407` treats a non-empty query as `isSearching = true` and line 410 sets `list = rows` (all levels). The matched row is then drillable via the existing row click handler at `DecisionTable.tsx:927-931`.
- **Caveat**: Search filters by **name** (substring), not by exact id. If two objects share a name prefix, the user may need to disambiguate. Acceptable per spec.

### T063.3 — Cross-level search
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `DecisionTable.tsx:407-410` — any active search/filter/verdict causes `list = rows` (all levels). `DecisionTable.tsx:951-955` renders `<LEVEL_LABELS_AR[r.level]>` pill on each row when `showLevelPill` is true. The pill text is RTL-friendly and numbers stay LTR via the `.num` class.
- **Caveat**: Drill-down still requires the user to click the row (`DecisionTable.tsx:927-931`).

### T063.4 — Account-level CPM banner
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `Dashboard.tsx:166-179` renders `summary.account_alert` only when truthy. The alert is populated in `engine.ts` `buildSummary` when `cpmNow > cpmAvg14 × 1.3` and 3-day spend > $50. Demo fixture `cmp_scale` has a high CPM so the banner should render in demo mode.
- **Caveat**: Demo load uses `buildDemoSnapshot` (deterministic, no live data). The banner is fixed-on for demo if the fixture's CPM math triggers; confirm visually.

### T063.5 — Diagnosis with multiple findings, primary bolded
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `Dashboard.tsx:582-583` maps over `r.findings` and renders one `<FindingRow>` each. `FindingRow:595-602` uses `finding.primary ? "font-bold text-foreground" : "opacity-60 text-muted-foreground"` and prepends a star `★` to the primary. `diagnose()` in `engine.ts:595-684` marks the first finding as `primary: true`.
- **Caveat**: The non-primary findings are dimmed (60% opacity). Confirm visually that this reads as "supporting" rather than "hidden".

### T063.6 — Step-5 / W5 booking button
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**:
  - Per-finding button: `Dashboard.tsx:604-614` renders `<Button asChild>` with `href={finding.ctaUrl}` when truthy.
  - Account-level card: `Dashboard.tsx:555-562` renders the prominent card from `summary.account_funnel_cta` with the same URL.
  - URL constant: `server/engine.ts:593` `const DISCOVERY_CALL_URL = "https://eslamsalah.com/team-discovery-call"`.
  - Tests: `server/engine.test.ts:326` asserts step-5 ctaUrl; `engine.test.ts:329-340` asserts campaign W5 sets `account_funnel_cta`.

### T063.7 — Paused object shows paused message
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `engine.ts:88-96` — the **first** branch in `gateVerdict` checks `effectiveStatus !== "ACTIVE"` and returns `too_early` with `reason: "هذا الإعلان موقوف الآن — لا يصرف ولا يجمع بيانات"` and `action: "شغّله إن أردت تقييمه، أو احذفه إن لم تعد تحتاجه"`. The arithmetic-vs-2000 path is bypassed for paused objects by this early return.
- **Caveat**: Confirm the diagnosis/footer for a paused row in the demo shows this exact Arabic message and **not** "needs 2,000 more".

### T063.8 — Impressions column selectable + shows values
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `DecisionTable.tsx:192` `impressions` is a column. `DecisionTable.tsx:705-715` is a `DropdownMenuCheckboxItem` per column; `toggleCol` flips membership in `visibleCols` (persisted in `localStorage["qarar_columns_v1"]` at `DecisionTable.tsx:196`). Row cell at `534-535`, footer cell at `495-496` use `num()` which goes through `toLocaleString("en-US")` (LTR-friendly).
- **Caveat**: Default visibility is whatever's in `localStorage` from last session; if the column was previously hidden it stays hidden.

### T063.9 — Filter builder — verdict + spend
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**:
  - Toolbar button: `DecisionTable.tsx:668-693` "فلتر" toggle; `showFilters || hasFilters` switches the variant.
  - Filter UI: `DecisionTable.tsx:721+` opens a panel with join (AND/OR), per-rule row, add/remove buttons.
  - Verdict filter: enum in `lib/filters.ts:50`.
  - Spend filter: numeric `>=`/`<=`/`between` in `lib/filters.ts:55`.
  - Aggregator: `aggs` populated in `DecisionTable.tsx:399-403`; `applyFilters` consumes it.
  - Tests: `client/src/lib/filters.test.ts:9 tests` and `07f4eed` between-operator edge case.

### T063.10 — Column totals footer with LP rate
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `<tfoot>` at `DecisionTable.tsx:478-485` renders `totals`; `aggregate.ts` exports `aggregateTotals` with raw-sums + recomputed ratios including `lpRate`. `DecisionTable.tsx:493-494` `case "lpRate"` returns `pct(totals.lpRate, 0)`. Test `bb50001` strengthens the lpRate=0 boundary.
- **Caveat**: Confirm footer renders both the impressions total and the LP view % on the same row in demo.

### T063.11 — S1 ad in promotion list with Post ID copy
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `Dashboard.tsx:623-656` `PromotionList` renders rows where `r.promotion_eligible && r.promotion_note`. `ad_s1` is S1-eligible per `engine.test.ts:108`. Copy in `engine.ts` (`decayMap` + `continueRules` S1 branch) contains "Post ID", "انسخ", and the test→scale rationale. Tests: `engine.test.ts:111-119`.
- **Caveat**: Demo `ad_s1` has name "كريتف #9 — وجه مباشر: اعتراض السعر" (contains "كريتف" — see T065 jargon flag below).

### T063.12 — Creative-factory cadence indicator for demo
- **Status**: ⚠️ **FLAG** (code-verified, design behavior needs human confirmation)
- **Evidence**: `engine.ts:933-970` `computeCadence`:
  - `daysSinceLast > 14` → `state: "stall"` (red)
  - `daysSinceLast > 7` → `state: "reminder"` (amber)
  - else → **returns `null`** (i.e. healthy, no banner)
- Demo's newest ad is `dateStr(1)` (1 day old, `server/demo.ts:203` `ad_gate`), so `daysSinceLast = 1` → **null → no indicator rendered**.
- **Caveat**: This is **by design** ("absent = healthy"), but a human reviewer might expect a positive "ok" badge when cadence is healthy. If the spec wants an explicit "ok" badge, this is a UX gap. Confirm with the user.

### T063.13 — ±20% budget buttons with confirmation
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `DecisionTable.tsx:1034-1058` renders the `+20%` and `−20%` buttons (title-attribute guidance). Click sets `budgetRow` state. `DecisionTable.tsx:1142-1195` is the `<AlertDialog>` that shows the current → next diff and explanatory copy, then `caller.control.setBudget` is invoked. Demo branch short-circuits and toasts "محاكاة تجريبية" (`DecisionTable.tsx:349`).
- **Caveat**: Buttons only render when `r.daily_budget !== null` (line 1034, 989). Confirm that ads without an explicit daily budget don't show the buttons in the demo.

### T063.14 — Verdict history icon → timeline dialog
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**: `DecisionTable.tsx:46` imports `History` from `lucide-react`. `DecisionTable.tsx:973-983` click handler sets `setHistoryRow(r)`. `DecisionTable.tsx:1200-1205` renders `<VerdictHistoryDialog row={historyRow} onOpenChange={…}>`. The dialog component (`client/src/components/VerdictHistoryDialog.tsx:50+`) calls `trpc.history.getForObject` and renders the timeline.
- **Caveat**: Confirm the icon is visible on every row (it's in the action cell, line 977-982). Verify the date formatting renders in Arabic (`VerdictHistoryDialog.tsx:36` month names array).

### T063.15 — Hide-paused toggle
- **Status**: ✅ **PASS** (code-verified)
- **Evidence**:
  - State: `hidePaused` default `false`.
  - Button: `DecisionTable.tsx:667-680` `<Eye>` icon, `aria-pressed={hidePaused}`, label flips between "إخفاء الموقوفة" / "إظهار الموقوفة".
  - Filter: `DecisionTable.tsx:422` `if (hidePaused) list = list.filter(r => !isPaused(r))`.
  - Predicate: `isPaused` (line 547) uses `s?.effectiveStatus ?? s?.status ?? r.status` — consistent with T027/T030.
  - Dep array: `hidePaused` included at line 425.
- **Caveat**: When `hidePaused` is on and the user has no paused rows, the table may look "empty" but the toolbar stays visible. Confirm the empty-state message is reasonable.

---

## T064 — Sanity + audit

### T064.1 — `npm run check`
- **Status**: ✅ **PASS**
- **Output**: `tsc --noEmit` completed with no errors.

### T064.2 — `npm test`
- **Status**: ✅ **PASS**
- **Counts**: **75 passed**, 11 skipped (env-gated — `server/isolation.test.ts` 9 tests + `server/metaCredentials.test.ts` 2 tests), 0 failed. Test files: 8 passed, 2 skipped, 0 failed.

### T064.3 — Grep for extra verdict strings
- **Status**: ✅ **PASS**
- **Result**: Only the five strings `kill`, `watch`, `continue`, `rescue`, `too_early` appear in `server/**/*.ts`. Found 83 hits across `engine.ts`, `engine.test.ts`, `dailyRefresh.ts`, `dailyRefresh.test.ts`, `isolation.test.ts`, `routers.ts`. No additional verdict values. Type definition `Record<Verdict, number> = { kill: 0, watch: 0, continue: 0, rescue: 0, too_early: 0 }` at `server/engine.ts:990`.

### T064.4 — Engine evaluation order matches the original
- **Status**: ❌ **FAIL** (deviation from SOP comment order)
- **Spec'd original** (per user prompt and SOP comment in `server/engine.ts:60-72`):
  1. Data gates
  2. Circuit breaker
  3. Kill rules K1–K7
  4. Starved-ad matrix
  5. 72-hour decay map
  6. Fatigue signals
  7. Watch
  8. Continue/Scale
- **Actual `evaluateAd` order** (`server/engine.ts:760-792`):
  1. `killK3` (moved to top — fires at 1,500 imp + CTR < 0.5%)
  2. `starvedAdMatrix` (moved to top, **before** gates)
  3. `gateVerdict` (gates — moved from position 1 to position 3)
  4. *(circuit breaker is adset-level only; not in `evaluateAd`)*
  5. `decayMap`
  6. `fatigueSignals`
  7. `watchRules`
  8. `continueRules`
- **Actual `evaluateAdset` order** (`server/engine.ts:794-818`):
  1. `circuitBreaker` (CB first)
  2. `gateVerdict`
  3. `killRulesAdset` (K1, K2, K4, K5-at-adset-level)
  4. `watchRules`
  5. `continueRules`
- **Code comments** (`engine.ts:766-768` and surrounding) document the deliberate re-ordering: "Starved-ad matrix (K5) — evaluated BEFORE the generic data gates: الإعلان المحروم من الصرف لا يُحكم عليه بالـ CPA" and "K3 explicit kill allowed even at low sample".
- **Action**: Decide whether to (a) **revert** the order to match the SOP comment literally, or (b) **update the SOP comment** to match the current deliberate order. Both branches are defensible; pick one and commit.

---

## T065 — Arabic copy review

### T065.1 — Files containing user-facing copy
- **Status**: ✅ **PASS** (all files identified and reviewed)
- **Files**:
  - `client/src/pages/Dashboard.tsx`
  - `client/src/pages/Home.tsx`
  - `client/src/pages/Settings.tsx`
  - `client/src/pages/Legal.tsx`
  - `client/src/components/DecisionTable.tsx`
  - `client/src/components/VerdictHistoryDialog.tsx`
  - `client/src/components/Verdict.tsx`
  - `client/src/lib/format.ts`
  - `client/src/index.css` (style rules, no copy)
  - `shared/qarar.ts` (RULES catalog)

### T065.2 — Egyptian colloquial: شم، هد، طح، ليشيب، ناشع، ول
- **Status**: ✅ **PASS** (no colloquial detected)
- **Result**: No matches for `شم` / `هد` / `طح` / `ليشيب` / `ناشع` as standalone tokens in the reviewed files. The pattern `ول` is a 2-char substring that matches hundreds of unrelated words (`دول`, `أول`, `يوليو`, `يول`) and is not a meaningful search.

### T065.3 — Transliterated English jargon
- **Status**: ❌ **FAIL** (6 instances across 3 files + 4 demo-data names)
- **Spec-banned list**: توكن، كريتف، هوك، كونسبت

| Word | Location | Visible? | Severity |
|---|---|---|---|
| **التوكن** | `client/src/pages/Dashboard.tsx:44` — toast: "انتهت صلاحية التوكن — أعد توصيل حساب ميتا" | ✅ toast | ❌ jargon — should be "الرمز" or "مفتاح الوصول" |
| **التوكن** | `client/src/pages/Home.tsx:242` — toast: "انتهت صلاحية التوكن — أعد التوصيل" | ✅ toast | ❌ jargon |
| **التوكن** | `client/src/pages/Home.tsx:270` — disconnect dialog: "(التوكن، الإعدادات، الكاش)" | ✅ dialog | ❌ jargon |
| **التوكن** | `client/src/pages/Legal.tsx:71` — "توكنات الوصول لميتا" | ✅ legal | ❌ jargon |
| **التوكن** | `client/src/pages/Legal.tsx:81` — "حذف التوكن المشفّر" | ✅ legal | ❌ jargon |
| **كاش** (cache) | `client/src/pages/Home.tsx:270` — "(التوكن، الإعدادات، الكاش)" | ✅ dialog | ❌ jargon — should be "الذاكرة المؤقتة" |
| **كاش** | `client/src/pages/Legal.tsx:75` — "تُخزَّن مؤقتًا (كاش)" | ✅ legal | ❌ jargon |
| **كريتف** (demo ad name) | `server/demo.ts:140` — "كريتف #11 — شهادة عميلة" | ✅ UI ad-name column | ❌ jargon in demo data |
| **كريتف** (demo ad name) | `server/demo.ts:201` — "كريتفات الأسبوع الجديدة" | ✅ UI ad-name column | ❌ jargon |
| **كريتف** (demo ad name) | `server/demo.ts:211` — "كريتف #19 — كاروسيل أرقام" | ✅ UI ad-name column | ❌ jargon |
| **كريتف** (demo ad name) | `server/demo.ts:250` — "كريتف #5 — الرابح القديم (21 يوم)" | ✅ UI ad-name column | ❌ jargon |

- **Action**: Replace all 7 instances of "التوكن"/"كاش"/"كريتف" in user-facing strings with MSA equivalents. Demo ad names are the only non-source-of-truth copy but they are visible in the UI and must be cleaned to match the spec.

### T065.4 — Rule codes appear only faded in tooltips
- **Status**: ✅ **PASS**
- **Evidence**:
  - `client/src/components/Verdict.tsx:30` comment: "The internal rule code (K1, W5...) appears only faded inside the tooltip".
  - `shared/qarar.ts` RULES type has no `code` field; only `titleAr` and `defAr`. UI looks up `RULES[a.rule]?.titleAr` (Dashboard.tsx, T061 tooltip), never the raw code as primary copy.
  - `DecisionTable.tsx` column "Rule" is ad-level only and the rendered cell uses the muted `VerdictBadge` style.

### T065.5 — Numbers render LTR inside the RTL layout
- **Status**: ✅ **PASS**
- **Evidence**:
  - `client/src/index.css:166-169` — `.num { direction: ltr; }` applied to all numbers, metrics, and rule codes.
  - `client/src/lib/format.ts:5, 10` — `toLocaleString("en-US", ...)` for all numeric formatting.
  - `client/src/components/VerdictHistoryDialog.tsx:115` — `dir="ltr"` on the date column.
  - `client/src/pages/Settings.tsx:428` — `dir="ltr"` on the period string.

---

## T066 — Constitution compliance sweep

### T066-I — Engine evaluation order unchanged
- **Status**: ❌ **FAIL**
- **Detail**: See **T064.4** above. The order has been deliberately re-ordered in `evaluateAd` (K3 first; starved before gates) and is documented as such in code comments. This is a deviation from the literal SOP comment in `server/engine.ts:60-72`. Resolve by reverting order or updating the SOP comment to match.

### T066-II — Rule codes only faded in tooltips, never primary copy
- **Status**: ✅ **PASS**
- **Detail**: See **T065.4**. Verified at `client/src/components/Verdict.tsx:30`, `shared/qarar.ts` RULES catalog (no `code` field), and the muted `VerdictBadge` style.

### T066-III — All user-facing copy simple Arabic; no colloquial / jargon
- **Status**: ❌ **FAIL** (jargon, see T065.3)
- **Detail**: 5 instances of "التوكن" + 2 instances of "كاش" + 4 demo ad names with "كريتف" remain in user-facing strings. No Egyptian colloquial detected. Action: replace with MSA equivalents per the table in T065.3.

### T066-IV — Every DB query scoped by `userId`
- **Status**: ✅ **PASS**
- **Evidence**:
  - `metaConnections`: `getConnection(userId)` (`db.ts:105, 111`), `deleteConnection(userId, id)` (`:142, 150`).
  - `adAccounts`: `listAccounts(userId)` (`:168, 171`), `getAccount(userId, id)` (`:190, 196`), `addAccount(userId, ...)` (`:202, 211, 227`), `selectAccount(userId, id, selected)` (`:240, 246`), `ensureDemoAccount(userId)` (`:249, 255, 271`).
  - `funnelSettings`: `getFunnel(userId, adAccountId)` (`:280, 287`), `upsertFunnel(userId, ...)` (`:294, 306, 311`).
  - `snapshots`: `getLatestSnapshot(userId, adAccountId)` (`:322, 328`), `saveSnapshot(userId, ...)` (`:335, 346, 348`).
  - `actionChecks`: `deleteAllUserData(userId)` includes (`:159`).
  - `verdictHistory`: `recordVerdicts(userId, adAccountId, ...)` (`:420`) and `getVerdictHistory(userId, adAccountId, objectId)` (`:477`).
  - `dailyRefresh.ts:141, 174, 176, 237` all pass `userId`.
  - All routers (`routers.ts:64, 123, 143, 175, 334, 496`) use `ctx.user.id`.
  - Isolation tests cover cross-user privacy: `server/isolation.test.ts:80, 85, 138, 184, 189, 222-249`.

### T066-V — Meta writes only for pause/resume + budget, with confirmation dialogs
- **Status**: ✅ **PASS**
- **Evidence**:
  - **Only two write functions exist in `server/meta.ts`**: `setObjectStatus` (line 128) and `setDailyBudget` (line 154). No other Meta write operations.
  - `routers.ts:389` calls `setObjectStatus` from the pause/resume mutation; `routers.ts:458` calls `setDailyBudget` from the budget mutation.
  - **Pause/resume confirmation dialog**: `DecisionTable.tsx:1080-1135` `<AlertDialog>` with "تشغيل"/"إيقاف" copy and confirmation button.
  - **Budget confirmation dialog**: `DecisionTable.tsx:1142-1195` `<AlertDialog>` with current → next budget diff, "+20% كل 48-72 ساعة" / "-20% يحافظ على مرحلة تعلّم الخوارزمية" copy.
  - **Rate-limit and below-minimum guards**: `routers.ts` maps `BUDGET_BELOW_MINIMUM` and `BUDGET_DELTA_OUT_OF_RANGE` to user-facing toasts (e.g. `DecisionTable.tsx:359`).

### T066-VI — Verdict set exactly five
- **Status**: ✅ **PASS**
- **Detail**: `server/engine.ts:990` `Record<Verdict, number> = { kill: 0, watch: 0, continue: 0, rescue: 0, too_early: 0 }`. Grep across `server/**/*.ts` confirms no additional verdict strings. The `Verdict` type in `shared/qarar.ts` enumerates the same five values.

### T066-VII — Funnel CTA URL = `https://eslamsalah.com/team-discovery-call`
- **Status**: ✅ **PASS**
- **Evidence**:
  - **Constant**: `server/engine.ts:593` `const DISCOVERY_CALL_URL = "https://eslamsalah.com/team-discovery-call"`.
  - **Engine wiring**: `engine.ts:236` (action copy on K3 includes the URL), `engine.ts:1094` (sets `summary.account_funnel_cta` when any step-5/6 or W5 fires).
  - **Client rendering**: `Dashboard.tsx:555-562` (account-level card), `Dashboard.tsx:604-614` (per-finding ctaUrl button).
  - **Type contract**: `shared/qarar.ts:306` `account_funnel_cta: { reason_ar: string; ctaUrl: string } | null`.
  - **Tests**: `server/engine.test.ts:326` asserts step-5 ctaUrl, `:338-340` asserts campaign W5 sets `account_funnel_cta.ctaUrl`.

---

## Summary

| Task | Sub | Status | Items needing action |
|---|---|---|---|
| T063 | 1–11, 13–15 | ✅ PASS (code-verified) | none |
| T063 | 12 (cadence indicator) | ⚠️ FLAG | confirm "absent = healthy" is the intended UX or add an "ok" badge |
| T064 | 1–3 | ✅ PASS | none |
| T064 | 4 (engine order) | ❌ FAIL | revert order OR update SOP comment |
| T065 | 1, 2, 4, 5 | ✅ PASS | none |
| T065 | 3 (jargon) | ❌ FAIL | replace 7 instances of التوكن/كاش/كريتف |
| T066 | II, IV, V, VI, VII | ✅ PASS | none |
| T066 | I (engine order) | ❌ FAIL | same as T064.4 |
| T066 | III (jargon) | ❌ FAIL | same as T065.3 |

**Blocking issues before sign-off** (3):

1. **Engine evaluation order** (T064.4 / T066-I) — pick: revert to spec order, or update the SOP comment to match the current deliberate order.
2. **7 instances of transliterated jargon** (T065.3 / T066-III) — replace "التوكن" × 5, "كاش" × 2, "كريتف" × 4 (demo data).
3. **Cadence indicator UX** (T063.12) — confirm with the user whether a positive "ok" badge should appear or "absent = healthy" is the intended design.

**Non-blocking** (still recommended): T063 items 1–11, 13–15 should still get a human visual pass to catch any layout/style regressions missed in the code review.
