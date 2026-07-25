# Feature Specification: Appointment & Webinar Archetypes

**Feature Branch**: `012-appointment-webinar-archetypes`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Replace the unused `direct_call` archetype with two real, working archetypes: `appointment` (call-booking funnels) and `webinar` (free event/webinar funnels), each with their own funnel-math-based target calculation instead of relying on inaccurate manual guesses or a generic fallback."

## Overview

Today the product offers three funnel archetypes. Two of them (`paid_lto`, `free_lead`) have real
decision math behind them. The third, `direct_call`, is a scaffold: it appears in the settings
dropdown and is saved to the database, but no decision logic ever reads it. Any account that picks
it silently gets the product-purchase math intended for `paid_lto` — a formula built around an
average order value that a call-booking funnel does not have. The resulting cost target is
meaningless, and nothing tells the user that.

A production check confirmed **zero** accounts currently use `direct_call`, so it can be replaced
outright with no data migration.

This feature replaces it with two archetypes that describe how these businesses actually sell —
**appointment** (a lead books a call, shows up, and the call closes into a sale) and **webinar**
(a lead shows up to a free event and closes into a sale) — and gives each one a cost target derived
from the user's own funnel stage rates instead of a borrowed formula or a hand-waved guess.

## Clarifications

### Session 2026-07-24

- Q: Should appointment/webinar reuse the lead-generation judgement thresholds or the product-purchase
  ones the retired option silently inherited? → **A: Adopt the lead-generation thresholds.** Both new
  archetypes use the same landing-page conversion floor as `free_lead` (15%, not 2%) and have the
  cost-per-lead kill anchors active. `free_lead` and `paid_lto` behaviour is unchanged.
- Q: When a lead-cost target cannot be determined, how should the product surface it? → **A: As an
  ordinary per-ad "too early" outcome**, using the existing verdict and gate path. No account-level
  blocking card, no new verdict, no new dashboard surface. Each row carries its own reason pointing
  the user to the settings that would resolve it.
- Q: Which existing settings fields stay visible for appointment/webinar? → **A: Hide the three that
  no longer affect anything** — average order value, required return multiple, and high-ticket
  conversion rate. Previously stored values are retained, not erased.
- Q: When the target comes from measured history or the market benchmark rather than funnel math,
  what does the settings maximum-cost-per-lead row display? → **A: Show the judging target as the
  primary row, and when the funnel-math ceiling is also computable and differs from it, show that
  ceiling as a second row.** The two collapse to a single row whenever they match.
- Q: Does the "the expensive product isn't selling" signal stay available for the new archetypes? →
  **A: Yes — keep the input and its rule active, but reword it per archetype.** Its current wording
  assumes a first sale that these funnels do not have; the underlying signal is still valid and is
  reworded to describe each funnel's own final step.
- Q: What does a stage rate of exactly zero mean? → **A: It is rejected at entry.** The valid range is
  greater than zero through 100. A zero at any stage does not describe a working funnel, and allowing
  it would create a state where a user's typed answer is silently discarded. "Unanswered" therefore
  means only "left empty".
- Q: What happens when the measured 30-day median counts a different event than a lead (a booked call
  or a sale), making it 10–30× larger than a cost per lead? → **A: Inherit the existing behaviour
  as-is and record it as a known limitation.** No automatic guard ships in this feature; any detection
  belongs with the deferred staleness work.
- Q: The structural-loss kill rule fires when cost per lead reaches the ceiling, but `free_lead` uses
  0.7 × lead value while the new archetypes' ceiling is 0.5 × lead value. Which value fires the kill
  for appointment and webinar? → **A: The funnel-math ceiling (0.5 × lead value)** — the same figure
  shown in settings. The number the product displays as the ceiling must be the number that acts on
  it. This is stricter than `free_lead`, deliberately, and `free_lead`'s own 0.7 anchor is unchanged.
- Q: Purchases are matched before leads when counting conversions, so an appointment or webinar
  account that also records sales would be judged on cost per purchase against a cost-per-lead
  target. What counts as a conversion for these funnels? → **A: Capture lead and purchase counts
  separately, and judge appointment and webinar against the lead count.** Existing archetypes keep
  today's selection unchanged.
- Q: The dashboard has a prominent cost-per-lead target tile. What does it show when no target is
  determinable? → **A: Keep the tile and replace the value with a short simple-Arabic phrase** such
  as "لم يتحدد بعد", signalling that the number is waiting on the user rather than on data. The
  existing money formatter renders an absent value as "∞", which must never reach a target surface.
- Q: Two verdict rules read "full customer value", which is built from average order value and the
  high-ticket conversion rate — both now hidden for the new archetypes. What is full customer value
  for appointment and webinar? → **A: It is the lead value.** For these funnels the conversion event
  is the lead, so one conversion is worth exactly what one lead is worth. It is absent when the stage
  rates are incomplete, and the two rules that read it do not fire while it is absent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Appointment funnel owner gets a real lead-cost target (Priority: P1)

A coach sells a high-ticket program over a booked phone call. On the settings page she picks
"I book calls with customers, then sell on the call". The form asks her three plain questions about
her funnel — out of every 100 leads how many book a call, out of every 100 bookings how many show
up, and out of every 100 calls how many end in a sale — each with a typical range shown inside the
empty box so she knows what a normal answer looks like. She enters her numbers alongside her
program price, and the page immediately shows her the most she can afford to pay for one lead.

**Why this priority**: This is the whole point of the feature. Without it, call-booking businesses
are judged against a number derived from a product purchase they do not sell. It is the smallest
slice that delivers real value on its own, and it is the archetype the retired `direct_call`
option was nominally for.

