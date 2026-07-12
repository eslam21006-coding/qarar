# Feature Specification: Date-Range Parity With Meta ("Never Include Today")

**Feature Branch**: `fix/date-range-meta-parity`

**Created**: 2026-07-12

**Status**: Draft

**Input**: User description: "Fix the 3-day (and 7/14/30-day) insights window to match Meta's own date-range convention exactly, so it never includes today. Currently server/meta.ts's buildSnapshot constructs the 3-day window as time_range { since: daysAgo(2), until: daysAgo(0) } — [today-2, today], which includes today. Meta's own 'last N days' convention (and this app's own already-correct `today` and `last_30d` date_presets used elsewhere in the same function) is [today-N, today-1]. This is judgment-affecting because the 3-day window (w3d) is what every Kill/Watch/Continue engine rule judges against. The same buggy since/until pattern also exists in fetchBaselines' cpmNow, and the client-side date-range selector aggregation in DecisionTable.tsx (the 7d/14d/30d chips) has the equivalent off-by-one. Do NOT touch the separate `today` window used by the circuit-breaker (CB1/CB2). Must verify judgment impact, add a regression test, and require manual QA against Meta Ads Manager before merge."

## Clarifications

### Session 2026-07-12

- Q: Which timezone should anchor the "today/yesterday" boundary for the corrected windows and the regression test? → A: Ad account timezone everywhere — server windows use Meta's native "last N days" preset (evaluated in the account's timezone), and the client range chips plus the regression test's fixed "today/yesterday" are also anchored to the ad account's timezone. Full parity with Meta Ads Manager.
- Q: What reconciliation tolerance makes the manual-QA merge gate (SC-004) pass? → A: The day set must match exactly (last day is yesterday, today absent) AND the key metrics (spend, impressions, conversions) must match Meta Ads Manager's "Last 3 days" preset within ~1–2%, tolerating normal attribution settling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verdicts judged on complete days only (Priority: P1)

An advertiser opens Qarar mid-day and sees a Kill / Watch / Continue verdict for
each ad, ad set, and campaign. That verdict is judged against a rolling
"recent performance" window. Today, that window silently includes the current
day's partial data — spend has accrued but conversions have not yet been
attributed — which drags recent CPA/ROAS artificially and can push a healthy
object into a harsher verdict (or hide a genuinely failing one). After this
change, the recent-performance window ends on the last fully-elapsed day, so
every verdict is judged only against complete, settled days — matching what the
advertiser would compute themselves in Meta Ads Manager.

**Why this priority**: This is the whole point of the fix. The engine's verdicts
are the product's core output; judging them against a partial day is a
correctness defect that changes real decisions (pausing/keeping ads), not a
display nicety.

**Independent Test**: For a fixed "today," construct the recent-performance
window and assert it spans exactly the N fully-elapsed days ending yesterday and
never includes today's date. Confirm the existing engine verdict test suite
stays green (or that any change is a deliberate correction of a test that
asserted the old boundary), and that verdicts computed off the corrected window
match hand-computed expectations from the fixtures.

**Acceptance Scenarios**:

1. **Given** the current date is any given day, **When** the recent 3-day
   performance window is constructed for the engine, **Then** the window covers
   the three fully-elapsed days ending yesterday and excludes today.
2. **Given** an object whose only meaningful spend/conversions occurred on
   complete days, **When** the engine renders its verdict, **Then** the verdict
   reflects only those complete days and is unaffected by any partial data
   accruing today.
3. **Given** the current date is the 1st of a month, **When** the 3-day window is
   constructed, **Then** it correctly rolls back across the month boundary into
   the previous month and still excludes today.

---

### User Story 2 - Date-range chips match Meta's "Last N days" (Priority: P2)

An advertiser uses the date-range selector chips (3d / 7d / 14d / 30d) above the
decision table to review performance over different look-back windows. Each chip
should aggregate exactly the same set of days that Meta Ads Manager's matching
"Last N days" preset shows — i.e. the last N complete days, ending yesterday.
Today, the 7d / 14d / 30d chips include the current (incomplete) day, so their
totals disagree with Meta by one partial day.

