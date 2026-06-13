# Feature Specification: Decision Dashboard Fixes & Next-Step Features

**Feature Branch**: `001-decision-dashboard-fixes`

**Created**: 2026-06-13

**Status**: Draft

**Input**: User description: "Build a set of fixes and three new features for Qarar, an Arabic-RTL Meta-ads decision dashboard … (see /speckit-specify arguments)"

> **Scope note**: This specification is behavioral. It states WHAT must be true and WHY, from the user's perspective. Verified technical root causes live in `docs/audit-finding.md`; they are not repeated here. All user-facing copy is simple Arabic at a 6th-grade reading level (per constitution Principle III). The discovery-call destination is, verbatim, `https://eslamsalah.com/team-discovery-call`.

---

## Clarifications

### Session 2026-06-13

- Q: Verdict history — how often should an evaluation write history rows (every evaluation vs. only on change)? → A: Only on change — a history row is written for an object only when its verdict OR rule differs from that object's last logged state; the timeline shows true transitions, and an object's first-ever evaluation produces a single baseline entry.
- Q: Daily auto-refresh — which accounts does the once-per-day job refresh and monitor? → A: Only accounts the user has explicitly selected that also have an active connection (not all connected accounts).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete "where is the problem" diagnosis that reaches the offer/funnel and routes to a booking (Priority: P1)