**Independent Test**: Pick the appointment archetype, fill the three rates and the high-ticket
price, and confirm the settings page shows a maximum-cost-per-lead figure that matches the funnel
math. Fully testable with no other story implemented.

**Acceptance Scenarios**:

1. **Given** an account with no historical cost data and no market benchmark entered, **When** the
   user selects the appointment archetype and enters book rate 6%, show rate 70%, close rate 22%,
   and a high-ticket price of 2000, **Then** the settings page shows a maximum cost per lead of
   approximately 9.24 and the target is attributed to the funnel-math source.
2. **Given** the same account, **When** the user lowers the close rate from 22% to 11%, **Then** the
   maximum cost per lead falls (to approximately 4.62) — it never rises.
3. **Given** the same account, **When** the user lowers the book rate from 6% to 3%, **Then** the
   maximum cost per lead falls (to approximately 4.62) — a worse booking rate must never produce a
   more generous target.
4. **Given** an empty appointment form, **When** the user looks at the three rate boxes, **Then**
   each shows its typical range as greyed hint text inside the box (`3-10%`, `~70%`, `20-25%`) and
   none of those hints is ever saved as an actual value.
5. **Given** an appointment account where the user has left the close rate empty, **When** the target
   is computed, **Then** the funnel-math source is not used and the product falls through to the next
   available source.
6. **Given** any stage-rate box, **When** the user enters `0`, `-5`, or `120`, **Then** the entry is
   rejected with a simple-Arabic message and nothing is saved.
7. **Given** a user switching from the cheap-product archetype to appointment, **When** the form
   re-renders, **Then** the average order value, required return multiple, and high-ticket conversion
   rate inputs are no longer shown, the high-ticket price remains, and the product-purchase breakdown
   panel is hidden.
8. **Given** that same user switching back to the cheap-product archetype, **When** the form
   re-renders, **Then** their previously entered average order value, return multiple, and
   high-ticket conversion rate are still present and unchanged.
9. **Given** an appointment account whose landing page converts at 8%, **When** the page is
   evaluated, **Then** it is flagged as weak — the lead-generation floor of 15% applies, not the
   product-purchase floor of 2%.
10. **Given** an appointment account, **When** the user reaches the "expensive product isn't selling"
    question, **Then** it is worded for a call funnel ("الناس تحجز وتحضر لكن لا تشتري؟") rather than
    with the first-sale wording, and ticking it still drives the funnel-level rule as it does today.
11. **Given** an account that previously used the cheap-product archetype with an average order value
    of 47 and a high-ticket conversion rate of 4%, **When** it switches to appointment and its
    campaigns are evaluated, **Then** no verdict anywhere depends on those two stored values — the
    full customer value used is the lead value derived from the stage rates alone.
12. **Given** an appointment account with complete stage rates whose cost per lead sits below the
    ceiling, **When** an object's cost per lead is above the judging target, **Then** the
    above-target-but-profitable rule may still return a continue verdict, and it does so on the
    strength of the lead value — never on a figure built from hidden inputs.
13. **Given** an appointment account recording 200 leads and 2 sales in the judged window, **When**
    its cost per result is computed, **Then** it is spend ÷ 200, not spend ÷ 2, and the page
    conversion rate checked against the 15% floor uses the 200 as well.
14. **Given** the same account, **When** a `paid_lto` account in the same system is evaluated,
    **Then** its conversion count is unchanged from before this feature.

---

### User Story 2 - Webinar funnel owner gets a real lead-cost target (Priority: P2)

A course seller runs free online workshops and sells at the end. He picks "I invite people to a
free webinar, then sell afterwards", answers two questions — out of every 100 registrants how many
actually attend, and out of every 100 attendees how many buy — and sees his maximum affordable cost
per registration.

**Why this priority**: Same value as Story 1 for a different, equally common funnel shape. It is
second only because it shares the machinery Story 1 introduces, so it is cheaper once Story 1
exists, and the appointment case is the direct successor to the retired option.

**Independent Test**: Pick the webinar archetype, fill the two rates and the high-ticket price, and
confirm the settings page shows a maximum-cost-per-lead figure matching the funnel math.

**Acceptance Scenarios**:

1. **Given** an account with no historical cost data and no market benchmark, **When** the user
   selects the webinar archetype and enters show-up rate 25%, close rate 5%, and a high-ticket
   price of 2000, **Then** the settings page shows a maximum cost per lead of 12.50 attributed to
   the funnel-math source.
2. **Given** the same account, **When** the user lowers the show-up rate from 25% to 15%, **Then**
   the maximum cost per lead falls — it never rises.
3. **Given** an empty webinar form, **When** the user looks at the two rate boxes, **Then** they show
   `15-30%` and `1-8%` as greyed hint text inside the boxes.
4. **Given** a webinar account, **When** the user views the form, **Then** the book-rate question is
   not shown, because a webinar registration has no separate booking step.
5. **Given** a webinar account, **When** the user views the form, **Then** the average order value,
   required return multiple, and high-ticket conversion rate inputs are hidden, and the "expensive
   product isn't selling" question is worded for a webinar ("الناس تحضر الندوة لكن لا تشتري؟").
6. **Given** a webinar account with no measured history, no rates, and no benchmark, **When** the
   user opens the dashboard, **Then** every evaluated object shows the "too early" verdict and no
   numeric target is displayed anywhere.
7. **Given** a webinar account whose measured cost per lead exceeds its computable funnel-math
   ceiling, **When** objects are evaluated, **Then** the structural-loss anchor fires against the
   ceiling shown in settings — the same number, not a different multiple of the lead value.

---

### User Story 3 - Real historical data outranks manual math (Priority: P2)