**Why this priority**: This is advertiser-facing trust. When Qarar's "Last 7
days" total doesn't reconcile with Meta's own "Last 7 days," the advertiser
distrusts every number on the screen. It is one rung below P1 because it affects
displayed aggregates rather than the engine's verdict itself.

**Independent Test**: For a fixed "today" and a known daily series, select each
range chip and assert the aggregated window ends on yesterday (not today) and
spans the expected number of complete days, matching the corresponding Meta
preset.

**Acceptance Scenarios**:

1. **Given** a daily performance series, **When** the advertiser selects the 7-day
   chip, **Then** the aggregate covers the 7 complete days ending yesterday and
   excludes today.
2. **Given** the same series, **When** the advertiser selects 14d or 30d, **Then**
   each aggregate likewise ends yesterday and spans the expected count of complete
   days.
3. **Given** the 3-day chip, **When** the daily series is unavailable and the
   engine's 3-day window is used as a fallback, **Then** that fallback also
   excludes today (consistent with Story 1).

---

### User Story 3 - Baseline comparison uses complete days (Priority: P3)

The engine compares an object's current cost-efficiency against a recent
baseline (e.g. a recent CPM figure) to detect cost spikes. That "current"
baseline value is computed over a short recent window that today includes the
partial current day, biasing the comparison. After this change it uses the same
complete-days-only convention so cost-spike detection compares like with like.

**Why this priority**: It affects a supporting baseline rather than the primary
verdict window, and its magnitude is smaller — but leaving it inconsistent would
reintroduce the same partial-day bias through the back door.

**Independent Test**: For a fixed "today," construct the baseline's recent
window and assert it excludes today, matching the convention used by the primary
window.

**Acceptance Scenarios**:

1. **Given** the current date, **When** the recent baseline value is computed,
   **Then** its window excludes today and uses only complete days.

---

### Edge Cases

- **Month rollover**: When today is the 1st, the N-day window must roll back into
  the previous month (and across a year boundary on Jan 1) and still end on
  yesterday. This is an explicit regression-test case.
- **Circuit-breaker window is intentionally different**: The separate same-day
  "today" window used by the circuit-breaker (CB1/CB2 same-day bleed detection)
  MUST remain live and include today. It is a different mechanism (live
  monitoring, not reporting) and is explicitly out of scope for this change.
- **Daily-series fallback**: When the client's daily series is empty, the 3-day
  chip falls back to the engine's 3-day window; that fallback must carry the
  corrected (excludes-today) boundary so the two paths agree.
- **Time-zone / "today" definition**: "Today," "yesterday," and the day boundary
  are anchored to the **ad account's timezone** everywhere — the server windows
  inherit it from Meta's native "last N days" preset, and the client range chips
  and the regression test's fixed "today/yesterday" use the same account-timezone
  boundary. Near midnight, UTC and browser-local clocks can disagree with the
  account timezone by up to a day; the account timezone is authoritative so the
  corrected window matches what Meta Ads Manager shows for the same account.
- **Fixture consistency**: Demo/sample fixtures must remain internally consistent
  with the corrected boundary — no fixture may depend on today's partial data
  being counted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The engine's recent 3-day performance window (the window every
  Kill/Watch/Continue rule judges against) MUST cover the last 3 fully-elapsed
  days ending yesterday and MUST NOT include today.
- **FR-002**: The recent 3-day window MUST follow the same "last N days"
  convention already used elsewhere for the app's existing correct windows (the
  `today` and 30-day presets), rather than a hand-computed boundary that ends on
  today.
- **FR-003**: The recent baseline value used for cost-spike comparison MUST be
  computed over a recent window that excludes today, using the same
  complete-days-only convention.
- **FR-004**: The date-range selector chips (3d / 7d / 14d / 30d) MUST aggregate
  the last N complete days ending yesterday and MUST NOT include today.
- **FR-005**: When the daily series is unavailable and the 3-day chip falls back
  to the engine's 3-day window, that fallback MUST also exclude today.
- **FR-006**: The circuit-breaker same-day ("today") window MUST remain unchanged
  and continue to include today; this change MUST NOT alter same-day bleed
  detection (CB1/CB2).
