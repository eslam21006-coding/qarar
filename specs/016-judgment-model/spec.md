# Feature Specification: Judgment Model & Single Source of Numbers

**Feature Branch**: `016-judgment-model`

**Created**: 2026-10-20

**Status**: Draft

**Input**: Requirements R1–R6 of `docs/spec-016/spec-016-judgment-model.md` (source brief, anchors
verified at `main@a855599`), judged against the rulebook `docs/spec-015/qarar-rulebook-v2.2.md`
(§5.0, §5.5, principles 9–10) and constitution v1.1.2. Carries over the items feature 015 deferred
to 016 (015 spec, "Out of scope / follow-up features 016–018": T6, T7, T8) plus two leftover copy
items from 015's P3 that the brief pulls in.

## Overview

After feature 015, verdicts on ads and ad sets are trustworthy. Three gaps still show the owner
contradictory numbers or advice:

1. **Campaigns are still judged by their own rules.** A campaign can read 🔴 "أوقف الحملة" while
   one of its ad sets is 🟢. The owner described exactly this: launching many weak ad sets until
   one winner appears. Rulebook §5.0 says the ad set is the judgment unit and the campaign is a
   summary whose verdict comes from its ad sets. Constitution Principle I says the same in its
   last clause.
2. **Results and cost are not single-sourced.** The verdict and the table can count results
   differently for lead-counting funnels. The cost cell hides cost on ⏳ rows that have results.
   The footer return treats a missing sales value as zero. A result count Meta did not send is
   shown as `0`.
3. **Two engine edges from 015's gate review.** The daily circuit breaker counts every result
   type rather than the funnel's counted type. The starved-ad rescue (K5) can fire on a single
   sale at tiny spend, which is not evidence of a "رابح مخنوق".

The owner also still sees English column headers and a window banner that does not say the
verdict excludes today.

## Clarifications

### Session 2026-10-20

- Q: Rulebook §5.5 rule 2 forbids only a 🔴 verdict when the diagnosis says "insufficient data".
  The brief (R3) gates **any** verdict except K3/CB1/CB2 to ⏳ in that case. Which applies? →
  A: **Only 🔴** (owner decision). A 🔴 verdict becomes ⏳ when the diagnosis reports insufficient
  data and the fired rule is not K3, CB1 or CB2. 🟡, 🟢 and 🛟 are left as they are. The diagnosis
  ladder has its own thresholds (for example, about 99 landing-page views for the conversion-rate
  rung) that are independent of the verdict's data gates. So a 🟢 or 🛟 built on real sales, or on
  CTR above the floor, can legitimately sit next to an insufficient-data finding; gating it would
  demote real winners. 🟡 asks the owner to take no action, so it is allowed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A campaign with a winning ad set is never told to stop (Priority: P1)

The owner runs a campaign with several ad sets. Most lose; one wins. Today the campaign row can
say 🔴 "أوقف الحملة", which would kill the winner. After this feature the campaign row reads its
verdict from its ad sets: it tells the owner which ad sets to stop and which to keep, by name.
Budget buttons appear where the budget actually lives — on the ad sets for ABO, on the campaign
for CBO, and only when every active ad set inside is winning.

**Why this priority**: Stopping a campaign that holds a winner destroys the one result the owner
was searching for. It is the highest-cost wrong advice left in the product, and the scenario the
owner flagged by name.

**Independent Test**: Load a fixture with one campaign holding one 🟢 and two 🔴 ad sets. The
campaign row shows 🟡, its action names the two 🔴 ad sets to stop and the 🟢 one to keep, and no
"أوقِف الحملة" appears anywhere for it.

**Acceptance Scenarios**:

1. **Given** an active campaign with one 🟢 ad set and two 🔴 ad sets, **When** the dashboard
   loads, **Then** the campaign is 🟡, its action reads "أوقِف [the two 🔴 names] وأبقِ [the 🟢
   name]", and it is never 🔴.
2. **Given** an active campaign whose ad sets are all 🟢 or ⏳, with at least one 🟢, **When** the
   dashboard loads, **Then** the campaign is 🟢.
3. **Given** an active campaign whose judged ad sets are all 🔴, **When** the dashboard loads,
   **Then** the campaign is 🔴 with the action "أوقِف الحملة — كل مجموعاتها تخسر".