A user opens the dashboard and looks at the "where is the problem" panel. Instead of one generic market-cost line for the whole account, each flagged object tells the user every broken step in the customer journey, in order, marking the first broken step as the one to fix. When the ads are clearly working but the offer or funnel is the real bottleneck (people reach the page but don't buy; cheap leads never buy the main program), the diagnosis says so plainly and offers a button to book a discovery call. When any object in the account shows that pattern, a prominent account-level card invites the user to book the call.

**Why this priority**: This is the product's core purpose (constitution Principle VII) — the diagnosis exists to find the user's real bottleneck and bridge them to the program. Without it, the dashboard only ever says "fix the market," which is unhelpful and never reaches the booking outcome that defines success.

**Independent Test**: Load a snapshot containing (a) an object failing two journey steps and (b) an object with healthy ads but a weak page conversion. Verify the first object lists both broken steps with the first marked primary, and the second shows the offer/funnel message plus a working discovery-call button, and that the account-level booking card appears.

**Acceptance Scenarios**:

1. **Given** a flagged object whose CPM, link CTR, and page conversion are all broken, **When** the user views its diagnosis, **Then** all three broken steps are listed in journey order (CPM → link CTR → click-to-page → page conversion → post-sale), the first broken step is marked as the one to fix, and the remaining broken steps are shown as "also failing."
2. **Given** an object whose ads perform well (people reach the page) but few buy, **When** the user views its diagnosis, **Then** the diagnosis states in plain Arabic that the problem is the offer/page/price (the funnel, not the ad) and shows a button that opens `https://eslamsalah.com/team-discovery-call` in a new tab.
3. **Given** a campaign where the front offer converts cheaply but the main program does not, **When** the user views its diagnosis, **Then** the diagnosis names this as an offer/back-end problem and shows the discovery-call button.
4. **Given** at least one object anywhere in the account shows the offer/funnel pattern, **When** the user views the dashboard, **Then** a single prominent account-level card invites them to book the discovery call.
5. **Given** no object shows the offer/funnel pattern, **When** the user views the dashboard, **Then** no account-level booking card is shown.
6. **Given** an object with no broken steps, **When** the user views its diagnosis, **Then** no broken-step findings are shown for it.

---

### User Story 2 - Trustworthy, account-level CPM explanation (Priority: P1)

When the engine blames high cost on "the market, not your designs," the user can verify the claim because the explanation appears with the actual numbers — the account's recent CPM, its 14-day average CPM, and the percentage difference — shown once at the account level rather than repeated on every ad row.

**Why this priority**: An unverifiable claim that repeats on every row both erodes trust and crowds out the per-object diagnosis (User Story 1). The two are deeply linked: moving the cost claim to a single account note is what frees each row to report its own bottleneck.

**Independent Test**: Craft a snapshot where the account's recent CPM is meaningfully above its 14-day average. Verify exactly one account-level cost banner appears, showing both CPM figures and the percentage difference, and that no individual ad row repeats this market-cost message.

**Acceptance Scenarios**:

1. **Given** the account's recent CPM exceeds its 14-day average by the rulebook threshold, **When** the user views the dashboard, **Then** a single account-level banner shows the recent CPM, the 14-day average CPM, and the percentage difference, with simple-Arabic copy explaining the likely cause is market/season/competition — not the user's designs.
2. **Given** that same condition, **When** the user scans individual ad rows, **Then** none of them repeats the account-wide market-cost message.
3. **Given** the account's recent CPM is not above the threshold, **When** the user views the dashboard, **Then** no account-level cost banner appears.
4. **Given** the 14-day average CPM is unavailable (no baseline), **When** the engine evaluates the account, **Then** the account-level cost banner is not shown (no banner with missing numbers).

---

### User Story 3 - Find any object by search, from any drill-down level, and jump from a decision card (Priority: P1)

A user reads the "today's decisions" panel, which names specific ad sets, then searches one of those names in the table. The object is found regardless of which level (campaign / ad set / ad) the table is currently showing. Each cross-level result shows which level it is. Clicking a "today's decisions" card takes the user straight to that object in the table.

**Why this priority**: Today this returns zero results, directly breaking the link between the recommendation panel and the table. It makes the headline recommendations unusable, so it is foundational to the dashboard being trustworthy.

**Independent Test**: With the table at campaign level, search an ad-set name surfaced in "today's decisions." Verify the ad set appears with a level indicator. Then click the matching decision card and verify the table focuses that object.

**Acceptance Scenarios**:

1. **Given** the table is showing campaigns, **When** the user searches an ad-set or ad name that exists anywhere in the account, **Then** the matching object(s) appear in the results.
2. **Given** cross-level search results are displayed, **When** the user scans the rows, **Then** each row shows a level indicator labeling it campaign, ad set, or ad (in simple Arabic).
3. **Given** the "today's decisions" panel names an ad set, **When** the user clicks that card, **Then** the table scrolls into view and focuses/surfaces that exact object.
4. **Given** the user clears the search, **When** the table re-renders, **Then** it returns to its normal drill-down view without error and the current path remains valid.
5. **Given** a search term matches nothing in the account, **When** results render, **Then** an empty state is shown (no rows), not a stale or unrelated list.

---

### User Story 4 - Honest "too early" messaging that respects status and real impressions (Priority: P2)

An under-data object no longer always says "needs 2,000 more impressions." An active under-data object states exactly how many MORE impressions are still needed (threshold minus what it already has). A paused object is never told to "leave it to gather data"; instead it is told it is paused and offered to run it or remove it. Users can also see current impressions as a table column.

**Why this priority**: The current flat, status-blind message is actively misleading (a paused ad can never gather more data) and undermines trust in every "too early" verdict.

**Independent Test**: Evaluate three objects — an active ad with some impressions below threshold, an active ad with zero impressions, and a paused ad — and verify each shows the correct, distinct message; toggle the impressions column and confirm it shows each object's current impressions.

**Acceptance Scenarios**:

1. **Given** an active under-data object with impressions below the judging threshold, **When** the user views its message, **Then** it states the exact remaining impressions needed (threshold minus current).
2. **Given** an active under-data object with zero impressions, **When** the user views its message, **Then** the remaining count equals the full threshold (and reads sensibly, not as an error).
3. **Given** a paused object, **When** the user views its message, **Then** it says the object is paused (it does not say "leave it to gather data") and offers to run it or remove it.
4. **Given** any object, **When** the user enables the impressions column, **Then** the object's current impressions for the selected date range are shown.
5. **Given** the verdict set must stay exactly five, **When** a paused object is displayed, **Then** "paused" is presented as a badge/message, not as a sixth verdict.

---

### User Story 5 - Real, Meta-style filter builder (Priority: P2)

Instead of search-by-name only, the user can build filters by name, campaign objective, verdict, status, level, or numeric metrics (spend, impressions, CPA, CTR, CPM). Operators fit the field type. Multiple filters combine with an AND/OR toggle. All labels are simple Arabic. Campaign objective filters correctly at every level because ad sets and ads inherit their campaign's objective.

**Why this priority**: Real filtering is the primary way users navigate a large account; name-only search is a severe limitation, but it builds on the cross-level search foundation (User Story 3).

**Independent Test**: Build "objective is <X> AND spend ≥ 100," verify correct rows return; switch the join to OR and verify it broadens; filter by an objective at ad and ad-set level and confirm inheritance works.

**Acceptance Scenarios**:

1. **Given** the filter builder, **When** the user adds a text/category field (name, objective, verdict, status, level), **Then** the available operators are contains / is / is-not.
2. **Given** the filter builder, **When** the user adds a numeric field (spend, impressions, CPA, CTR, CPM), **Then** the available operators are ≥, ≤, and between.
3. **Given** two or more filter rules, **When** the user toggles AND/OR, **Then** results recombine accordingly (AND narrows, OR broadens).
4. **Given** an objective filter, **When** it is applied at ad-set or ad level, **Then** those objects are matched by their campaign's objective (inheritance).
5. **Given** the selected date range changes, **When** numeric filters are active, **Then** the numeric comparisons re-evaluate against the new range's values.
6. **Given** all filters are cleared, **When** the table re-renders, **Then** all rows for the current view are restored.
7. **Given** a "between" numeric filter, **When** the user enters a lower and upper bound, **Then** rows whose value falls within the inclusive range are matched.
8. **Given** an object whose campaign has no objective set, **When** an objective filter is applied, **Then** that object is treated as having no objective and is excluded from "is <objective>" matches (and included in "is-not <objective>").

---

### User Story 6 - Column totals footer with type-correct aggregation (Priority: P2)

The metrics table gains a totals footer. Summable metrics (spend, impressions, results) are summed. Rate metrics (cost per result, link CTR, CPM, CPC, LP view rate) are recomputed from the summed raw components — never averaged. Totals reflect only the currently visible rows after filtering and the selected date range. A rate with no denominator shows a dash.

**Why this priority**: Without correct totals, users cannot judge the account at a glance, and averaged rates would be silently wrong. It depends on the filtering work (User Story 5) defining "visible rows."

**Independent Test**: With two visible rows of very different impression volumes, verify the footer link CTR equals total link-clicks ÷ total impressions (not the mean of the two row CTRs), and that a rate with a zero denominator shows a dash.

**Acceptance Scenarios**:

1. **Given** visible rows, **When** the footer renders, **Then** spend, impressions, and results are the column sums of those rows.
2. **Given** visible rows with differing volumes, **When** the footer renders a rate metric, **Then** the rate is recomputed from summed raw components, not averaged across rows.
3. **Given** a rate metric whose summed denominator is zero, **When** the footer renders, **Then** that cell shows a dash.
4. **Given** the user applies a filter or search, **When** the footer recomputes, **Then** it reflects only the now-visible rows.
5. **Given** the user changes the date range, **When** the footer recomputes, **Then** it reflects the new range.

---

### User Story 7 - Specific, actionable creative direction on creative-triggered verdicts (Priority: P2)

When the engine fires a dead-hook kill (K3), a flash-creative kill (K4), or a fatigue watch (F1 or F2), the action shown is specific and matches the SOP — not "make a new creative." Each names the precise pattern, the precise fix, and what not to do; the deeper "how to build the concept" work is routed to the discovery call.

**Why this priority**: Generic creative advice wastes the diagnosis. The SOP treats creative production as a structural requirement, and specific direction is what makes the verdict actionable.

**Independent Test**: Trigger each of K3, K4, F1, F2 in crafted snapshots and verify the action text contains the SOP-specified guidance for that rule (and only routes concept-depth to the call where specified).

**Acceptance Scenarios**:

1. **Given** a K3 (dead hook) verdict, **When** the user views the action, **Then** it explains the hook failed to stop the scroll, that the fix is a new CONCEPT (not a color change or resize), and that deeper creative strategy is available via the discovery call.
2. **Given** a K4 (flash creative) verdict, **When** the user views the action, **Then** it names the strong-day-1-then-collapse pattern, tells the user not to chase day 1 by raising budget (it breaks Facebook's learning and accelerates collapse), and states the factory must prepare the next concept now.
3. **Given** an F1 (fatigue) watch, **When** the user views the action, **Then** it states the audience is healthy and the ad set must not be touched (only the creative is exhausted), and that a new creative variation in the same ad set within 3–5 days confirms fatigue vs. structural problem.
4. **Given** an F2 (rising CPM vs. account average) watch, **When** the user views the action, **Then** it explains the algorithm is penalizing this creative in the auction as a poor user experience, and that a fresh creative running alongside is the diagnostic test.
5. **Given** any of these verdicts, **When** the action renders, **Then** it never executes or prescribes concept-level creative production beyond naming the type of fix (constitution Principle VII / non-negotiables).

---

### User Story 8 - Promotion list: "copy today and where" (Priority: P2)

When any ad reaches the S1 condition (three consecutive days at or under target CPA plus CTR above the account median), the dashboard surfaces a clear, dedicated, impossible-to-miss operational instruction: copy this ad using its Post ID to preserve social proof, move it from the test campaign to the scale campaign, and a simple-Arabic explanation of why the Post ID copy matters (accumulated likes, comments, and shares travel with it and lower future CPM). This is a first-class output separate from the verdict badge.

**Why this priority**: Scaling winners is where the account makes money; burying this instruction as a footnote means winners never get scaled correctly.

**Independent Test**: Craft an ad meeting the S1 condition and verify a dedicated promotion instruction appears (not just the verdict badge), naming the Post ID copy method, the source→destination move, and the social-proof/CPM rationale.

**Acceptance Scenarios**:

1. **Given** an ad meeting the S1 condition, **When** the user views the dashboard, **Then** a dedicated, prominent promotion instruction is shown for that ad, distinct from its verdict badge.
2. **Given** that instruction, **When** the user reads it, **Then** it tells them to copy the ad via its Post ID, names the destination (from test campaign to scale campaign), and explains in simple Arabic why Post ID copy matters (social proof carries over and lowers future CPM).
3. **Given** no ad meets the S1 condition, **When** the user views the dashboard, **Then** no promotion instruction is shown.
4. **Given** multiple ads meet S1, **When** the user views the dashboard, **Then** each qualifying ad is represented in the promotion output.

---

### User Story 9 - Creative factory cadence indicator (Priority: P3)

The dashboard shows how many days have passed since the last new ad was created in the account (derived from ad creation dates already fetched from Meta). Above 14 days it shows a visible warning that the creative factory has stalled (a structural risk, not a style preference). Above 7 days it shows a softer reminder. This is an account-level health signal, never a verdict on any individual ad. All copy is simple Arabic.

**Why this priority**: A valuable structural-health nudge, but it does not block any per-object decision, so it is lower priority than the diagnosis and navigation fixes.

**Independent Test**: With the most recent ad creation date 16 days ago, verify a stall warning; at 9 days, verify a softer reminder; at 3 days, verify neither.

**Acceptance Scenarios**:

1. **Given** the most recent ad was created more than 14 days ago, **When** the user views the dashboard, **Then** a visible account-level warning indicates the creative factory has stalled, framed as a structural risk (SOP minimum 5–10 new concepts every two weeks).
2. **Given** the most recent ad was created more than 7 but at most 14 days ago, **When** the user views the dashboard, **Then** a softer reminder is shown.
3. **Given** the most recent ad was created within 7 days, **When** the user views the dashboard, **Then** no cadence warning or reminder is shown.
4. **Given** the indicator displays, **When** the user reads it, **Then** it is clearly an account-level signal and is not attached to any individual ad's verdict.
5. **Given** the account has no ads created within the available history (no creation date), **When** the indicator is evaluated, **Then** it shows a neutral message that the date is unknown rather than a false "0 days" or an erroneous large number.

---

### User Story 10 - UX correctness pass (Priority: P3)

Several display behaviors are corrected: an under-data object shows a neutral dash for cost-per-result instead of a catastrophic red "∞" (a genuine zero-result stop verdict may still show ∞ in red); link-CTR cell colors follow the rulebook tiers and key off the account's own 90-day median CTR where known; the daily-savings figure on a stop recommendation is traceable to its rule via a tooltip rather than main copy; and paused objects can be hidden with a toggle that defaults to showing them.

**Why this priority**: These are correctness and clarity refinements that improve trust but do not change which decisions the engine makes.

**Independent Test**: Verify a too-early row shows a neutral dash for CPA while a zero-conversion stop shows red ∞; verify CTR colors shift around a known account median; verify the savings figure appears in a tooltip; verify the paused toggle hides/shows rows and defaults to showing.

**Acceptance Scenarios**:

1. **Given** an object that simply lacks enough data (too-early / pre-gate), **When** its cost-per-result cell renders, **Then** it shows a neutral dash, not a red ∞.
2. **Given** a genuine zero-result stop verdict (spend at or above 2× target with zero conversions), **When** its cost-per-result cell renders, **Then** it may show ∞ in red.
3. **Given** the account's 90-day median CTR is known, **When** a link-CTR cell renders, **Then** its color keys off that median (per rulebook tiers); when the median is unknown, **Then** it falls back to the rulebook's absolute bands.
4. **Given** a stop recommendation showing estimated daily savings, **When** the user inspects it, **Then** the savings figure and its rule basis are available in a tooltip, not the main copy.
5. **Given** the table on first load, **When** it renders, **Then** paused objects are shown by default and a toggle is available to hide them; toggling hides/shows paused rows without affecting non-paused rows.

---

### User Story 11 - Daily automatic refresh and owner notification (Priority: P2)

Once per day, each connected account's data is automatically refreshed. The owner is notified when NEW stop (🔴) verdicts appear that were not stops in the previous run, and is notified if their Meta connection has expired so they know to reconnect.

**Why this priority**: Automatic monitoring is what makes the dashboard a daily decision tool rather than a thing the user must remember to open; a high-value additive feature.

**Independent Test**: Force a snapshot where an object crosses into a stop verdict it did not have before and verify exactly one new-stop notification; verify no notification when nothing newly became a stop; verify a reconnect notification when the connection is expired.

**Acceptance Scenarios**:

1. **Given** an account the user has explicitly selected that has an active connection, **When** the daily job runs, **Then** the account's snapshot is refreshed from Meta and re-evaluated; a connected-but-unselected account is skipped.
2. **Given** an object that is a stop verdict in the new run but was not a stop in the previous run, **When** the daily job completes, **Then** the owner is notified, with the count and names of the newly-stopped objects (and the estimated daily bleed where available).
3. **Given** no object newly entered a stop verdict, **When** the daily job completes, **Then** no new-stop notification is sent.
4. **Given** the account's Meta connection has expired, **When** the daily job runs, **Then** the refresh does not silently fail; instead the connection is marked expired and the owner is notified to reconnect.
5. **Given** multiple users/accounts, **When** the daily job runs, **Then** each owner is notified only about their own accounts (no cross-user leakage).
6. **Given** an object that was already a stop in the previous run and remains a stop, **When** the daily job completes, **Then** it does not generate a new-stop notification.

---

### User Story 12 - Verdict history log (Priority: P3)

Every evaluation records each object's verdict and rule, forming an audit trail the owner can view as a per-object timeline. The log is strictly isolated per user so no user ever sees another's data.

**Why this priority**: Useful for understanding how decisions evolve, but it does not change today's decisions, so it ranks below the live-decision fixes.

**Independent Test**: Refresh twice with a verdict change in between and verify the object's timeline shows both entries with correct timestamps; verify switching users/accounts never reveals another user's history.

**Acceptance Scenarios**:

1. **Given** an object is evaluated for the first time, **When** the evaluation completes, **Then** one baseline entry with its verdict and rule (and timestamp) is recorded in the history log.
2. **Given** an object's verdict or rule changed between two evaluations, **When** the user opens that object's timeline, **Then** both states are visible with their dates, in order.
3. **Given** an object is re-evaluated with no change to its verdict or rule, **When** the evaluation completes, **Then** no new history row is added (the log records transitions only).
4. **Given** a user viewing history, **When** the data is fetched, **Then** only that user's records are returned — every query is scoped per user.
5. **Given** two different users with similarly named objects, **When** each views history, **Then** neither sees the other's records.
6. **Given** an object with only one evaluation on record, **When** the user opens its timeline, **Then** a single entry is shown without error.

---

### User Story 13 - Inline budget controls (±20%) (Priority: P2)

Next to the existing pause/resume control, the user sees +20% and −20% daily-budget buttons, but only where a daily budget exists. Each button opens a confirmation dialog that shows the old budget and the new budget before applying. The confirmation copy echoes the SOP: 20% increments protect Facebook's learning phase; large jumps reset learning and increase cost.

**Why this priority**: A direct, high-value action that lets the user act on a scale/decision without leaving the dashboard; one of the two sanctioned Meta writes.

**Independent Test**: For an object with a daily budget, click +20%, verify the confirmation shows old→new correctly and applying updates the budget; verify the control is absent where no daily budget exists; verify a permission error surfaces a reconnect message.

**Acceptance Scenarios**:

1. **Given** an object with a daily budget, **When** the user views its controls, **Then** +20% and −20% buttons appear next to pause/resume.
2. **Given** an object with no daily budget, **When** the user views its controls, **Then** the ±20% buttons are not shown.
3. **Given** the user clicks +20% (or −20%), **When** the confirmation dialog opens, **Then** it shows the current budget and the resulting budget before any change is applied.
4. **Given** the confirmation dialog for +20%, **When** the user reads it, **Then** it echoes the SOP guidance in simple Arabic (20% increments protect learning; large jumps reset learning and raise cost).
5. **Given** the user confirms, **When** the change is applied, **Then** the new budget is written to Meta, the cached snapshot reflects the new budget, and the user sees a success confirmation.
6. **Given** the user lacks management permission or the connection is expired, **When** they attempt a budget change, **Then** the error surfaces a reconnect/permission message rather than failing silently.
7. **Given** the user cancels the dialog, **When** it closes, **Then** no change is made to the budget.

---

### Edge Cases

- **No account history / null baseline**: When the 14-day average CPM or 90-day median CTR is unavailable, the account-level cost banner is suppressed and CTR colors fall back to the rulebook's absolute bands. No banner or color is shown using missing numbers.
- **Zero impressions**: An active object with zero impressions shows "needs the full threshold of impressions"; its cost-per-result shows a neutral dash; CPM/CTR rate cells show a dash (no division by zero).
- **Paused object**: Always shown with a paused badge/message, offered run/remove, never told to gather data, never counted as a new verdict. Hidden when the paused toggle is off.
- **Missing objective**: Objects whose campaign has no objective are treated as having no objective for filtering (excluded from "is", included in "is-not"); inheritance only applies where the campaign objective exists.
- **Account with no ads created in the last 30 days / no creation date**: The cadence indicator shows the appropriate stall warning if a date exists; if no creation date is known at all, it shows a neutral "unknown" message rather than a false count.
- **Search matches nothing**: An empty state, not a stale list.
- **Rate with zero denominator in totals footer**: Shows a dash.
- **Object already a stop in the previous run**: Does not re-notify on the daily job.
- **Budget change at Meta's minimum**: A −20% that would fall below Meta's minimum daily budget surfaces a clear error and does not silently apply an invalid value.
- **Cross-level click on an ad row**: Clicking an ad row (which has no deeper level) is inert and does not break the table path.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Diagnosis & offer/funnel (User Stories 1, 2)

- **FR-001**: For each flagged object, the system MUST report every broken step in the customer journey in order (CPM → link CTR → click-to-page rate → page conversion rate → post-sale), not only the first.
- **FR-002**: The system MUST mark the first broken step as the one to fix and present the remaining broken steps as "also failing."
- **FR-003**: When the evidence shows the ads are working but the offer or funnel is the problem (people reach the page but few buy; or cheap leads never buy the main program), the diagnosis MUST say so in plain Arabic and present a button linking to `https://eslamsalah.com/team-discovery-call` (opened in a new tab).
- **FR-004**: When any object in the account shows the offer/funnel pattern, the system MUST display a single prominent account-level card inviting the user to book the discovery call; when no object shows it, the card MUST NOT appear.
- **FR-005**: The system MUST display the account-wide high-CPM ("the market, not your designs") explanation exactly once at the account level, never repeated on individual ad rows.
- **FR-006**: The account-level cost explanation MUST include the account's recent CPM, its 14-day average CPM, and the percentage difference between them.
- **FR-007**: When the 14-day average CPM is unavailable, the system MUST suppress the account-level cost explanation rather than show it with missing numbers.
- **FR-008**: All diagnosis and offer/funnel logic MUST remain deterministic and rule-driven; no AI/LLM inference may participate (constitution Principles I, VII).

#### Search & navigation (User Story 3)

- **FR-009**: The system MUST find any object by name regardless of which drill-down level the table currently shows.
- **FR-010**: When showing cross-level search results, the system MUST label each row with its level (campaign / ad set / ad) in simple Arabic.
- **FR-011**: Clicking a "today's decisions" card MUST bring the user to that exact object in the table (scrolling into view and surfacing/focusing the row).
- **FR-012**: Clearing the search MUST restore the normal drill-down view with a valid path and no error.
- **FR-013**: A search that matches nothing MUST present an empty state.

#### "Too early" messaging & impressions (User Story 4)

- **FR-014**: For an active under-data object, the message MUST state the exact remaining impressions needed (judging threshold minus current impressions).
- **FR-015**: For a paused object, the message MUST NOT instruct the user to leave it to gather data; it MUST state the object is paused and offer to run it or remove it.
- **FR-016**: The system MUST offer current impressions as a selectable table column reflecting the selected date range.
- **FR-017**: "Paused" MUST be presented as a badge/message and MUST NOT become a sixth verdict; the verdict set stays exactly five (constitution Principle VI).

#### Filters (User Story 5)

- **FR-018**: Users MUST be able to filter by name, campaign objective, verdict, status, level, and numeric metrics (spend, impressions, CPA, CTR, CPM).
- **FR-019**: Operators MUST fit field type: contains / is / is-not for text and categories; ≥, ≤, between for numbers.
- **FR-020**: Multiple filter rules MUST combine with a user-controlled AND/OR toggle.
- **FR-021**: Campaign objective MUST be usable as a filter at every level; ad sets and ads MUST inherit their campaign's objective.
- **FR-022**: Numeric filters MUST evaluate against values for the currently selected date range and re-evaluate when the range changes.
- **FR-023**: All filter field and operator labels MUST be in simple Arabic.
- **FR-024**: Clearing all filters MUST restore all rows for the current view; free-text search MUST continue to work alongside the filter builder.

#### Totals footer (User Story 6)

- **FR-025**: The metrics table MUST show a totals footer.
- **FR-026**: Summable metrics (spend, impressions, results) MUST be summed across visible rows.
- **FR-027**: Rate metrics (cost per result, link CTR, CPM, CPC, LP view rate) MUST be recomputed from summed raw components, never averaged.
- **FR-028**: The footer MUST reflect only the currently visible rows after filtering/search, and the selected date range.
- **FR-029**: A rate whose summed denominator is zero MUST show a dash.

#### Creative direction (User Stories 7, 8, 9)

- **FR-030**: A K3 (dead hook) action MUST state the hook failed to stop the scroll, that the fix is a new concept (not a color change or resize), and route deeper creative strategy to the discovery call.
- **FR-031**: A K4 (flash creative) action MUST name the strong-day-1-then-collapse pattern, warn against chasing day 1 by raising budget (it breaks learning and accelerates collapse), and state the factory must prepare the next concept now.
- **FR-032**: An F1 (fatigue) action MUST state the audience is healthy and the ad set must not be touched (only the creative is exhausted), and that a new creative variation in the same ad set within 3–5 days confirms fatigue vs. structural problem.
- **FR-033**: An F2 (rising CPM vs. account average) action MUST explain the algorithm is penalizing this creative in the auction as poor user experience, and that a fresh creative running alongside is the diagnostic test.
- **FR-034**: When an ad meets the S1 condition (three consecutive days at or under target CPA plus CTR above the account median), the system MUST surface a dedicated, prominent promotion instruction separate from the verdict badge.
- **FR-035**: The promotion instruction MUST tell the user to copy the ad via its Post ID, name the destination (from the test campaign to the scale campaign), and explain in simple Arabic why Post ID copy matters (social proof carries over and lowers future CPM).
- **FR-036**: The system MUST show how many days have passed since the last new ad was created in the account, derived from ad creation dates already fetched.
- **FR-037**: The cadence indicator MUST show a visible stall warning above 14 days, a softer reminder above 7 days (and at most 14), and nothing at 7 days or fewer.
- **FR-038**: The cadence indicator MUST be an account-level signal, never attached to any individual ad's verdict; when no creation date is known, it MUST show a neutral "unknown" message.
- **FR-039**: The system MUST NOT execute or prescribe concept-level creative production; it names the problem and the type of fix and routes depth to the discovery call (constitution Principle VII).

#### UX correctness (User Story 10)

- **FR-040**: An under-data (too-early / pre-gate) object MUST show a neutral dash for cost per result, not a red ∞.
- **FR-041**: A genuine zero-result stop verdict (spend at or above 2× target with zero conversions) MAY show ∞ in red.
- **FR-042**: Link-CTR cell colors MUST follow the rulebook tiers and key off the account's own 90-day median CTR where known, falling back to absolute bands when the median is unknown.
- **FR-043**: The daily-savings figure on a stop recommendation MUST be available in a tooltip (traceable to its rule), not as main copy; rule codes appear only faded/in tooltips (constitution Principle II).
- **FR-044**: Paused objects MUST be hideable via a toggle that defaults to showing them.

#### Daily refresh & notification (User Story 11)

- **FR-045**: Once per day, the system MUST automatically refresh and re-evaluate the snapshot of each account the user has explicitly selected that also has an active connection. Connected-but-unselected accounts are not refreshed or monitored by the daily job.
- **FR-046**: The system MUST notify the account owner when objects newly enter a stop verdict (were not stops in the previous run), including count, names, and estimated daily bleed where available.
- **FR-047**: The system MUST NOT notify for objects that were already stops in the previous run, and MUST NOT notify when nothing newly became a stop.
- **FR-048**: When a Meta connection has expired, the daily job MUST mark it expired and notify the owner to reconnect rather than failing silently.
- **FR-049**: All daily-job notifications MUST be scoped to the owning user; no owner is ever notified about another user's accounts.

#### Verdict history (User Story 12)

- **FR-050**: On every evaluation, the system MUST record an object's verdict and rule (with a timestamp) only when they differ from that object's last logged state — i.e., it records transitions, not every evaluation. An object's first-ever evaluation always produces one baseline entry; subsequent unchanged evaluations add no rows.
- **FR-051**: The system MUST present a per-object timeline of verdict/rule transitions with dates.
- **FR-052**: Every verdict-history query MUST be scoped per user; no user may ever see another user's history (constitution Principle IV).

#### Budget controls (User Story 13)

- **FR-053**: The system MUST show +20% and −20% daily-budget buttons next to pause/resume, only where a daily budget exists.
- **FR-054**: Each budget change MUST be confirmed in a dialog showing the current budget and the resulting budget before applying.
- **FR-055**: The confirmation copy MUST echo the SOP guidance in simple Arabic (20% increments protect Facebook's learning; large jumps reset learning and raise cost).
- **FR-056**: On confirmation, the system MUST write the new budget to Meta, reflect it in the cached snapshot, and confirm success; on cancel, no change is made.
- **FR-057**: A budget change requires management scope; when permission is missing or the connection is expired, the system MUST surface a reconnect/permission message rather than fail silently.
- **FR-058**: A −20% change that would drop below Meta's minimum daily budget MUST surface a clear error and not apply an invalid value.

#### Cross-cutting non-negotiables (constitution)

- **FR-059**: The decision engine MUST remain deterministic with its rule evaluation order unchanged; rule codes (K1–K7, CB1, CB2, F1, F2, W1–W6, S1–S4, GATE) appear verbatim in output and only faded/in tooltips in the UI.
- **FR-060**: All user-facing text MUST be simple Arabic at a 6th-grade reading level; numeric values render left-to-right within the RTL layout.
- **FR-061**: Every database query MUST be scoped per user; no cross-user data leakage under any circumstance.
- **FR-062**: Reads MUST come from the cached snapshot; the only writes to Meta are confirmed pause/resume and the new budget change, both requiring management scope and an explicit confirmation dialog.

### Key Entities *(include if feature involves data)*

- **Account summary**: Account-wide findings shown once — the high-CPM cost note (with recent CPM, 14-day average, percentage difference), the offer/funnel booking card flag, the creative-factory cadence signal, and the daily bleed figure.
- **Object (campaign / ad set / ad)**: The evaluated unit. Carries its level, name, status (active/paused), inherited or own campaign objective, daily budget (where present), current impressions, the date the ad was created, its verdict and rule, its diagnosis findings, and its action/promotion output.
- **Diagnosis finding**: A single broken journey step for one object — its step (1–6), simple-Arabic text, whether it is the primary (first broken) step, and an optional discovery-call link for offer/funnel steps.
- **Promotion instruction**: For an S1-qualifying ad — the source and destination level (test → scale campaign), the Post ID copy method, and the social-proof/CPM rationale.
- **Verdict-history record**: A per-object, per-user, timestamped record of verdict + rule (with supporting metrics) used to build the timeline.
- **Daily-job result / notification**: The outcome of a scheduled refresh per account — newly-stopped objects (vs. previous run), expired-connection state, and the owner notification(s) derived from them, scoped per user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of objects named in the "today's decisions" panel are found when their name is searched from any drill-down level, and clicking any decision card lands the user on that object.
- **SC-002**: The account-wide high-CPM explanation appears exactly once per dashboard view (never on an individual ad row) and shows the recent CPM, 14-day average, and percentage difference whenever it appears.
- **SC-003**: For any flagged object failing N journey steps, the diagnosis lists all N steps with exactly one marked as the step to fix.
- **SC-004**: Whenever the offer/funnel pattern is present on any object, a discovery-call button is reachable both on that object and on a single account-level card, and the link is exactly `https://eslamsalah.com/team-discovery-call`; when the pattern is absent, the account-level card does not appear.
- **SC-005**: No active under-data object displays a fixed "2,000 more impressions" message; the remaining count equals threshold minus current impressions, and no paused object is told to leave it to gather data.
- **SC-006**: A totals footer rate metric computed from two rows of very different volumes equals the ratio of summed components (verifiably not the mean of the two row rates), and zero-denominator rates show a dash.
- **SC-007**: Users can construct a multi-condition filter spanning at least one text/category field and one numeric field with an AND/OR toggle, and objective filtering returns correct results at all three levels via inheritance.
- **SC-008**: Each of K3, K4, F1, F2 shows action copy containing its SOP-specified, pattern-specific guidance (verified by presence of the distinguishing instruction for each).
- **SC-009**: Every S1-qualifying ad surfaces a dedicated promotion instruction (separate from the verdict badge) naming the Post ID copy method and the test→scale destination.
- **SC-010**: The cadence indicator shows a stall warning above 14 days, a softer reminder above 7 days, nothing at ≤7 days, and an "unknown" message when no creation date exists — with no false counts.
- **SC-011**: A too-early object shows a neutral dash for cost per result while a zero-conversion stop shows red ∞ — both verifiable on the same view.
- **SC-012**: The daily job sends exactly one new-stop notification when (and only when) an object newly enters a stop verdict, sends a reconnect notification on expired connections, and sends nothing across users' boundaries (zero cross-user notifications in an isolation test).
- **SC-013**: An object evaluated twice with a verdict change shows two timeline entries with correct timestamps, and an isolation test confirms no user can read another user's history.
- **SC-014**: ±20% budget controls appear only where a daily budget exists, every change passes through a confirmation showing old→new, and an invalid (below-minimum) change is blocked with a clear message.
- **SC-015**: The existing engine verdict/rule test suite remains green except where tests deliberately asserted old/incorrect behavior being fixed, and no new verdict value is introduced (the set stays at five).

## Assumptions

- **Notification delivery** uses the platform's existing owner-notification mechanism (referenced in the project's reference docs); no new external channel is introduced by this spec. Notification copy is simple Arabic.
- **Daily refresh timing & scope**: "Once per day" runs as a single scheduled background job using the platform's existing scheduler; it processes only the user's explicitly selected accounts that have an active connection (see FR-045). Exact run time is an implementation detail and not user-configurable in this scope.
- **Previous-run comparison** for new-stop detection uses the immediately preceding evaluation's verdict set for the same account; the first-ever run has no "previous," so it produces no new-stop notifications (only the baseline record).
- **Verdict-history retention** is kept indefinitely (additive log) unless a later requirement specifies pruning. Because rows are written only on verdict/rule transitions (FR-050), storage growth is modest and acceptable at expected account sizes.
- **Objective inheritance** resolves an ad set's or ad's objective from its parent campaign when the object's own objective is absent; objective exists only at campaign level in Meta.
- **"Account median CTR"** for S1 and CTR coloring is the account's own 90-day median where available; where unavailable, S1's CTR test and CTR coloring fall back to the rulebook's absolute bands.
- **Budget units**: Meta daily budgets are handled in their native minor units internally; the user sees and confirms human-readable amounts. ±20% results are rounded to a valid Meta budget value.
- **"Visible rows"** for the totals footer and for cross-level search means the rows remaining after the active search and filters within the current view, honoring the paused-hide toggle.
- **Existing snapshot, engine pipeline, verdict vocabulary, and data-isolation guarantees** are reused unchanged except where a requirement explicitly modifies diagnosis aggregation, the account summary, display formatting, or adds the three additive features.
- The **"results"** summable metric and **"cost per result"** rate refer to the account's configured conversion/result definition already present in fetched insights.