- **FR-007**: The change MUST NOT alter the verdict vocabulary, the engine
  evaluation order, or any rule code; only the date boundary of the affected
  reporting windows changes.
- **FR-008**: A regression test MUST assert that, for a fixed "today," the
  constructed recent window never includes today's date, including a
  month-rollover case.
- **FR-009**: The existing engine test suite MUST remain green after the change,
  except where a test explicitly asserted the old (today-including) boundary; any
  such test MUST be updated deliberately and the change called out.
- **FR-010**: Demo/sample fixtures MUST remain internally consistent with the
  corrected window boundary (no fixture relies on today's partial data being
  counted).
- **FR-011**: Before merge, manual QA MUST compare Qarar's recent-window numbers
  against Meta Ads Manager's own "Last 3 days" preset on a real connected
  account, passing the acceptance criteria in SC-004 (exact day-set match plus
  key metrics within ~1–2%), and this verification MUST be recorded as a merge
  gate.
- **FR-012**: The "today" / "yesterday" day boundary for all corrected windows
  (server engine window, server baseline, and client range chips) MUST be
  anchored to the ad account's timezone, not UTC or the browser's local clock, so
  the windows reconcile with Meta Ads Manager for the same account.

### Key Entities *(include if feature involves data)*

- **Recent performance window (w3d)**: The rolling multi-day window of settled
  performance metrics that the engine's Kill/Watch/Continue rules evaluate. Key
  attribute: its start/end boundary. After this change the boundary is [today-3,
  today-1] (three complete days, ending yesterday).
- **Baseline recent value**: A short-window recent cost-efficiency figure used as
  the "current" side of a cost-spike comparison. Key attribute: its window
  boundary, which must exclude today.
- **Date-range chip selection**: The advertiser-selected look-back range (3d / 7d
  / 14d / 30d / custom) that drives table aggregation. Key attribute: the
  inclusive day-range it aggregates, which for preset ranges must end yesterday.
- **Circuit-breaker same-day window**: The intentionally-live window used for
  same-day bleed detection. Explicitly unchanged; included here only to mark it
  out of scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any fixed reference date (including the 1st of a month and Jan
  1), evaluated in the ad account's timezone, the constructed recent 3-day window
  contains exactly 3 days, the latest of which is yesterday, and never today —
  verifiable by an automated regression test that pins "today" in the account
  timezone.
- **SC-002**: Every preset date-range chip (3d / 7d / 14d / 30d) aggregates
  exactly N complete days ending yesterday, with today excluded — verifiable by
  automated test against a known daily series.
- **SC-003**: The full engine test suite passes; any test changed to reflect the
  corrected boundary is explicitly identified in the change, and no verdict code,
  vocabulary, or evaluation-order change occurs.
- **SC-004**: On a real connected account, manual QA confirms before merge that
  (a) the day set matches Meta Ads Manager's "Last 3 days" preset exactly — the
  last day is yesterday and today is absent — and (b) key metrics (spend,
  impressions, conversions) match that preset within ~1–2%, tolerating normal
  attribution settling.
- **SC-005**: Same-day circuit-breaker behavior is unchanged: same-day bleed
  detection continues to evaluate today's live data exactly as before.

## Assumptions

- The account's reporting "day" boundary and the definition of "today" /
  "yesterday" are anchored to the ad account's timezone (per Clarifications
  2026-07-12), matching Meta's native "last N days" presets; UTC or browser-local
  clocks are not authoritative for the window boundary.
- "Last N days excludes today" is the correct, intended convention because
  today's data is still incomplete — this matches Meta Ads Manager's own presets
  and the app's already-correct `today` and 30-day presets.
- The engine's evaluation continues to read from the cached snapshot; only the
  boundary of the window written into that snapshot (and the client aggregation
  of the daily series) changes.
- The magnitude of the fix is a one-day shift of the window boundary; no new data
  sources, metrics, or schema changes are required.
- Manual QA against a real Meta account is a required pre-merge gate and is
  treated as part of "done," not an optional follow-up.