An appointment-funnel account that has been running ads for over a month already has real
cost-per-result history. That measured number reflects the actual auction, audience, creative, and
landing page — things no hand calculation can capture — so it is used as the target in preference
to the user's own arithmetic. If there is no history, the user's funnel math is used. If there is
neither, a market benchmark the user typed in is used.

**Why this priority**: Getting the ordering wrong means mature accounts are judged against a paper
estimate instead of their own measured reality. It rides on Stories 1–2 existing but is a distinct,
separately verifiable behaviour.

**Independent Test**: For one appointment account, toggle the availability of each of the three
sources in turn and confirm the target value and its attributed source change in the documented
order.

**Acceptance Scenarios**:

1. **Given** an appointment account with 30-day median cost history available, complete funnel
   rates, and a market benchmark entered, **When** the target is computed, **Then** the historical
   median is used and the source is reported as the baseline source.
2. **Given** the same account with no historical median, **When** the target is computed, **Then**
   the funnel-math value is used and the source is reported as the funnel-math source.
3. **Given** the same account with no historical median and incomplete funnel rates, **When** the
   target is computed, **Then** the market benchmark is used and the source is reported as the
   benchmark source.
4. **Given** any appointment or webinar account, **When** the target is computed, **Then** the
   product-purchase fallback formula is never used, regardless of which inputs are missing.
5. **Given** an appointment account with a measured median of 20 and funnel rates yielding a ceiling
   of 9.24, **When** the user opens settings, **Then** two rows are shown — a judging target of 20 and
   a funnel-math ceiling of 9.24 — and the page states plainly that the account is paying more per
   lead than its funnel can support.
6. **Given** an appointment account whose target comes from funnel math, **When** the user opens
   settings, **Then** only one cost-per-lead row is shown, because the target and the ceiling are the
   same number.
7. **Given** an appointment account with a measured median but no funnel rates entered, **When** the
   user opens settings, **Then** only the judging target row is shown, because no ceiling is
   computable.

---

### User Story 4 - Honest "not enough information" instead of a wrong number (Priority: P3)

A brand-new appointment account has no ad history, has not filled in its funnel rates, and has not
entered a market benchmark. Rather than inventing a target from unrelated numbers, the product says
plainly that it does not yet have enough information to judge, and points the user at what to fill
in.

**Why this priority**: It prevents the exact failure this feature exists to fix — a confident-looking
number with nothing real behind it. It is P3 only because it is the empty-state path; the populated
paths deliver the value first.

**Independent Test**: Create an appointment account with none of the three sources available and
confirm no numeric target is shown anywhere and an explicit not-enough-information state appears.

**Acceptance Scenarios**:

1. **Given** an appointment account with no historical median, no complete funnel rates, and no
   market benchmark, **When** the user opens the settings page, **Then** no maximum-cost-per-lead
   figure is shown and the page states in simple Arabic that there is not enough information yet.
2. **Given** that same account, **When** the user opens the decision dashboard, **Then** every
   evaluated object shows the existing "too early" verdict, and no ad is given a kill, watch,
   continue, or rescue verdict on the basis of a fabricated target.
3. **Given** that same account, **When** the user reads any of those rows, **Then** the reason states
   in simple Arabic that the cost target is not yet known, the action points to the funnel numbers in
   settings, and the rule code stays faded and tooltip-only.
4. **Given** that same account, **When** the user opens the dashboard, **Then** no account-level
   blocking notice appears — the dashboard renders normally with per-row explanations.
5. **Given** that same account, **When** the user then fills in the three funnel rates, **Then** the
   target appears and the not-enough-information state clears everywhere without any further action.
6. **Given** that same account, **When** the user looks at the dashboard's cost-per-lead target tile,
   **Then** it shows a short simple-Arabic phrase indicating no target has been set yet — never a
   number, a currency amount, or an infinity symbol.
7. **Given** that same account, **When** the user views the decision table, **Then** cost-per-result
   cells are not coloured as good or bad, because there is no target to compare them against.

---

### Edge Cases

- **A rate of zero is entered** — rejected at the point of entry with a simple-Arabic message, never
  saved. A zero at any stage would drive the lead value and the target to zero, judging every ad as a
  failure; and accepting it while treating it as "unanswered" would silently discard what the user
  typed. Neither is honest, so the input is refused instead.
- **A rate above 100 or below zero is entered** — rejected the same way, never saved and never fed
  into the math.
- **A required rate is left empty** — the funnel-math source is skipped and the next source in the
  priority order is used. This is the only way a rate can be absent.
- **The high-ticket price is missing or zero** — the funnel math has nothing to value a sale with, so
  the funnel-math source is skipped.
- **Every rate is 100%** — the target equals half the high-ticket price. This is the arithmetic upper
  bound and is correct, not an error.
- **The user switches archetype after saving** — rates already stored are kept, not erased. Fields
  irrelevant to the newly chosen archetype are hidden and ignored by the math, so switching back
  restores the previous answers without re-typing.
- **The user's prices are in a different currency from the ad account** — the stage rates are
  percentages and carry no currency; the resulting target follows the same currency handling already
  applied to the high-ticket price, so the target lands in account currency.
- **Historical cost data is stale because the user changed their offer or price** — explicitly out of
  scope (see Out of Scope). The measured history still wins.
- **A `direct_call` row appears unexpectedly during rollout** — the production count is zero, but the
  change must fail loudly rather than silently strand or reinterpret such a row.
- **A target becomes available part-way through a session** — the moment a rate is filled or history
  arrives, the "too early" state clears; no manual refresh or re-save is required to leave it.
- **An account has a target but an ad is still genuinely too early** — the pre-existing age,
  impression, and spend gates continue to apply unchanged. The new no-target condition is an
  additional reason for "too early", never a replacement for the existing ones.