4. **Given** an active campaign whose active ad sets are all ⏳, **When** the dashboard loads,
   **Then** the campaign is ⏳ with the action "اترك البيانات تتجمع".
5. **Given** an active campaign with 🟡 ad sets and no 🟢 ad set, **When** the dashboard loads,
   **Then** the campaign is 🟡 and its action lists what to do inside it.
6. **Given** a campaign whose funnel-level W5 condition holds, **When** it is evaluated, **Then**
   it takes W5 at campaign level after the event-match gate, not a derived verdict.
7. **Given** a campaign that is paused, non-sales, a pre-separation snapshot, or fails the
   event-match gate, **When** it is evaluated, **Then** it exits at that step exactly as today.
8. **Given** an ABO campaign (no campaign budget), **When** the table renders, **Then** ±20%
   controls appear on its ad-set rows only.
9. **Given** a CBO campaign (campaign budget set) where every active ad set is 🟢, **When** the
   table renders, **Then** ±20% controls on the campaign row are enabled.
10. **Given** a CBO campaign where any active ad set is not 🟢, **When** the table renders,
    **Then** the campaign's ±20% controls are disabled with the tooltip "زد الميزانية فقط عندما
    تكون كل المجموعات بالداخل ناجحة".
11. **Given** a campaign that becomes 🔴 by derivation in the daily refresh, **When** the refresh
    completes, **Then** the owner is notified as for any newly 🔴 object.
12. **Live account (brief §4.1)**: after merge, no campaign shows 🔴 while it contains a 🟢 ad
    set, and the actions on the ES-WW and MO-CBO campaigns name ad sets rather than "أوقف الحملة".

---

### User Story 2 — The numbers in the table are the numbers the verdict used (Priority: P1)

The owner switches the table between ranges (3 days, today, 7, 14, 30 days, custom). Whatever the
range, a row with results always shows its cost; a count Meta did not send shows `؟` rather than
`0`; the footer never adds a missing sales value as zero; and the 3-day numbers equal the numbers
the verdict was judged on.

**Why this priority**: Rulebook principle 9 — the number judged is the number shown. A table that
disagrees with its own verdict makes the owner distrust every verdict.

**Independent Test**: For every fixture and every range, assert that results > 0 always comes
with a cost, that each row's 3-day results and cost equal the verdict's, and that unknown counts
render `؟`.

**Acceptance Scenarios**:

1. **Given** a ⏳ row with 3 results and spend $90, **When** the table renders, **Then** the cost
   cell shows $30 (not `—`).
2. **Given** a row with 0 results, **When** the table renders, **Then** the cost cell shows `—`.
3. **Given** a row whose result count Meta did not send, **When** the table renders, **Then** both
   the results and the cost cells show `؟` with the tooltip "لم يصل عدد النتائج من ميتا".
4. **Given** a lead-counting funnel, **When** the table shows any range, **Then** results are
   counted the same way the verdict counts them, not as the blended total of all result types.
5. **Given** a multi-day range in which any single day's count is unknown, **When** the table
   aggregates it, **Then** that range's results show as unknown.
6. **Given** a footer covering rows where any row's sales value is unknown, **When** the footer
   renders, **Then** its return shows `—` with the tooltip "قيمة المبيعات لم تصل من ميتا لبعض
   الصفوف".
7. **Live account (brief §4.2)**: switching the table range 3d → 7d → 30d never shows results > 0
   with an empty cost, and the 3-day numbers equal the verdict's numbers.

---

### User Story 3 — A verdict never contradicts its own diagnosis (Priority: P2)

When "أين المشكلة؟" says there is not enough data on an object, that object is not told to stop
(🔴), unless the verdict came from a rule built to fire without a full sample (K3, CB1, CB2). 🟡,
🟢 and 🛟 verdicts stand, because the diagnosis ladder has its own thresholds that are independent
of the verdict's data gates.

**Why this priority**: Rulebook §5.5 rule 2. It was deferred from 015 (T8). The verdict/diagnosis
pair still sits side by side on screen, so a contradiction is visible to the owner.

**Independent Test**: Build a 🔴 row whose diagnosis is "insufficient data" and whose fired rule
is not K3/CB1/CB2; it shows ⏳ (GATE) with the reason taken from the diagnosis. Repeat with K3, CB1
and CB2, and with 🟡, 🟢 and 🛟 rows; their verdict stands.

