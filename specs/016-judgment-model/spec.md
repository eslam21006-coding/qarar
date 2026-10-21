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
- Q: Ad sets are never 🛟 (only K5 at ad level issues a rescue), so what does the brief's "any 🛟
  child" row mean for a campaign? → A: **A count of rescue-worthy ads, no names** (owner decision).
  Count only 🛟 ads that are themselves active and sit inside the campaign's active ad sets. The
  count is appended after the ad-set instructions, omitted when 0, and never changes the campaign
  color. Ad names are left out because the campaign action is about ad sets, ad names are ambiguous
  until feature 018 (identity), and rescued ads already appear on the ad rows and in today's
  decisions.
- Q: Does the R3 guard apply to a campaign whose 🔴 is derived from its ad sets, when the
  campaign's own diagnosis says "insufficient data"? → A: **No; a derived campaign carries no
  findings** (owner decision). The guard runs on ad sets and ads only, before the campaign is
  derived, and a derived campaign verdict is never demoted. A campaign whose verdict is derived
  from its ad sets has empty findings, so no insufficient-data finding can sit next to a derived
  🔴; the diagnosis lives on the ad-set and ad rows, which "أين المشكلة؟" already shows. Exception:
  a campaign whose verdict comes from its own campaign-level step (status gate, non-sales
  exemption, pre-separation guard, event-match gate, or W5) keeps its diagnosis as today, because
  W5's diagnosis carries the discovery-call link and must not be lost. (Refined below.)

### Session 2026-10-20 (analysis follow-up — owner decisions)

- Q: The campaign evaluator has two exits FR-001 did not name — "results unknown" and "spend below
  one unit target". Keep them as campaign exits? → A: **No** (owner sign-off 2026-10-20). They are
  removed as campaign exits and kept only as W5 preconditions; the derivation covers them, because
  a campaign with no ad set past its gates is ⏳.
- Q: Which campaign rules does FR-007 remove? → A: **Every campaign rule after W5**: the 015 W1/W6
  scale guard (T070), S2, W6, K1, and the no-full-ROAS S2 fallback.
- Q: Derived campaigns display no findings (FR-020a), but today a campaign's combined-numbers
  diagnosis can turn on the account-level funnel card. Does that path survive? → A: **Yes**
  (refines the earlier answer above). A derived campaign row **displays** no findings, but its
  combined-numbers diagnosis is still computed and still feeds the account-level funnel card:
  combined numbers can reach a funnel-fault signal that no single ad set can, and Principle VII
  makes that path first-class. That diagnosis uses the campaign's **derived** verdict and
  **derived** rule code (chosen per FR-004), so it inherits that child's fault class —
  a derived K1 is still ad-fault and cannot raise the card. The old post-W5 campaign rules are
  deleted outright; no hidden card-only copy is kept. (An earlier version of this answer required
  the card to be identical to `main@a855599`; that is replaced by the coverage test and change log
  in FR-021a.)
- Q: Which child gives a derived campaign its rule code? → A: **The most severe child ad set whose
  verdict equals the derived verdict** (ties → highest spend) (owner decision D-R1). If no child has
  that verdict — a 🟡 derived from 🟢 + 🔴, or from 🔴 + ⏳, children — use the most severe child's code, and the
  campaign's rule tooltip reads "من مجموعة {ad set name}: {rule title}", so a 🟡 row never shows a
  bare stop title such as "خطر اليوم — أوقِفها فورًا". The funnel card's fault class follows the code
  actually chosen. The derived row names its source ad set for the tooltip.
- Q: Where does the "من مجموعة" prefix appear? → A: On **every** derived campaign, not only when no
  child matches the derived verdict (owner decision Q3), and on every surface that shows a derived
  campaign's rule title: the decision-table row and today's decisions (top actions), which receive
  the source ad set too (owner decision Q2).