- **A hidden input holds a stale value** — average order value and the return multiple may retain
  numbers from a previous archetype. They are ignored entirely by the new math, so a stale value
  cannot influence an appointment or webinar target.
- **The measured cost per lead sits above the funnel-math ceiling** — the structural-loss anchor
  fires broadly across the account, because at that cost per lead the funnel genuinely does not pay
  for itself. This is the intended verdict, not a malfunction: it is the same conclusion FR-027b
  states in words on the settings page, expressed as decisions. The user's route out is to fix the
  offer, the price, or the stage rates — which is exactly what the accompanying action says.
- **Stage rates are filled in for the first time on an already-expensive account** — the ceiling
  becomes computable and the structural-loss anchor can begin firing where it previously could not.
  The change in verdicts is a consequence of newly available information, not of the ads changing.
- **A user switches from the cheap-product archetype and their old average order value is still
  stored** — full customer value MUST NOT be computed from it. For the new archetypes that figure is
  the lead value, so a stale average order value can never produce a "your campaign is profitable"
  verdict built on inputs the user can no longer see or correct.
- **An appointment account records both leads and sales in the same ad account** — the normal case for
  these funnels. Leads are what it is judged on; sales are recorded but do not become the denominator
  of its cost per result. Without this separation the account would be measured on cost per sale
  against a cost-per-lead target, roughly two orders of magnitude apart.
- **A cached snapshot predates the separated counts** — it holds only the old combined count, which
  may be either leads or sales with no way to tell. For `appointment` and `webinar` that count MUST
  NOT be reused as a lead count. The affected objects read as not-yet-measurable until a fresh
  snapshot is captured, which is the honest state: the product genuinely does not know what the
  cached number counted.
- **An appointment account records sales but no tracked leads** — the lead count is zero and stays
  zero. The account reads as producing no results, which is an honest description of what is being
  measured, and the ordinary zero-result rules apply. The purchase count is never substituted in.
- **An absent target reaches a display helper** — the shared money formatter renders a missing value
  as an infinity symbol. On a target surface that reads as "you may pay anything per lead", which is
  both false and the exact opposite of the intended message. Every target display must therefore
  decide what to show *before* handing the value to that helper, never rely on its default.
- **Stage rates are incomplete, so full customer value is absent** — the profitable-campaign and
  above-target-but-profitable rules simply do not fire. They are skipped, not evaluated against zero;
  an object that would otherwise qualify falls through to the ordinary rules rather than being
  silently denied.

## Requirements *(mandatory)*

### Functional Requirements

#### Archetypes

- **FR-001**: The system MUST offer `appointment` and `webinar` as two separate, selectable funnel
  archetypes.
- **FR-002**: The system MUST remove `direct_call` as a selectable and storable archetype.
- **FR-003**: The system MUST NOT perform any data migration for `direct_call`, as zero accounts use
  it; the change MUST fail loudly rather than silently drop or reinterpret data if any such record
  is encountered.
- **FR-004**: The settings archetype dropdown MUST present both new options in simple Arabic,
  consistent in phrasing with the two existing options. Proposed wording: `appointment` →
  "أحجز مكالمات مع العملاء ثم أبيع في المكالمة"; `webinar` → "أدعو الناس إلى ندوة مجانية ثم أبيع بعدها".

#### Funnel inputs

- **FR-005**: The system MUST capture three stage rates for the appointment archetype: the share of
  leads that book a call, the share of bookings that show up, and the share of calls that close into
  a sale.
- **FR-006**: The system MUST capture two stage rates for the webinar archetype: the share of
  registrants that show up, and the share of attendees that buy.
- **FR-007**: The close-rate input MUST be a single shared concept reused across both archetypes,
  with archetype-appropriate wording, rather than two separate stored values.
- **FR-008**: All stage-rate inputs MUST be optional and unset by default. An unanswered rate MUST be
  stored as genuinely absent, never as a substitute number, so "not answered" is always
  distinguishable from any value the user actually entered.
- **FR-009**: Stage-rate inputs MUST accept values greater than 0 and up to 100 inclusive, and MUST
  reject 0, negative values, and anything above 100 with a simple-Arabic message. A rate of zero does
  not describe a working funnel; rejecting it at entry keeps "unanswered" the only meaning of an
  absent value.
- **FR-010**: Each stage-rate input MUST show its typical benchmark range as hint text inside the
  empty box — appointment: `3-10%`, `~70%`, `20-25%`; webinar: `15-30%`, `1-8%` — and this hint MUST
  never be persisted or submitted as a real value.

#### Target calculation

- **FR-011**: For the appointment archetype, the system MUST compute the chance a lead eventually
  buys as the product of all three stage rates, the lead value as that chance multiplied by the
  high-ticket price, and the **funnel-math ceiling** as half that lead value.
- **FR-012**: For the webinar archetype, the system MUST compute the chance a lead eventually buys as
  the product of both stage rates, the lead value as that chance multiplied by the high-ticket price,
  and the **funnel-math ceiling** as half that lead value.

> **Terminology.** "Funnel-math ceiling" is the canonical prose term for this quantity throughout the
> spec, plan, and contracts; `cplCeiling` is its field name in code. The user-facing Arabic label
> ("أقصى تكلفة للعميل المحتمل" — maximum cost per lead) is display copy and is deliberately different;
> where this document describes what a user *sees*, "maximum cost per lead" refers to that label, not
> to the derived quantity.
- **FR-013**: The calculation MUST be monotonic in every stage rate: reducing any single stage rate,
  holding the others constant, MUST reduce the resulting target and MUST NEVER increase it.
- **FR-014**: With book rate 6%, show rate 70%, close rate 22%, and high-ticket price 2000, the
  appointment target MUST be approximately 9.24.