**Acceptance Scenarios**:

1. **Given** a 🔴 row whose diagnosis reports insufficient data and whose fired rule is K1, **When**
   the engine runs, **Then** the row becomes ⏳ with rule code GATE and its reason comes from the
   diagnosis.
2. **Given** a 🔴 row whose diagnosis reports insufficient data and whose fired rule is K3, CB1 or
   CB2, **When** the engine runs, **Then** the verdict is unchanged.
3. **Given** a 🟡, 🟢 or 🛟 row whose diagnosis reports insufficient data, **When** the engine
   runs, **Then** the verdict, rule code and reason are unchanged.
4. **Given** the existing fixtures, **When** the guard is added, **Then** every row whose verdict
   changes appears in the snapshot-changes table with a justification.

---

### User Story 4 — The circuit breaker counts the right results (Priority: P2)

The daily circuit breaker reads today's results using the funnel's counted result type, and
stands down when that count is zero but the other type recorded results today.

**Why this priority**: 015 gate review. A paid-offer ad set with 5 leads and 0 purchases today
should not be cut by the zero-result breaker on a count that ignores the funnel's own setting —
and equally, a lead funnel must not be saved by purchases it does not count.

**Independent Test**: The two fixtures named in the brief.

**Acceptance Scenarios**:

1. **Given** a paid low-ticket funnel ad set with 0 purchases, 5 leads and spend 3× target today,
   **When** the circuit breaker runs, **Then** CB2 does not fire.
2. **Given** a webinar funnel ad set with 0 leads, 0 purchases and spend 3× target today, **When**
   the circuit breaker runs, **Then** CB2 fires.
3. **Given** an ad set whose result count for today is unknown, **When** the circuit breaker
   runs, **Then** it stands down (unchanged behaviour).

---

### User Story 5 — One sale is not a rescue (Priority: P2)

A starved ad is rescued 🛟 on cost only when it has at least 2 counted results. With exactly one
result at or under target, it waits.

**Why this priority**: 015 gate review. A rescue tells the owner to duplicate the ad into a new
ad set — a real action and real spend, on evidence of one sale.

**Independent Test**: Two starved ads, below the 500-impression floor, with CPA ≤ target: one
with 1 counted result, one with 2.

**Acceptance Scenarios**:

1. **Given** a starved ad with exactly 1 counted result and CPA ≤ target, below the
   500-impression floor, **When** the matrix runs, **Then** the ad takes ⏳ K5 with the reason
   "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات".
2. **Given** a starved ad with 2 counted results and CPA ≤ target, **When** the matrix runs,
   **Then** the cost half of the high-efficiency test can fire 🛟.
3. **Given** a starved ad whose high efficiency comes from CTR, **When** the matrix runs, **Then**
   the 500-impression floor from 015 still applies unchanged.
4. **Live account (brief §4.4)**: no 🛟 appears on an ad with a single sale.

---

### User Story 6 — The table speaks Arabic and states its window (Priority: P3)

Column headers are Arabic, and the banner states that the verdict always uses the last 3 complete
days, without today, regardless of the selected range.

**Why this priority**: Visible every day, but it misleads no decision on its own.

**Independent Test**: Render the table; every column header in the column list is Arabic, metric
abbreviations appear only in tooltips, and the banner text matches exactly.

**Acceptance Scenarios**:

1. **Given** the table, **When** it renders, **Then** the headers read "الصرف", "النتائج",
   "تكلفة النتيجة", "نسبة الضغط على الرابط", and every other English column header is translated
   in the same style.
2. **Given** the table, **When** it renders, **Then** the window banner reads "الحكم محسوب دائمًا
   على آخر 3 أيام كاملة (بدون اليوم)، ولا يتأثر بالفترة المختارة."
3. **Live account (brief §4.3)**: column headers are Arabic; the banner says "بدون اليوم".

---

### Edge Cases

- **Campaign with no active ad sets** (all paused or archived): the campaign's own status gate
  handles a paused campaign; an active campaign with no active child ad sets has nothing past its
  gates and is ⏳.
- **Only 🔴 and ⏳ children**: the ⏳ children are not judged, so "all judged children 🔴" holds
  and the campaign is 🔴 (rulebook §5.0: "كل المجموعات المحكوم عليها 🔴").