- Q: The verdict history stores only verdict and rule, so a logged derived 🟡 campaign with CB2
  would show a bare stop title. What does the history dialog show? → A: The rule title gets the
  prefix "من إحدى مجموعاتها: " **only** when the entry's level is campaign **and** its verdict is
  watch **and** its rule is a kill-family code (K1, K2, K3, K4, K6, K7, CB2) (owner decision Q1). Pre-016
  campaign logic never produced watch with a kill-family rule, so only 016-derived 🟡 entries
  match, old entries are never relabelled, and no database change is needed.
- Q: A campaign whose only judged ad set is 🔴 CB2 (today-only) and whose combined 3-day numbers
  show 0 results now raises the funnel card (test Scenario 8b), where main's K1 kept it off.
  Accept? → A: **No** (owner decision 2026-10-20, implementation stop 1). A derived campaign's
  combined diagnosis feeds the card only when its derived rule code is **not CB1/CB2** (today-only
  codes say nothing about 3-day funnel evidence) **and** its combined 3-day counted results are
  **> 0** (zero-result combined evidence is K1 territory, which is ad-fault — as on main).
- Q: A campaign whose own 3-day count is unknown while its ad sets' counts are known — ⏳, or
  derived? → A: **Derived from its ad sets** (owner decision, implementation stop 2). The
  campaign is only a summary; its ad sets' known verdicts decide.
- Q: Some active ad sets 🔴 and the rest ⏳ — stop the campaign? → A: **No** (owner decision,
  derivation refinement). A campaign is 🔴 only when **every** active ad set is 🔴. 🔴 + ⏳ makes it
  🟡 with "أوقِف [names of the 🔴 ad sets]": stopping the whole campaign would also stop ad sets
  that have not had their chance. All ⏳ stays ⏳.
- Q: R4 lets a split-family ad set fall through to 🟢 S2 at 2.7× its target (no rule covers a cost
  above 1.5× target while spend is under 3× target). Fix now? → A: **Yes, as a guard, with no new
  rule code** (owner decision 2026-10-20, US4 stop). Any ad set or ad that reaches the S1–S4 step
  with counted 3-day results > 0 and a 3-day cost above its target becomes 🟡 W1 (FR-036). K2 and
  the order of every other rule are untouched.
- Q: What action goes with the new one-result ⏳ K5? → A: Reason "نتيجة واحدة لا تكفي للحكم —
  اتركه يجمع بيانات", action "راجعه بعد أن يحقق نتيجة ثانية".

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
3. **Given** an active campaign whose active ad sets are **all** 🔴, **When** the dashboard loads,
   **Then** the campaign is 🔴 with the action "أوقِف الحملة — كل مجموعاتها تخسر".
3a. **Given** an active campaign with one 🔴 ad set and one ⏳ ad set, **When** the dashboard
   loads, **Then** the campaign is 🟡 with the action "أوقِف «{the 🔴 ad set}»" — not "أوقِف الحملة".
4. **Given** an active campaign whose active ad sets are all ⏳, **When** the dashboard loads,
   **Then** the campaign is ⏳ with the action "اترك البيانات تتجمع".
5. **Given** an active campaign with 🟡 ad sets and no 🟢 ad set, **When** the dashboard loads,
   **Then** the campaign is 🟡 and its action lists what to do inside it.