- **FR-015**: The funnel-math source MUST be used only when every stage rate required by the chosen
  archetype, and the high-ticket price, are present and greater than zero.
- **FR-015a**: For `appointment` and `webinar`, the "full customer value" figure that the profitable-
  campaign and above-target-but-still-profitable rules read MUST be the lead value. For these funnels
  the conversion event is the lead, so one conversion is worth exactly what one lead is worth. It MUST
  NOT be derived from average order value or the high-ticket conversion rate, both of which are hidden
  for these archetypes and therefore cannot be corrected by the user.
- **FR-015b**: For `appointment` and `webinar`, full customer value MUST be absent whenever the lead
  value is not computable — that is, whenever any required stage rate or the high-ticket price is
  missing. While it is absent, the two rules that read it MUST NOT fire. An absent value MUST NOT be
  substituted with zero, which would silently disable those rules while appearing to evaluate them.
- **FR-015c**: The existing full-customer-value formula MUST remain unchanged for `free_lead` and
  `paid_lto`. Those archetypes still show the inputs it is built from, so the figure remains
  correctable there; this feature MUST NOT alter it for them.

#### Conversion measurement

- **FR-030**: The system MUST record lead-type and purchase-type conversion counts as separate
  measurements, rather than collapsing them into a single count that silently prefers one over the
  other.
- **FR-031**: For `appointment` and `webinar`, every rule that reads a conversion count, a cost per
  result, or a page conversion rate MUST use the lead-type count. These funnels are judged on the
  cost of acquiring a lead, so the measurement MUST be denominated in the same unit as the target.
- **FR-032**: For `free_lead` and `paid_lto`, conversion counting MUST remain exactly as it is today.
  The separation of counts is additive; it MUST NOT change which number those archetypes are judged
  on, for any input.
- **FR-033**: The measured 30-day median used as the first target source MUST be denominated in the
  same unit as the conversion count the same archetype is judged against. For `appointment` and
  `webinar` that means a lead-based median. A target and a measurement on different bases would
  reintroduce the very mismatch this requirement exists to remove, only inverted.
- **FR-034**: When an account records no lead-type conversions at all, the lead count MUST be treated
  as genuinely zero rather than silently substituted with the purchase count. An appointment funnel
  producing sales but no tracked leads is a real, reportable state — not an invitation to judge it on
  a different unit.
- **FR-035**: Cached data captured before the counts were separated MUST NOT be reinterpreted as a
  lead count for `appointment` or `webinar`, because it may hold either unit. Objects backed only by
  such data MUST read as not yet measurable until fresh data is captured, and MUST NOT be judged on
  an ambiguous number.

#### Target source priority

- **FR-016**: For `appointment` and `webinar`, the system MUST select the target in this order:
  (1) the account's measured 30-day median cost per result, (2) the funnel-math value, (3) the
  user-entered market benchmark.
- **FR-017**: Each selected target MUST carry an attribution identifying which of the three sources
  produced it, and the funnel-math source MUST be distinguishable from the other two.
- **FR-018**: For `appointment` and `webinar`, the system MUST NEVER fall back to the
  product-purchase cost formula used by `paid_lto`, under any combination of missing inputs.
- **FR-019**: When none of the three sources is available, the system MUST NOT display or judge
  against any numeric target. On the decision dashboard this MUST surface as the existing "too early"
  verdict on each evaluated object, carrying the existing gate rule code, with a simple-Arabic reason
  stating that the cost target is not yet known and an action directing the user to complete their
  funnel numbers in settings. No account-level blocking notice and no new dashboard surface is
  introduced.
- **FR-019a**: On the settings page the same condition MUST replace the maximum-cost-per-lead preview
  row with a short simple-Arabic line stating there is not enough information yet and naming what to
  fill in. This occupies the existing preview area — it is not a new page-level surface.
- **FR-019b**: The dashboard's cost-per-lead target tile MUST remain present when no target is
  determinable, with its value replaced by a short simple-Arabic phrase indicating the target has not
  been set yet (proposed: "لم يتحدد بعد"). The tile MUST NOT be removed, because its absence would
  hide the fact that a target is expected at all.
- **FR-019c**: No surface may render an absent target as a number, as a currency amount, or as any
  glyph implying an unbounded value. The existing shared money formatter returns the infinity symbol
  for an absent input; that output MUST NOT reach any target display, since it would tell the user
  they may pay any amount per lead — the precise opposite of the honest state this feature requires.
- **FR-019d**: Every consumer that receives the unit target for presentation — including the decision
  table and the cost-per-result cell colouring, which shades each value relative to the target — MUST
  handle an absent target explicitly. None may substitute zero, infinity, or an arbitrary number, and
  cost cells MUST NOT be coloured as good or bad when there is no target to compare against.
- **FR-020**: The market-benchmark input MUST be visible and editable for `appointment` and `webinar`
  accounts. Its visibility rule today restricts it to `free_lead`; that restriction MUST be widened
  to include both new archetypes. This is a prerequisite for FR-016 tier 3, not a convenience — the
  third source is user-entered, so without the input on screen the tier can never be populated and
  its branch is unreachable code.

#### Preservation of existing behaviour

- **FR-021**: The target calculation for `free_lead` MUST be unchanged in every respect.
- **FR-022**: The target calculation for `paid_lto` MUST be unchanged in every respect.
- **FR-023**: The set of possible verdicts MUST remain exactly the existing five; this feature MUST
  NOT add, rename, or recolor any verdict.
- **FR-024**: Every query touching the new fields MUST remain scoped to the owning user, with no
  cross-account or cross-user visibility.
- **FR-025**: Rule codes surfaced by any new state MUST remain faded and tooltip-only, never primary
  copy.