- **🟢 children plus 🟡 children, no 🔴**: the campaign is 🟡; there is no ad set to stop, so the
  action carries no "أوقِف" part.
- **A 🛟 child**: the rescue is added to the campaign's action list; the campaign's derived color
  does not change because of it.
- **Several children of the same severity**: the derived rule code comes from the one with the
  highest spend in the window.
- **CBO campaign with one 🟢 and one ⏳ active ad set**: not every active ad set is 🟢, so the
  campaign's ±20% controls stay disabled.
- **Footer over a mix of known and unknown result counts**: results and cost follow the same
  unknown rule as a single row — any unknown makes the footer total unknown.
- **Circuit breaker with both families zero today**: a genuine zero; the breaker evaluates
  normally.
- **Starved ad with 1 result above target**: not high-efficiency on cost; the matrix proceeds as
  today.

## Requirements *(mandatory)*

### Functional Requirements

**R1 — Campaign verdict derived from its ad sets** (rulebook §5.0; constitution Principle I, last
clause)

- **FR-001**: Steps 1–4 of the evaluation order MUST run at campaign level exactly as today:
  status gate → non-sales exemption → pre-separation guard → event-match gate.
- **FR-002**: W5 (funnel-level: lead or low-ticket results fine, but no high-ticket follow-through)
  MUST remain a campaign-level verdict, evaluated after step 4. It is a funnel judgment, not a sum
  of ad sets.
- **FR-003**: Otherwise, the campaign verdict MUST be derived from its **active** child ad-set rows
  (those that pass the status gate), after those ad sets are evaluated:

  | Child ad sets | Campaign verdict | Campaign action |
  |---|---|---|
  | ≥ 1 🟢 | never 🔴. 🟢 if none are 🔴/🟡, else 🟡 | "أوقِف [names of 🔴 ad sets] وأبقِ [names of 🟢 ad sets]" |
  | all judged children 🔴 | 🔴 | "أوقِف الحملة — كل مجموعاتها تخسر" |
  | none past their gates | ⏳ | "اترك البيانات تتجمع" |
  | otherwise | 🟡 | list what to do inside |
  | any 🛟 child | add the rescue to the action list; never changes the derived color |

  "Judged" means a verdict other than ⏳.
- **FR-004**: The derived verdict's rule code MUST be the rule of the most severe child, ranked
  kill > watch > rescue > continue > too_early; ties go to the child with the highest spend.
- **FR-005**: The derived reason MUST state how many children hold each color, with correct
  Arabic number–noun agreement.
- **FR-006**: Campaign full-funnel ROAS MUST stay displayed (row and tooltip) and MUST NOT be a
  source of any campaign verdict.
- **FR-007**: The campaign-level K1, W6 and S2 rule logic MUST be removed. This supersedes the
  interim campaign reading recorded in 015 (015 FR-029 assumption).
- **FR-008**: ABO campaigns (no campaign daily budget) MUST show ±20% budget controls on their
  ad-set rows only.
- **FR-009**: CBO campaigns (campaign daily budget set) MUST show ±20% controls on the campaign
  row, enabled only when every active ad set inside is 🟢; otherwise disabled with the tooltip
  "زد الميزانية فقط عندما تكون كل المجموعات بالداخل ناجحة".
- **FR-010**: The summary counters MUST keep excluding campaigns (015 FR-030), unchanged.
- **FR-011**: A campaign that becomes 🔴 by derivation MUST trigger the same daily-refresh owner
  notification as any newly 🔴 object.

**R2 — One source for results and cost** (rulebook principle 9, principle 10, §5.5 rule 4)

- **FR-012**: There MUST be one shared way to count a window's results for a funnel, used by both
  the engine and the table. It MUST reproduce today's engine counting exactly — no verdict may
  change because of it — and return "unknown" when the window is flagged as missing its result
  count or the counted field is absent. The table MUST NOT keep its own separate count.
- **FR-013**: Every table range — 3 days, today, 7, 14, 30 days and custom — and the per-day
  aggregate MUST use that count. A multi-day range is unknown if any of its days is unknown.
- **FR-014**: The cost cell MUST show spend ÷ results whenever results > 0, for **every** verdict
  including ⏳; `—` when results = 0; `؟` with the tooltip "لم يصل عدد النتائج من ميتا" when
  results are unknown.