5b. **Given** an active campaign with one 🟢 and one 🔴 ad set (CB2) and no 🟡, **When** the
   dashboard loads, **Then** it is 🟡 with rule code CB2 and its rule tooltip reads "من مجموعة
   {the 🔴 ad set's name}: خطر اليوم — أوقِفها فورًا".
5c. **Given** an active campaign with a 🟡 ad set (W3) and a more severe 🔴 ad set (K1) and no 🟢,
   **When** the dashboard loads, **Then** it is 🟡 with rule code W3, taken from the 🟡 ad set.
5d. **Given** the verdict history of a campaign, **When** the dialog shows an old entry "campaign,
   kill, K1" and a new entry "campaign, watch, CB2", **Then** the first shows the bare K1 title and
   the second shows "من إحدى مجموعاتها: خطر اليوم — أوقِفها فورًا".
5a. **Given** an active campaign whose active ad sets hold 3 active 🛟 ads, **When** the dashboard
   loads, **Then** its action ends with "فيها 3 إعلانات تستحق الإنقاذ", names no ad, and its color
   is the one its ad sets alone produce.
6. **Given** a campaign whose funnel-level W5 condition holds, **When** it is evaluated, **Then**
   it takes W5 at campaign level after the event-match gate, not a derived verdict.
7. **Given** a campaign that is paused, non-sales, a pre-separation snapshot, or fails the
   event-match gate, **When** it is evaluated, **Then** it exits at that step exactly as today.
8. **Given** an ABO campaign (no campaign budget), **When** the table renders, **Then** ±20%
   controls appear on its ad-set rows only.
9. **Given** a CBO campaign (campaign budget set) where every active ad set is 🟢, **When** the
   table renders, **Then** ±20% controls on the campaign row are enabled.
10. **Given** a CBO campaign where any active ad set is not 🟢, **When** the table renders,
    **Then** the campaign's ±20% controls are disabled with the tooltip "غيّر ميزانية الحملة فقط عندما تكون كل المجموعات بالداخل ناجحة — وإلا أوقِف المجموعات الخاسرة، والميزانية تذهب وحدها إلى الرابحة".
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
4. **Given** a campaign whose ad sets are all 🔴 and whose combined numbers would diagnose as
   insufficient data, **When** the engine runs, **Then** the campaign stays 🔴 (derived) and displays
   no findings of its own.
5. **Given** a campaign whose verdict is W5, **When** the engine runs, **Then** it keeps its
   diagnosis and the discovery-call link.
6. **Given** the existing fixtures, **When** the guard is added, **Then** every row whose verdict
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
4. **Given** an ad set with 3-day spend 2.7× its target and a 3-day cost per result 2.7× its target,
   that no K or W rule catches, **When** it reaches the continue/scale step, **Then** it is 🟡 W1
   with the reason "في آخر 3 أيام: تكلفة النتيجة {cpa} والهدف {target} — التكلفة عالية، لكن الصرف لم يصل بعد إلى حد الإيقاف ({3×target})" and the action "لا تزد الميزانية. راقبها يومين أو ثلاثة — إن وصل صرفها إلى {3×target} والتكلفة ما زالت فوق {1.5×target} فأوقِفها", never 🟢 (FR-036). Any ad above 1.5× target (ads have no K2), and an ad set whose 3-day spend is already ≥ 3× target, instead get the reason "في آخر 3 أيام: تكلفة النتيجة {cpa} والهدف {target} — التكلفة عالية" and the action "لا تزد الميزانية. إن بقيت التكلفة فوق {1.5×target} بعد يومين أو ثلاثة فأوقِف هذا الإعلان" (ad) or "لا تزد الميزانية. إن بقيت التكلفة فوق {1.5×target} بعد يومين أو ثلاثة فأوقِفها" (ad set) — no promise of a stop the engine never gives.

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
   "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات" and the action "راجعه بعد أن يحقق نتيجة ثانية".
2. **Given** a starved ad with 2 counted results and CPA ≤ target, **When** the matrix runs,
   **Then** the cost half of the high-efficiency test can fire 🛟.
3. **Given** a starved ad whose high efficiency comes from CTR, **When** the matrix runs, **Then**
   the 500-impression floor from 015 still applies unchanged.
4. **Live account (brief §4.4)**: no **cost-based** 🛟 appears on an ad with fewer than 2 counted
   results. A CTR-based 🛟 with one result is still valid (FR-025).

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
- **Only 🔴 and ⏳ children**: the campaign is 🟡, not 🔴, with "أوقِف [the 🔴 ad sets]"; the ⏳ ad
  sets have not had their chance, so the campaign is not stopped (owner decision 2026-10-20,
  refining rulebook §5.0's "كل المجموعات المحكوم عليها 🔴").
- **🟢 children plus 🟡 children, no 🔴**: the campaign is 🟡; there is no ad set to stop, so the
  action carries no "أوقِف" part.
- **🛟 ads inside the campaign**: their count is appended to the campaign's action (FR-003a); the
  campaign's derived color does not change because of it. A 🛟 ad that is paused, or that sits in a
  paused ad set, is not counted.
- **Several children of the same severity**: the derived rule code comes from the one with the
  highest spend in the window.
- **🟢 + 🔴 children, no 🟡**: the campaign is 🟡 but no child is 🟡, so its code comes from the most
  severe child (a 🔴), and the tooltip says which ad set it came from ("من مجموعة …").
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
  status gate → non-sales exemption → pre-separation guard → event-match gate. The campaign-level
  "results unknown" exit and "spend below one unit target" exit MUST be removed as campaign exits
  and kept only as W5 preconditions; the derivation covers them (no ad set past its gates ⇒
  campaign ⏳). Owner sign-off 2026-10-20.
- **FR-002**: W5 (funnel-level: lead or low-ticket results fine, but no high-ticket follow-through)
  MUST remain a campaign-level verdict, evaluated after step 4. It is a funnel judgment, not a sum
  of ad sets.
- **FR-003**: Otherwise, the campaign verdict MUST be derived from its **active** child ad-set rows
  (those that pass the status gate), after those ad sets are evaluated:

  | Child ad sets | Campaign verdict | Campaign action |
  |---|---|---|
  | ≥ 1 🟢 | never 🔴. 🟢 if none are 🔴/🟡, else 🟡 | "أوقِف [names of 🔴 ad sets] وأبقِ [names of 🟢 ad sets]" |
  | every active child 🔴 | 🔴 | "أوقِف الحملة — كل مجموعاتها تخسر" |
  | none past their gates | ⏳ | "اترك البيانات تتجمع" |
  | 🔴 + ⏳ only (no 🟢, no 🟡) | 🟡 | "أوقِف [names of 🔴 ad sets]" |
  | otherwise | 🟡 | list what to do inside |
  | any 🛟 ad inside its active ad sets | (unchanged) | append the count of rescue-worthy ads (FR-003a); never changes the derived color |

  "Judged" means a verdict other than ⏳.
- **FR-003a**: The campaign action MUST end with a count of rescue-worthy ads: ads whose verdict is
  🛟, that are themselves active, and that sit inside the campaign's active ad sets. The count is
  appended after the ad-set instructions, uses these exact forms, and names no ad:

  | Count | Text |
  |---|---|
  | 0 | omitted |
  | 1 | "فيها إعلان واحد يستحق الإنقاذ" |
  | 2 | "فيها إعلانان يستحقان الإنقاذ" |
  | 3–10 | "فيها {n} إعلانات تستحق الإنقاذ" |
  | 11+ | "فيها {n} إعلانًا يستحق الإنقاذ" |

  The count MUST NOT change the campaign's derived color or rule code.
- **FR-004**: The derived verdict's rule code MUST be the rule of the most severe child ad set **whose verdict equals the derived verdict** (ties → highest spend); if no child has that verdict (only possible for a 🟡 derived from 🟢 + 🔴 or from 🔴 + ⏳ children), the rule of the most severe child. Severity is ranked
  kill > watch > rescue > continue > too_early. The derived row MUST name the ad set its code came
  from, and every derived campaign's rule title — on every derived campaign, whether or not its
  source ad set's verdict matches, and on every surface that shows it (the decision-table row and
  today's decisions) — MUST read "من مجموعة {ad set name}: {rule title}". With no active ad set, the
  code is GATE and no ad set is named (owner decisions D-R1, Q2, Q3).
- **FR-004a**: In the verdict history dialog, an entry's rule title MUST get the prefix
  "من إحدى مجموعاتها: " exactly when the entry's level is campaign, its verdict is watch, and its rule
  is one of K1, K2, K3, K4, K6, K7, CB2; every other entry keeps today's title. No database change
  (owner decision Q1).
- **FR-005**: The derived reason MUST state how many children hold each color, with correct
  Arabic number–noun agreement.
- **FR-006**: Campaign full-funnel ROAS MUST stay displayed (row and tooltip) and MUST NOT be a
  source of any campaign verdict.
- **FR-007**: Every campaign rule after W5 MUST be removed as a source of the campaign's verdict,
  rule code, reason and action — the 015 W1/W6 scale guard (T070), S2, W6, K1, and the
  no-full-ROAS S2 fallback. This supersedes the interim campaign reading recorded in 015 (015
  FR-029 assumption). The rules MUST be deleted outright; no copy of them may be kept for any other
  purpose, including the funnel card.
- **FR-008**: ABO campaigns (no campaign daily budget) MUST show ±20% budget controls on their
  ad-set rows only.
- **FR-009**: CBO campaigns (campaign daily budget set) MUST show ±20% controls on the campaign
  row, enabled only when every active ad set inside is 🟢; otherwise disabled with the tooltip
  "غيّر ميزانية الحملة فقط عندما تكون كل المجموعات بالداخل ناجحة — وإلا أوقِف المجموعات الخاسرة، والميزانية تذهب وحدها إلى الرابحة". Both
  buttons stay disabled, −20% included (owner decision S3, 2026-10-21: the tooltip now says what to
  do instead).
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
- **FR-020**: The guard MUST run on ad-set and ad rows only, and before the campaign verdict is
  derived, so the derivation reads the guarded ad-set verdicts. If a row's verdict is 🔴, the
  diagnosis for that row reports insufficient data, and the fired rule is not K3, CB1 or CB2, the
  row's verdict MUST become ⏳ with rule code GATE, and the reason MUST come from the diagnosis. 🟡, 🟢 and 🛟 verdicts MUST NOT be changed by this guard.
- **FR-020a**: A campaign whose verdict is derived from its ad sets (FR-003) MUST display no
  findings of its own (its row's findings are empty), and its derived verdict MUST never be demoted
  by the guard. Its combined-numbers diagnosis MUST still be computed — under the same condition
  as any row (verdict 🔴 or 🟡, not exempt) — with the campaign's **derived** verdict and **derived**
  rule code, and MUST feed the account-level funnel card **only when** (a) the derived rule code is
  not CB1 or CB2 (today-only codes say nothing about 3-day funnel evidence) **and** (b) the
  campaign's combined 3-day counted results are greater than 0 (zero-result combined evidence is
  K1 territory, which is ad-fault — as on main); an unknown count is not > 0. The fault class
  follows the code actually chosen under FR-004, so a derived ad-fault rule (e.g. K1) cannot raise
  the card either. A
  campaign whose verdict comes from its own campaign-level step — status gate, non-sales
  exemption, pre-separation guard, event-match gate, or W5 — MUST keep its diagnosis as today,
  including W5's discovery-call link.
- **FR-021**: The guard MUST be tested for a gated 🔴 case, for each of K3, CB1 and CB2, and for a
  🟡, a 🟢 and a 🛟 row that it leaves unchanged. Any existing fixture whose verdict changes MUST
  be listed in the snapshot-changes table with a justification.
- **FR-021a**: Tests MUST cover: a derived 🔴 campaign displays empty findings; a W5 campaign keeps
  its findings and its discovery-call link; and the funnel card, in two parts:
  1. **Coverage**: the card is shown whenever any ad-set row, any ad row, a W5 campaign row, or a
     derived campaign's combined diagnosis (with its derived rule) yields a funnel-fault finding
     that is not excluded by an ad-fault rule or an ad-side rung — and only then.
  2. **Change log**: every fixture used by the FR-018 invariant tests is run against `main@a855599`
     and against this branch. Every fixture where `account_funnel_cta` differs gets a row in a
     "Funnel card changes" table in the implementation report (fixture | main output | new output |
     justification). An unjustified difference is a bug: implementation stops and it is
     reported.

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
  take ⏳ K5 with the reason "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات" and the action
  "راجعه بعد أن يحقق نتيجة ثانية".
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
- **FR-036** (owner decision 2026-10-20, US4 stop): An ad set or ad that reaches the S1–S4 step —
  after every K and W rule — with counted 3-day results > 0 and a 3-day cost per result above its
  target MUST become 🟡 W1 instead of 🟢. No new rule code; K2 (spend ≥ 3× target) and the order
  of every other rule stay as they are, so only rows that would have been 🟢 can move. Cost 1×–1.5×
  target: the existing W1 reason and action, unchanged. Cost above 1.5× target, for an ad set whose 3-day spend is under 3× target (K2 still ahead of it): reason
  "في آخر 3 أيام: تكلفة النتيجة {cpa} والهدف {target} — التكلفة عالية، لكن الصرف لم يصل بعد إلى حد الإيقاف ({3×target})"; action "لا تزد الميزانية. راقبها يومين أو ثلاثة — إن وصل صرفها إلى {3×target} والتكلفة ما زالت فوق {1.5×target} فأوقِفها". Every other case above 1.5× target — any ad (ads have no K2: evaluateAd runs K1 only), or an ad set whose 3-day spend is already ≥ 3× target — names a cost limit instead of a stop the engine never gives: reason "في آخر 3 أيام: تكلفة النتيجة {cpa} والهدف {target} — التكلفة عالية"; action for an ad "لا تزد الميزانية. إن بقيت التكلفة فوق {1.5×target} بعد يومين أو ثلاثة فأوقِف هذا الإعلان"; for an ad set "لا تزد الميزانية. إن بقيت التكلفة فوق {1.5×target} بعد يومين أو ثلاثة فأوقِفها" (owner fix, pre-PR). Money in the
  existing format, numerals left-to-right. Rulebook v2.2.1 widens W1 to "CPA فوق الهدف ولم تكتمل
  شروط K2 (صرف ≥ 3× الهدف)".

### Key Entities

- **Campaign summary row**: a campaign's displayed totals (spend, results, cost, full-funnel ROAS)
  plus a verdict, rule code, reason and action derived from its active child ad sets — or from its
  own gates (steps 1–4) or W5. A derived campaign displays no findings of its own, though its
  combined-numbers diagnosis (with its derived verdict and rule) still feeds the account funnel
  card; one judged by its own step keeps its diagnosis.
- **Derived-from ad set**: the ad set whose rule code a derived campaign carries; named in the
  campaign's rule tooltip.
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
  Zero campaigns with a derived verdict display findings of their own, 100% of W5 campaigns keep
  their discovery-call link, and 100% of fixtures where the funnel card differs from `main@a855599`
  carry a written justification.
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
- **Campaign exits removed (FR-001)**: the 015 results-unknown exit and the spend-below-target
  exit no longer end a campaign's evaluation; they only gate W5. An unknown or under-spent campaign
  is still ⏳, because its ad sets are (owner sign-off 2026-10-20).
- **Funnel card input for derived campaigns (FR-007, FR-020a)**: the campaign's combined-numbers
  diagnosis runs with its derived verdict and rule, not the deleted pre-016 rules. The card can
  therefore change where a campaign's old rule differed from its derived one (for example, an old
  S2 🟢 was never diagnosed, but a derived 🟡 is). Each such change is logged and justified (FR-021a
  part 2); owner decision 2026-10-20.
- **The guard and derived campaigns**: rulebook §5.5 rule 2 is met on campaign rows by giving a
  derived campaign no findings of its own (FR-020a), not by gating it; its 🔴 only summarises ad
  sets that already passed the guard (§5.0). Owner decision 2026-10-20, see Clarifications.
- **"Any 🛟 child" in the brief reaches the ads**: ad sets cannot be 🛟 — only the ad-level K5
  starved-ad check issues a rescue — so the brief's R1 row "any 🛟 child" is read as "any 🛟 ad
  inside the campaign's active ad sets" (owner decision 2026-10-20, see Clarifications).
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