#### Judgement thresholds

- **FR-026**: `appointment` and `webinar` MUST be judged as lead-generation funnels, not as
  product-purchase funnels. Specifically:
  - **FR-026a**: The landing-page conversion floor below which a page is considered weak MUST be the
    lead-generation floor (15%), not the product-purchase floor (2%). This applies everywhere that
    floor is evaluated — the weak-page check, the "the ad is innocent, the page is the problem"
    finding, and the funnel-level diagnosis step.
  - **FR-026b**: The cost-per-lead kill anchors that currently apply only to `free_lead` MUST also
    apply to `appointment` and `webinar`, since these archetypes now carry a genuine cost-per-lead
    target.
  - **FR-026e**: The structural-loss kill anchor MUST use the funnel-math ceiling (half the lead
    value) for `appointment` and `webinar` — the identical figure the settings page displays as the
    ceiling. The product MUST NOT act on one number while showing another. `free_lead` keeps its own
    0.7-of-lead-value anchor unchanged; the two archetypes' anchors are deliberately different and
    MUST NOT be unified.
  - **FR-026f**: The structural-loss anchor MUST NOT fire for `appointment` or `webinar` when the
    funnel-math ceiling is not computable — that is, when any required stage rate or the high-ticket
    price is absent. An absent ceiling MUST behave as "no anchor", never as a zero threshold that
    would kill everything.
  - **FR-026h**: The structural-loss kill's action text for `appointment` and `webinar` MUST carry the
    same discovery-call route required by FR-027c. FR-026e makes this rule fire on precisely the
    condition FR-027b describes — cost per lead at or above the funnel-math ceiling — so the two
    surfaces are stating the same offer-level conclusion and must offer the same way out. Its
    existing wording already says the problem is bigger than the ads; the route is what makes that
    actionable.
  - **FR-026g**: The rolling-baseline kill anchor MUST treat the funnel-math source the same way it
    already treats the measured-history and market-benchmark sources: the selected target is its own
    comparison baseline. This is behaviour-preserving — the funnel-math source is only ever selected
    when measured history is absent — but MUST be made explicit rather than left to fall through a
    default branch.
  - **FR-026c**: Extending these thresholds MUST NOT alter the judgement of any `free_lead` or
    `paid_lto` object. For identical inputs, every verdict, rule, reason, and action for those two
    archetypes MUST be unchanged.
  - **FR-026d**: The existing test that asserts the retired option inherits product-purchase field
    visibility and thresholds asserts behaviour this feature deliberately corrects. It MUST be
    updated as part of this change and the correction called out, per the project's stated policy on
    tests that lock in incorrect behaviour.

#### Settings display

- **FR-027**: For `appointment` and `webinar`, the settings page MUST show the judging target as the
  primary cost-per-lead row whenever a target is available, using the same display pattern and
  dual-currency treatment as the existing `free_lead` row.
- **FR-027a**: When the funnel-math ceiling is also computable and differs from the judging target,
  the settings page MUST show it as a second row, labelled to distinguish the two: the target is what
  ads are judged against, the ceiling is what the user's own funnel says a lead is worth. When the
  two are equal — which is always the case when funnel math is the target's source — only the single
  primary row is shown.
- **FR-027b**: When the judging target exceeds the funnel-math ceiling, the settings page MUST state
  plainly in simple Arabic that the account is currently paying more per lead than its funnel can
  support. This is an offer-level bottleneck, not an ad-level one, and MUST be worded as such.
- **FR-027c**: That same message MUST route the user to book a discovery call, using the project's
  existing discovery-call destination and the same call-to-action treatment already applied to the
  funnel-level signal. This is not optional presentation: the governing principle makes "the ads are
  fine, the offer or funnel is the problem" a first-class outcome that must both say so in plain
  Arabic **and** route the user to the call. FR-027b identifies exactly that condition, so omitting
  the route would leave the product diagnosing an offer problem and then abandoning the user with it.
- **FR-028**: For `appointment` and `webinar`, the settings form MUST hide the three inputs that no
  longer affect the target — average order value, required return multiple, and high-ticket
  conversion rate. The high-ticket price MUST remain visible, as the funnel math depends on it.
- **FR-028a**: Hiding these inputs MUST be non-destructive. Any previously stored values are retained
  untouched, so a user who switches archetype and switches back sees their original entries.
- **FR-028b**: The derived-target breakdown panel that explains the product-purchase intermediate
  figures MUST be hidden for `appointment` and `webinar`, along with the over-target warning that
  accompanies it. Neither is meaningful once those inputs no longer feed the target.
- **FR-028c**: The "the expensive product isn't selling" input MUST remain visible for `appointment`
  and `webinar`, and the funnel-level rule it drives MUST remain active for them.
- **FR-028d**: That input's wording MUST vary by archetype, because its current phrasing assumes a
  first sale these funnels do not have. Proposed wording: `appointment` →
  "الناس تحجز وتحضر لكن لا تشتري؟"; `webinar` → "الناس تحضر الندوة لكن لا تشتري؟". The existing
  wording is unchanged for `paid_lto` and `free_lead`.
- **FR-029**: All new copy MUST be simple Modern Standard Arabic at roughly a sixth-grade reading
  level, with numeric values rendered left-to-right inside the right-to-left layout.

### Key Entities

- **Funnel archetype**: The shape of how a business sells. Now one of four values — sell a cheap
  product then upsell; collect free leads then sell; book a call then sell on the call; run a free
  webinar then sell afterwards. Determines which inputs are collected and which target formula
  applies.
- **Stage rate**: A percentage describing how many people survive one step of the funnel. Four
  distinct rates exist across the two new archetypes — book rate, show rate, show-up rate, and close
  rate — each optional, each valid above 0 and up to 100. Close rate is shared by both new
  archetypes. Absence means "not answered"; zero is not a storable value.