- **FR-015**: The results cell MUST show `؟` with the same tooltip when the count is unknown,
  never `0`.
- **FR-016**: The footer's results and cost MUST follow FR-014 and FR-015.
- **FR-017**: The footer return MUST show `—` with the tooltip "قيمة المبيعات لم تصل من ميتا لبعض
  الصفوف" when any included row's sales value is unknown. An unknown sales value MUST never be
  summed as zero; the recorded 015 deviation (footer and aggregate treating it as 0) is removed.
- **FR-018**: Invariant tests MUST hold across every fixture and every range: results > 0 ⇒ cost
  is shown; a row's 3-day results and cost in the table equal the engine row's 3-day results and
  cost; no reason text contains "بدون أي نتيجة" when displayed results > 0.

**R3 — Verdict/diagnosis consistency guard** (rulebook §5.5 rule 2; 015 FR-034, 015 T8)

- **FR-019**: Planning MUST first establish whether feature 015 already implemented this guard; if
  it did, this requirement is satisfied by adding the tests in FR-021.
- **FR-020**: If a row's verdict is 🔴, the diagnosis for that row reports insufficient data, and
  the fired rule is not K3, CB1 or CB2, the row's verdict MUST become ⏳ with rule code GATE, and the
  reason MUST come from the diagnosis. 🟡, 🟢 and 🛟 verdicts MUST NOT be changed by this guard.
- **FR-021**: The guard MUST be tested for a gated 🔴 case, for each of K3, CB1 and CB2, and for a
  🟡, a 🟢 and a 🛟 row that it leaves unchanged. Any
  existing fixture whose verdict changes MUST be listed in the snapshot-changes table with a
  justification.

**R4 — Circuit breaker follows the funnel's counted result type**

- **FR-022**: The circuit breaker MUST read today's results with the shared count from FR-012,
  using the account's funnel type.
- **FR-023**: If today's counted results are 0 **and** the other result type is > 0, the circuit
  breaker MUST stand down (same logic as the event-match gate; the 3-day gate already warns).
  Unknown today's count MUST keep standing down, as today.
- **FR-024**: Tests MUST cover: paid low-ticket funnel, today 0 purchases / 5 leads / spend 3×
  target → no CB2; webinar funnel, today 0 leads / 0 purchases / spend 3× target → CB2.

**R5 — K5 cost-based rescue needs real evidence**

- **FR-025**: The cost half of the starved-ad high-efficiency test MUST require at least 2 counted
  results in the window. The CTR half keeps the 500-impression floor from 015, unchanged.
- **FR-026**: A starved ad with exactly 1 counted result and CPA ≤ target, below the floor, MUST
  take ⏳ K5 with the reason "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات".
- **FR-027**: Tests MUST cover the 1-result and 2-result cases.

**R6 — Copy left over from 015 P3**

- **FR-028**: Column headers MUST be Arabic: Spend → "الصرف", Results → "النتائج", CPA → "تكلفة
  النتيجة", Link CTR → "نسبة الضغط على الرابط". Every other English header in the table's column
  list MUST be translated in the same style. Metric abbreviations may remain only in tooltips.
- **FR-029**: The window banner MUST read: "الحكم محسوب دائمًا على آخر 3 أيام كاملة (بدون اليوم)،
  ولا يتأثر بالفترة المختارة."
- **FR-030**: Every new or changed string in this feature MUST be reviewed for simple MSA at a
  6th-grade level, correct number–noun agreement (following the existing kill-counter label
  style), and left-to-right numerals.

**Cross-cutting** (constitution)

- **FR-031**: The verdict set MUST remain exactly 🔴 🟡 🟢 🛟 ⏳; no verdict is added, renamed,
  merged or recolored (Principle VI).
- **FR-032**: Every output MUST carry its rulebook rule code verbatim, surfaced only faded and in
  tooltips (Principle II).
- **FR-033**: The Principle I evaluation order MUST hold for ad sets and ads; the campaign verdict
  MUST be derived after its ad sets are evaluated.
- **FR-034**: This feature MUST add no new Meta Graph calls and no database migrations.
- **FR-035**: Every snapshot change MUST carry a justification row; no snapshot is regenerated
  without one. Expected sources: campaign rows (R1), and possibly R3 and R5.

### Key Entities

- **Campaign summary row**: a campaign's displayed totals (spend, results, cost, full-funnel ROAS)
  plus a verdict, rule code, reason and action derived from its active child ad sets — or from its
  own gates (steps 1–4) or W5.
- **Child ad-set verdict**: an active ad set's verdict, rule code, spend and name; the input to the
  campaign derivation.
- **Counted results**: one window's result count for the account's funnel type — a number, or
  unknown. The single figure behind the verdict, the results cell, the cost cell and the footer.
- **Budget control placement**: where ±20% controls appear and whether they are enabled, decided
  by the campaign's budget type (ABO/CBO) and its active ad sets' verdicts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across every fixture and on the live account, zero campaigns show 🔴 while holding a
  🟢 ad set, and zero campaign actions say "أوقف الحملة" in that case.
- **SC-002**: Across every fixture and every table range, zero rows show results > 0 with an empty
  cost, and 100% of rows' 3-day results and cost equal the verdict's.
- **SC-003**: Zero cells display `0` for a result count Meta did not send, and zero footers sum an
  unknown sales value as zero.
- **SC-004**: Zero verdict changes from the shared result count alone (R2): the full engine suite
  passes on it before any other change in this feature is applied.
- **SC-005**: Across every fixture, zero rows hold 🔴 while their diagnosis reports insufficient
  data, other than via K3, CB1 or CB2; and zero 🟡, 🟢 or 🛟 verdicts are changed by the guard.
- **SC-006**: Zero 🛟 verdicts on an ad with fewer than 2 counted results via the cost path.
- **SC-007**: Both circuit-breaker fixtures in FR-024 behave as specified.
- **SC-008**: 100% of column headers in the table are Arabic, and the banner text matches FR-029
  exactly.
- **SC-009**: Zero CBO campaigns offer an enabled budget increase while any active ad set inside
  is not 🟢.
- **SC-010**: Every snapshot change carries a written justification; the verdict set remains
  exactly five and every rule code matches the rulebook verbatim.

## Assumptions

- **"Active, non-gated" children** (brief R1) means child ad sets that pass the status gate — the
  same meaning "gated" has throughout feature 015. A child that is ⏳ from the data gates is still
  active: it counts toward "every active ad set is 🟢" for CBO controls (rulebook §5.0: "إذا كانت
  كل مجموعاتها النشطة 🟢") and toward "none past their gates" for the ⏳ row.
- **Tie-break "first by spend"** means the child with the highest spend in the evaluation window.
- **Action wording with no 🔴 child**: when a 🟢 child exists but no 🔴 child does, the "أوقِف"
  part of the action is omitted; the brief gives no other wording, and none is invented here.
- **Evaluation window**: verdicts stay on the last 3 complete days excluding today (rulebook
  Part 4). Only the circuit breaker reads today. The table's selected range never changes a
  verdict.
- **Number–noun agreement**: new strings follow the existing kill-counter label style. The
  broader rewrite of the insufficient-data text stays in 018.
- **Scope reassignment from 015**: 015 placed the window banner and Arabic column labels in
  feature 018 (T14). The brief moves those two items into this feature; the agreement-helper
  rewrite stays in 018.
- **Verification**: tests run only with an empty `DATABASE_URL`. No constitution change is
  expected.
- **Scope of the consistency guard (FR-020)** follows rulebook §5.5 rule 2 and 015 T8: only 🔴 is
  gated. The brief's wider R3 wording (any verdict other than K3/CB1/CB2) was superseded by owner
  decision on 2026-10-20 (see Clarifications).
- **Rulebook v2.2 is the source of truth** where the brief and the rulebook could differ, except
  where the owner decides otherwise in Clarifications.

## Out of scope

- **Feature 017 — Geo tiers** (rulebook §2.5, §3.1, §5.2 G1): qualified vs cheap countries, the
  30% cheap-country target, allowed spend for mixed ad sets, and the G1 spend-leak alert. Needs
  targeting and a per-country breakdown from Meta, and a database migration.
- **Feature 018 — Identity & CPM** (rulebook Part 8, Part 11): thumbnail, campaign › ad set line
  and deep link in every panel; grouping by Post ID; CPM compared within the ad set; the
  insufficient-data text number–noun rewrite.
- Any change to ad-set or ad rule thresholds beyond R4 and R5.
- Any new verdict, badge-as-verdict, or rule code.