- **Lead value**: The expected revenue a single lead is worth, derived by multiplying the chance a
  lead eventually buys by the high-ticket price. For `appointment` and `webinar` it is also the full
  value of one conversion, because the conversion event for these funnels is the lead itself.
  Computable only when all required stage rates and the high-ticket price are present; absent
  otherwise, never zero-substituted.
- **Unit target**: The single cost figure every ad is judged against. For the new archetypes it is a
  cost per lead, drawn from one of three sources.
- **Funnel-math ceiling**: Half the lead value — the most a lead can cost before the funnel stops
  paying for itself. Computable only when all required stage rates and the high-ticket price are
  present. It is the unit target when funnel math is the selected source, and an independent
  comparison figure otherwise. The gap between the two is an offer-level signal, not an ad-level one.
  It is not display-only: it is also the threshold the structural-loss kill anchor acts on, so the
  displayed figure and the acting figure are by construction the same number. Distinct from
  `free_lead`'s own ceiling, which is 0.7 of lead value and is unchanged by this feature.
- **Conversion count**: How many results an object produced in the window being judged. Lead-type and
  purchase-type results are recorded separately. `appointment` and `webinar` are judged on the
  lead-type count, because their target is a cost per lead; `free_lead` and `paid_lto` continue to use
  today's selection. Cost per result and page conversion rate both derive from whichever count the
  archetype uses, so the measurement and the target are always in the same unit.
- **Target source**: The attribution of where the unit target came from — measured history, funnel
  math, or market benchmark — used to explain the number to the user and to select the comparison
  baseline for cost-based rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An appointment-funnel owner entering a 6% book rate, 70% show rate, 22% close rate, and
  a 2000 high-ticket price sees a maximum cost per lead of 9.24 (±0.01).
- **SC-002**: Across all five stage rates in both archetypes, reducing any one rate while holding the
  others fixed reduces the resulting target in 100% of cases — there is no input combination where a
  worse funnel produces a more generous target.
- **SC-003**: 100% of appointment and webinar accounts lacking all three target sources display an
  explicit not-enough-information state, and 0% display a numeric target.
- **SC-004**: 0% of appointment and webinar accounts receive a target derived from the
  product-purchase formula, under any combination of present and absent inputs.
- **SC-005**: Targets produced for existing `free_lead` and `paid_lto` accounts are identical before
  and after this change for every input combination.
- **SC-006**: A user new to the appointment or webinar setup can fill every rate field without
  consulting outside guidance, because each empty box states its own typical range.
- **SC-007**: No account loses saved funnel settings as a result of the archetype change (zero
  accounts used the retired option).
- **SC-008**: A user switching between archetypes and back does not have to re-enter any value they
  previously saved, including inputs hidden by the switch.
- **SC-009**: An appointment or webinar landing page converting between 2% and 15% is flagged as weak
  in 100% of cases — the same rate that would have gone unflagged under the retired option.
- **SC-010**: For every input combination, `free_lead` and `paid_lto` objects receive an identical
  verdict, rule, reason, and action before and after this change.
- **SC-011**: Appointment and webinar accounts with no determinable target produce only the "too
  early" verdict and zero kill, watch, continue, or rescue verdicts.
- **SC-012**: The settings form for appointment and webinar shows no input that does not affect the
  displayed target.
- **SC-013**: In 100% of cases where an appointment or webinar account's judging target exceeds its
  computable funnel-math ceiling, both numbers are visible on the settings page and the account is
  told it is paying more per lead than its funnel supports — the divergence is never silent.
- **SC-014**: When the target and the ceiling are equal, exactly one cost-per-lead row is displayed —
  the same number is never shown twice.
- **SC-015**: The ceiling value that fires the structural-loss kill for an appointment or webinar
  object is identical, to the cent, to the ceiling shown on that account's settings page — in 100% of
  cases. The product never acts on a number it does not show.
- **SC-016**: Appointment and webinar accounts with an incomplete set of stage rates produce zero
  structural-loss kills, because no ceiling is computable — an absent ceiling never behaves as a zero
  threshold.
- **SC-017**: `free_lead` accounts continue to use their own 0.7-of-lead-value structural-loss anchor,
  unchanged, for every input combination.
- **SC-018**: No appointment or webinar object ever receives a profitable-campaign or
  above-target-but-profitable verdict that depends on average order value or the high-ticket
  conversion rate — 0% of cases, including accounts carrying stale values from a previous archetype.
- **SC-019**: An appointment or webinar account with incomplete stage rates produces zero
  profitable-campaign and zero above-target-but-profitable verdicts, and those rules are recorded as
  skipped rather than evaluated against a zero value.
- **SC-020**: Every figure the engine acts on for appointment and webinar is derived only from inputs
  that are visible and editable on that account's settings form. No hidden input influences any
  verdict.
- **SC-021**: Across every surface that displays a cost-per-lead target — dashboard tile, settings
  preview, decision table — an account with no determinable target shows a plain-language "not set
  yet" state in 100% of cases, and shows a number, a currency amount, or an infinity symbol in 0%.
- **SC-022**: Cost-per-result cells are left uncoloured for accounts with no determinable target —
  no cell is shaded as good or bad against a target that does not exist.
- **SC-023**: For appointment and webinar accounts that record both leads and sales, the cost per
  result every rule evaluates is a cost per lead in 100% of cases — never a cost per sale.
- **SC-024**: The page conversion rate evaluated against the 15% lead-generation floor is computed
  from lead-type results, so an account is never flagged as having a weak page solely because its
  sales count is smaller than its lead count.
- **SC-025**: `free_lead` and `paid_lto` objects are judged on exactly the same conversion count
  before and after this change, for every input combination.
- **SC-026**: In 100% of cases where an appointment or webinar account is told it is paying more per
  lead than its funnel supports — on the settings page or in a structural-loss decision — a route to
  book a discovery call is offered alongside the message.
- **SC-027**: The market-benchmark input is reachable and editable on appointment and webinar
  accounts, and an account with no measured history and no stage rates but a benchmark entered
  receives a target from it — the third tier is demonstrably live, not unreachable code.

## Out of Scope

- **Staleness of measured history**: Detecting that an account's 30-day median cost no longer
  reflects its current offer — because the price or funnel structure changed — is deliberately
  excluded. The simple three-tier order ships as described, with measured history always winning.
  Staleness detection is a separate future feature.
- **Per-stage cost targets**: Only a cost per lead is produced. Cost per booking, per show-up, or per
  attendee is not surfaced.
- **Any change to `free_lead` or `paid_lto` math**, including the previously discussed removal of
  their own fallback behaviour.
- **New verdicts or changes to the decision pipeline's evaluation order.**
- **Importing stage rates automatically** from a calendar, CRM, or webinar platform. All rates are
  user-entered.
- **Detecting a custom-conversion mismatch in the measured median.** The lead-versus-purchase case is
  handled (FR-033); accounts optimising for a non-standard custom conversion are not. See Known
  Limitations.
- **Reclassifying historical snapshots.** The separated conversion counts apply going forward.
  Re-deriving lead counts for data already captured under the previous single-count scheme is not
  part of this feature.

## Known Limitations

- **The measured median may count a different event than a lead.** Tier 1 uses whatever conversion
  event the ad account optimises for. When that is a lead, the median is directly comparable to the
  funnel-math target. When it is a booked call or a purchase, the median is a cost per *booking* or
  per *sale* — commonly 10 to 30 times larger than a cost per lead. In that case tier 1 still wins,
  the resulting target is inflated, and few objects are judged as expensive.

  **Narrowed by FR-033.** The lead-versus-purchase case — by far the largest and most common
  divergence — is now resolved: the measured median for these archetypes is lead-based, matching the
  lead-based conversion count they are judged on. What remains is the narrower case where the account
  optimises for a custom conversion that is neither a standard lead nor a standard purchase (a
  booked-call event, say). That residue is still inherited unchanged, and distinguishing it requires
  inferring intent from the account's optimisation event — a larger piece of work than this feature
  and the natural companion to the deferred staleness detection.

  Partial mitigation already present: when the funnel-math ceiling is also computable, FR-027a shows
  it alongside the judging target and FR-027b states plainly that the account is paying more per lead
  than its funnel supports. A user with a mismatched event will therefore see the two numbers diverge
  sharply, even though the product does not yet name the cause.

## Assumptions

- **Four stored rate values, not five.** The request lists three fields for appointment and two for
  webinar, totalling five, but also directs that close rate be reused across both archetypes. Honouring
  the reuse instruction yields four distinct stored values — book rate, show rate, show-up rate, close
  rate — with close rate shared. The "5 columns" figure is read as counting close rate twice.
- **The multiplication form is authoritative.** The prior investigation document
  (`appointment-webinar-funnel-investigation.txt` §4.1) proposed dividing by the book rate, which
  produces a cost per *booking* and rises as the book rate worsens. That form is superseded: the
  target here is a cost per *lead*, and the product form is what satisfies the stated sanity check and
  the monotonicity requirement. The investigation document should be marked superseded on that point.
- **Half the lead value is the ceiling.** The 50% divisor mirrors the existing full-funnel
  break-even floor used elsewhere in the product. Note it differs from `free_lead`'s 70% ceiling; both
  are intentional and are not being unified here. Because the ceiling also drives the structural-loss
  kill anchor (FR-026e), the new archetypes are held to a stricter loss threshold than `free_lead` —
  a deliberate consequence of using the displayed number as the acting number.
- **Zero is not a valid stage rate.** It is refused at entry rather than accepted and reinterpreted,
  so an absent rate can only ever mean "left empty". This is a deliberate departure from how the
  existing market-benchmark input treats zero, and it is the stricter, more honest of the two.
- **Stage rates are stored unset by default** and are never given a fabricated default, so an
  unanswered account is always distinguishable from one that supplied a real value.
- **Switching archetype is non-destructive** — previously entered rates are retained even while
  hidden, so users can explore both options without losing work.
- **The profit rule and the loss rule agree by construction.** With full customer value set to the
  lead value, the profitable-campaign threshold (a full return of 2× or better) reduces to "cost per
  lead at or below half the lead value" — which is exactly the funnel-math ceiling. The rule that
  says "you are profitable" and the rule that says "you are structurally losing" therefore pivot on
  the same number from opposite sides, and cannot both fire. This coherence is a consequence of the
  choices above, not an additional constraint, but it is worth preserving if either is ever revisited.
- **Only visible inputs drive verdicts.** For the new archetypes, every figure the engine acts on
  traces back to an input the settings form displays. This is what makes hiding the three
  product-purchase inputs safe; if a future change re-introduces a hidden input into any engine
  figure, that property is broken and the honesty guarantee goes with it.
- **Currency handling is inherited.** Stage rates are unitless percentages; the high-ticket price is
  already converted from the user's entry currency to account currency before any target math, so the
  new target lands in account currency with no additional handling.
- **The measured 30-day median already available to `free_lead` is the same signal** reused as the
  first source here; no new data collection is required.
- **The market-benchmark field's visibility rule changes** from "free-lead only" to "free-lead,
  appointment, and webinar", which is a prerequisite for its role as the third source.
