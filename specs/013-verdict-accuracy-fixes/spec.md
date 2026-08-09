# Feature Specification: Verdict Accuracy Fixes — Active-Only Counts & Non-Sales Objective Exemption

**Feature Branch**: `feature/verdict-fixes`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "Fix two issues in the decision dashboard: (A) the sticky summary strip counts include paused/stopped ads, inflating the too_early count; (B) campaigns whose objective is not lead- or sales-oriented are run through the full sales rulebook and receive misleading diagnoses."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Summary strip reflects only what is running (Priority: P1)

An advertiser opens the dashboard after pausing a batch of old ads. The strip at
the top of the page is the first thing they read; they use it to answer "how much
of my account needs attention right now?". Today every paused object is counted
under ⏳ (too early), so the strip can report dozens of "too early" objects when
nothing is actually running and unjudged. The advertiser must be able to trust
the five strip counters as a picture of the **live** account only.

**Why this priority**: This is the single most-read element on the page and it is
currently misleading in a way that changes behaviour — an advertiser who believes
they have 40 unjudged objects waits instead of acting. The fix is small, has no
effect on any verdict, and unblocks trust in the rest of the page.

**Independent Test**: Load an account containing a mix of active and paused
objects, including at least one paused object holding a `kill` verdict. Verify the
five strip counters sum to the number of active objects only, that every counter
matches a manual tally of active objects per verdict, and that the daily-bleed
figure and recommended-actions list agree with the counters rather than
contradicting them. Deliverable on its own, with no dependency on User Story 2.

**Acceptance Scenarios**:

1. **Given** an account with 10 active objects (3 kill, 2 watch, 4 continue, 1 too_early)
   and 25 paused objects (all too_early via the paused gate),
   **When** the advertiser views the summary strip,
   **Then** the counters read kill 3 / watch 2 / continue 4 / rescue 0 / too_early 1,
   and the five counters sum to 10.
2. **Given** the same account,
   **When** the advertiser toggles "hide paused" on the decision table,
   **Then** the strip counters do not change — the toggle affects table rows only.
3. **Given** the same account,
   **When** the advertiser inspects any paused object's row,
   **Then** its verdict is still ⏳ too_early with the existing paused-gate reason
   and action, unchanged.
4. **Given** an account where every object is paused,
   **When** the advertiser views the summary strip,
   **Then** all five counters read 0.
5. **Given** an object whose delivery status differs from its configured status
   (e.g. configured ACTIVE but not delivering),
   **When** counts are computed,
   **Then** the delivery status decides inclusion, matching the predicate the
   decision table already uses for its paused badge and hide-paused filter.
6. **Given** a paused ad carrying a `kill` verdict (reached via the explicit-CTR
   kill or the starved matrix, which precede the paused check),
   **When** the advertiser views the summary strip,
   **Then** it is excluded from the kill counter, contributes nothing to the
   daily-bleed figure, and does not appear in the recommended-actions list —
   while its own row still shows the kill verdict unchanged.
7. **Given** an account whose only kill-verdict objects are paused,
   **When** the advertiser views the summary strip,
   **Then** the kill counter reads 0, the daily-bleed figure reads zero, and the
   recommended-actions list is empty — no element contradicts another.
8. **Given** the same account,
   **When** the advertiser reads the three-day and today spend totals,
   **Then** those totals are unchanged and still include spend from objects that
   are now paused, because they describe money already spent.

---

### User Story 2 - Non-sales campaigns are judged on budget, not on sales (Priority: P1)

An advertiser runs an awareness or traffic campaign alongside their sales
campaigns. Today the dashboard tells them that campaign "is not generating sales"
or that "Meta is underfunding it" — diagnoses drawn from a rulebook that assumes
the campaign was built to convert. The advertiser knows this is wrong, and each
wrong verdict costs them confidence in every other verdict on the page. Instead,
such campaigns should be recognised as indirect-support spend and judged on one
thing only: whether their daily budget is disciplined.

**Why this priority**: Wrong verdicts are worse than no verdicts. A single
confidently-wrong diagnosis on an awareness campaign undermines the credibility
of the whole tool, and this is a routine account structure, not an edge case.

**Independent Test**: Load an account containing at least one campaign with a
non-lead/non-sales objective and at least one sales campaign. Verify the
non-sales campaign and its children carry the new rule codes and the budget-based
verdict, while every sales object's verdict is byte-identical to before.

**Acceptance Scenarios**:

1. **Given** an active campaign whose objective is awareness, engagement, or
   traffic, with a daily budget equal to or below the ten-dollar-per-day threshold
   expressed in the account's own currency,
   **When** the advertiser views its row,
   **Then** the verdict is 🟢 continue, the rule code is `NS1`, and the reason
   explains in simple Arabic that this campaign is not judged on direct sales but
   plays an indirect role supporting awareness that feeds long-term sales.
2. **Given** the same campaign with a daily budget above that threshold,
   **When** the advertiser views its row,
   **Then** the verdict is 🟡 watch, the rule code is `NS2`, and the action asks
   them to reduce the budget below the threshold.
3. **Given** an account whose currency is not the US dollar (e.g. AED),
   **When** the threshold is applied,
   **Then** it is compared against the account's native daily-budget figure after
   conversion — an AED account is not judged against a raw figure of 10.
4. **Given** a non-sales campaign that is currently paused,
   **When** the advertiser views its row,
   **Then** it keeps the existing paused ⏳ too_early verdict and gate messaging —
   the paused state takes priority over the non-sales branch.
5. **Given** an ad or ad set belonging to a non-sales campaign,
   **When** it is evaluated,
   **Then** it is treated as exempt through inherited objective, and no
   sales-based rule (kill, starved, decay, fatigue, watch, circuit-breaker) fires
   on it.
5a. **Given** an exempt object that has received 🟡 watch with rule code `NS2`,
    **When** its row is rendered,
    **Then** it carries no diagnosis findings, and the diagnosis routine was
    never invoked for it despite its watch verdict.
5b. **Given** an account whose only watch-verdict objects are exempt `NS2` rows,
    **When** the account-level diagnosis is produced,
    **Then** no funnel diagnosis and no discovery-call call-to-action appear —
    an awareness campaign never triggers the "your offer or funnel is the
    problem" message.
6. **Given** an ad-level row under a non-sales campaign (ads never carry their own
   daily budget),
   **When** it is evaluated,
   **Then** it receives the exempt continue outcome with rule code `NS1` and no
   independent budget comparison of its own.
6a. **Given** an exempt campaign on a lifetime budget with a valid flight window
    whose lifetime-over-days daily equivalent exceeds the threshold,
    **When** it is evaluated,
    **Then** it reads 🟡 watch with rule code `NS2` — it is not passed as
    compliant merely for lacking a daily-budget field.
6b. **Given** an exempt campaign on a lifetime budget whose start or end time is
    missing or malformed, but which has been delivering with meaningful spend,
    **When** it is evaluated,
    **Then** its average daily spend over the three-day window is used as the
    comparison figure and it reads `NS1` or `NS2` accordingly.
6c. **Given** an exempt campaign on a lifetime budget with no resolvable schedule
    and no meaningful delivery data,
    **When** it is evaluated,
    **Then** it reads ⏳ too_early with the existing gate messaging — never 🟢
    `NS1`.
7. **Given** a campaign whose objective is missing, null, unrecognised, or is any
   value not on the exempt allow-list,
   **When** it is evaluated,
   **Then** it is **not** treated as exempt and runs through the normal sales
   pipeline unchanged.
7a. **Given** an older campaign carrying a legacy pre-ODAX conversion objective
    (conversions, catalogue sales, or lead generation),
    **When** it is evaluated,
    **Then** it is **not** exempt and receives ordinary sales verdicts — it never
    reads `NS1` or `NS2`.
7b. **Given** a click-to-message campaign (WhatsApp or Messenger),
    **When** it is evaluated,
    **Then** it is **not** exempt and receives full diagnosis, because
    click-to-message is a lead-generation mechanism in this market.
8. **Given** any object under a lead-objective or sales-objective campaign,
   **When** it is evaluated,
   **Then** its verdict, rule code, reason, and action are identical to the
   pre-change behaviour.
9. **Given** an active non-sales campaign created less than 48 hours ago with a
   compliant daily budget,
   **When** it is evaluated,
   **Then** it reads 🟢 continue with rule code `NS1` immediately — it does **not**
   wait behind the minimum-age gate.
10. **Given** an active non-sales campaign with very low impressions and no spend
    worth judging,
    **When** it is evaluated,
    **Then** it reads `NS1` or `NS2` on budget alone and never shows the
    "needs N more impressions or X spend before judging" message.
11. **Given** an active exempt ad that would otherwise trigger the explicit
    low-CTR kill, or an exempt ad set that would otherwise trip the circuit
    breaker,
    **When** it is evaluated,
    **Then** neither fires; the object receives its budget-based `NS1` / `NS2`
    outcome instead.
12. **Given** an account on the appointment or webinar archetype whose snapshot
    predates the lead/purchase split, containing a non-sales campaign,
    **When** that campaign is evaluated,
    **Then** the pre-separation gate does not apply to it and it receives its
    budget-based outcome; objects under its lead- and sales-objective campaigns
    continue to hit the pre-separation gate exactly as before.

---

### Edge Cases

- **All objects paused.** Every strip counter reads 0 rather than showing the
  paused population under ⏳.
- **Delivery status absent.** When an object carries no delivery status, the
  configured status decides; when neither is present, the object's own status
  field is used — the same three-step fallback the decision table already applies.
- **Objective present only on the campaign.** Ad sets and ads carry no objective
  of their own; they inherit the campaign's. Inheritance already exists and is
  reused rather than reimplemented.
- **Objective missing entirely.** Treated as not exempt (see Acceptance Scenario
  2.7) — a missing objective is a data gap, not a signal of intent.
- **Legacy pre-ODAX objective on an older campaign.** A legacy conversion,
  catalogue-sales, or lead-generation objective is non-exempt and runs the full
  rulebook; a legacy awareness/reach/video/clicks/engagement objective is exempt.
- **Click-to-message campaign (WhatsApp / Messenger).** Non-exempt — treated as a
  lead-generation mechanism, not engagement, and receives full diagnosis.
- **Unrecognised or future objective value.** Defaults to non-exempt and runs the
  full rulebook (FR-006b). The user sees today's behaviour rather than a silently
  suppressed diagnosis.
- **Non-sales campaign with no budget at the evaluated level.** In campaign-budget
  accounts the ad sets carry no budget; in ad-set-budget accounts the campaign
  carries none. Exempt, 🟢 `NS1`, no independent comparison — the threshold is
  enforced once, at the level holding the budget (FR-012c).
- **Exempt object on a lifetime budget.** Judged on a derived daily rate, never
  passed as compliant for lacking a daily-budget field: scheduled daily
  equivalent first, observed daily spend second, and ⏳ too_early only when
  neither is available (FR-012a, FR-012b).
- **Lifetime-budget object that has not begun delivering.** No schedule-derived
  figure and no meaningful spend history — falls to ⏳ too_early rather than 🟢
  `NS1` (FR-012a.3, FR-009c).
- **Lifetime-budget object whose flight window has a zero or negative duration.**
  Treated as an unresolvable schedule; drops to the observed-spend rung rather
  than dividing by zero.
- **Daily budget exactly at the threshold.** The boundary is inclusive on the
  compliant side: equal to the threshold is 🟢 continue (`NS1`), strictly above is
  🟡 watch (`NS2`).
- **Unknown or unmapped account currency.** Conversion falls back to a no-op, so
  the raw threshold figure is compared — the same fallback the existing target
  conversion already uses. No object is dropped or errored.
- **Non-sales objects and the summary strip.** Active non-sales objects count
  toward the strip under their new verdict (continue or watch), exactly like any
  other active object.
- **`NS2` object and the diagnosis panel.** An `NS2` row shows no diagnosis
  findings. Its reason and action copy carry the complete message — the budget is
  above the cap and should be reduced — so no detail is lost by skipping
  diagnosis (FR-010a).
- **Exempt object and the account funnel CTA.** An exempt object can never be the
  trigger for the account-level funnel diagnosis or the discovery-call banner,
  because it carries no findings and never fires the funnel watch rule (FR-010b).
- **Non-sales objects and the top-actions list.** The recommended-actions list
  carries stop-worthy, rescue-worthy, and scale-ready objects — not watches. An
  `NS2` watch therefore does not enter it, and no new entry type is introduced
  for exempt objects.
- **Paused object holding a `kill` verdict.** Possible today, because the
  explicit-CTR kill, the starved matrix, and the circuit breaker are evaluated
  before the paused check. Such an object is excluded from all three live-state
  strip elements — counters, bleed, and recommended actions — while keeping its
  row verdict unchanged (FR-005, FR-005a).
- **Account with only paused kill-verdict objects.** The strip reads zero to
  stop, zero daily bleed, and an empty recommended-actions list, consistently.
  The rows themselves still show their kill verdicts in the table.
- **Brand-new non-sales campaign.** Reaches a verdict on its first evaluation;
  the under-48-hours gate never applies to it (Acceptance Scenario 2.9).
- **Exempt object that would trip an early-firing sales rule.** The explicit
  low-CTR kill and starved matrix (ad level) and the circuit breaker (ad-set
  level) currently precede the paused check. For exempt objects none of them is
  reached; for every other object their position is unchanged
  (FR-009b, Acceptance Scenario 2.11).
- **Non-sales campaign in an appointment/webinar account on a pre-split
  snapshot.** The pre-separation gate is a sales-data-reliability gate and does
  not apply to exempt objects (Acceptance Scenario 2.12).

## Requirements *(mandatory)*

### Functional Requirements

#### Issue A — active-only summary counts

- **FR-001**: The five summary-strip counters (kill, watch, continue, rescue,
  too_early) MUST be computed only from objects whose delivery status resolves to
  active.
- **FR-002**: The active/paused determination MUST use the same predicate the
  decision table already applies — delivery status first, then configured status,
  then the object's own status field — so a row badged "paused" in the table is
  never counted in the strip.
- **FR-003**: The strip counters MUST be independent of the table's hide-paused
  toggle; toggling it MUST NOT change any counter.
- **FR-004**: Per-object verdicts, rule codes, reasons, and actions MUST be
  unchanged by this fix; paused objects MUST continue to resolve to ⏳ too_early
  with the existing gate messaging.
- **FR-005**: The active-only predicate MUST apply to **all three** live-state
  elements of the summary strip, so the strip describes one consistent picture:
  the five verdict counters, the daily-bleed figure, and the recommended-actions
  list. A paused object MUST NOT contribute to any of them.
- **FR-005a**: This matters because a paused object **can** currently hold a
  `kill` verdict — the explicit-CTR kill and starved matrix (ad level) and the
  circuit breaker (ad-set level) are evaluated before the paused check. Without
  FR-005 the strip could report zero objects to stop while simultaneously showing
  a non-zero daily bleed and recommending "stop this ad" for an ad that is
  already stopped.
- **FR-005b**: The account spend totals (three-day spend and today's spend) MUST
  retain their current computation basis over all rows. They describe historical
  account spend, not live state, and a paused object's past spend genuinely
  occurred. Baselines are likewise unchanged.
- **FR-005c**: Reordering the engine so that paused objects can never hold a
  `kill` verdict is explicitly **out of scope**. It would change verdicts for
  ordinary non-exempt objects, contradicting FR-022 and SC-003. If that
  behaviour is wanted it belongs in its own spec with its own review.

#### Issue B — non-sales objective exemption

- **FR-006**: The system MUST classify an object as **non-sales exempt** only when
  its effective campaign objective appears on an explicit **exempt allow-list**.
  The allow-list covers the awareness / traffic / engagement / video / reach
  family: the current-era awareness, engagement, traffic, and app-promotion
  objectives, plus their legacy pre-ODAX equivalents (brand awareness, reach,
  video views, link clicks, post engagement, page likes, event responses, app
  installs, and any further legacy member of that family confirmed during
  planning).
- **FR-006a**: Any objective value **not** on the exempt allow-list MUST be treated
  as non-exempt and MUST run the full rulebook. This explicitly includes the
  conversion objectives — the current-era lead and sales objectives, the legacy
  conversions, catalogue-sales, and lead-generation objectives, and the
  click-to-message objectives (WhatsApp / Messenger), which are a genuine
  lead-generation mechanism in this market and MUST receive full diagnosis
  rather than being treated as an engagement play.
- **FR-006b**: An objective value the system does not recognise — whether a legacy
  value not yet enumerated or an objective introduced by the platform in future —
  MUST default to **non-exempt**. The failure mode for an unrecognised objective
  MUST always be "gets fully judged", never "gets silently exempted". Being
  wrongly judged reproduces today's known behaviour; being wrongly exempted would
  silently hide a real sales campaign's problems.
- **FR-007**: The effective objective for ad sets and ads MUST come from the
  existing campaign-to-child objective inheritance; no new inheritance mechanism
  is introduced.
- **FR-008**: An object whose effective objective is missing or null MUST NOT be
  treated as exempt and MUST be evaluated through the normal sales pipeline —
  the same default FR-006b applies to unrecognised values.
- **FR-009**: For an exempt object, the paused check MUST be consulted first: a
  paused exempt object keeps the existing paused ⏳ too_early verdict and gate
  messaging regardless of objective or budget.
- **FR-009a**: For an active exempt object **with a resolvable daily-rate figure**,
  the non-sales branch MUST produce the verdict directly, without consulting
  **any** other gate — not the minimum-age gate, not the minimum impressions/spend
  gate, and not the archetype pre-separation gate. These gates exist to protect
  the reliability of sales-based verdicts; budget compliance is a point-in-time
  fact that needs no accumulation period, so none of them applies.
- **FR-009c**: The single exception to FR-009a is the last rung of the
  lifetime-budget ladder (FR-012a.3): an exempt lifetime-budget object with
  neither a resolvable schedule nor meaningful delivery data has no daily-rate
  figure to judge, and MUST fall through to the existing ⏳ too_early gate. This
  is a data-availability fallback, not a sales judgement, and it is the only path
  by which an active exempt object may read ⏳.
- **FR-009b**: The exempt branch MUST be self-contained and MUST be reached before
  any sales rule can fire — including the rules that currently precede the paused
  check (explicit-CTR kill, the starved matrix, and the circuit breaker). It MUST
  be entered only when the object is exempt, so that the evaluation sequence for
  every non-exempt object is bit-for-bit unchanged.
- **FR-010**: An exempt object MUST NOT have any rule from the sales rulebook
  evaluated against it. The only judgement applied is the **daily-rate check** of
  FR-012 / FR-012a. "Daily rate" is deliberate: the figure judged may come from a
  daily budget, from a lifetime budget spread over its flight window, or from
  observed daily spend. An implementation that reads only the daily-budget field
  is non-conforming.
- **FR-010a**: An exempt object MUST always carry an empty findings list. The
  diagnosis routine MUST NOT run for it under any verdict. This MUST be a hard
  skip at the point where diagnosis is invoked — **not** a filter applied inside
  the diagnosis routine — consistent with FR-010. This matters because diagnosis
  is currently triggered by verdict rather than by rule code, and an `NS2` object
  is a watch; without an explicit skip it would receive sales-based findings for
  reasoning it was just declared exempt from.
- **FR-010b**: Because exempt objects carry no findings and never produce the
  funnel-level watch rule, they MUST NOT contribute to the account-level funnel
  diagnosis or to the discovery-call call-to-action. An awareness campaign MUST
  never be the reason the account is told its offer or funnel is the problem.
- **FR-010c**: An exempt object MUST NOT be marked scale-ready, since scale
  eligibility is a sales-performance judgement produced by the rulebook the
  object skips. Exempt objects therefore never appear in the recommended-actions
  list by that route either.
- **FR-011**: The budget threshold MUST be ten US dollars per day, converted into
  the account's own currency using the existing conversion path already used when
  deriving targets. The threshold MUST NOT be hardcoded as a bare numeric
  comparison against a non-USD figure.
- **FR-012**: When a daily budget is present, the daily-rate check MUST read the
  same daily-budget field the existing ±20% budget controls read, at whichever
  level actually carries it (campaign for campaign-budget accounts, ad set for
  ad-set-budget accounts). When no daily budget is present, FR-012a governs where
  a lifetime budget is present, and FR-012c where no budget exists at this level.
- **FR-012a**: When an exempt object carries a **lifetime budget** instead of a
  daily budget, the system MUST resolve a daily-rate figure before judging it,
  using this ladder in order:
  1. **Scheduled daily equivalent** — divide the lifetime budget by the number of
     days in its scheduled flight window (derived from its start and end times,
     which the platform requires whenever a lifetime budget is set). Compare that
     figure to the threshold exactly as a real daily budget would be compared.
  2. **Observed daily spend** — if the schedule is missing, malformed, or
     otherwise unresolvable, use the object's average daily spend over the
     existing three-day insight window as the comparison figure, provided the
     object has enough delivery data for that average to be meaningful.
  3. **No figure available** — if neither a resolvable schedule nor meaningful
     delivery data exists (for example a lifetime-budget object that has not begun
     delivering), the object MUST fall through to the existing ⏳ too_early gate
     with its existing messaging.
- **FR-012b**: A lifetime-budget object MUST NOT reach 🟢 `NS1` without an actual
  daily-rate figure behind it, whether budgeted (FR-012a.1) or observed
  (FR-012a.2). Treating a lifetime budget as "no budget" and passing it as
  compliant is explicitly forbidden.
- **FR-012c**: The genuine no-budget case MUST remain distinct from the
  lifetime-budget case. An object that carries no budget because the budget lives
  at another level — an ad row, an ad set in a campaign-budget account, a campaign
  in an ad-set-budget account — is 🟢 `NS1` with no independent comparison, because
  the threshold is enforced once at the level that actually holds the budget.
  FR-012a applies only where a lifetime budget is present.
- **FR-013**: An exempt object whose converted daily budget is at or below the
  threshold MUST receive verdict 🟢 continue with rule code `NS1`.
- **FR-014**: An exempt object whose converted daily budget is above the threshold
  MUST receive verdict 🟡 watch (not kill) with rule code `NS2`, and an action
  asking the advertiser to reduce the budget below the threshold.
- **FR-015**: Ad-level rows MUST inherit exempt status from their parent and MUST
  NOT perform an independent budget comparison.
- **FR-016**: `NS1` and `NS2` MUST be added to the rule catalog as **rule codes
  only**. The verdict vocabulary MUST remain exactly five values
  (kill, watch, continue, rescue, too_early).
- **FR-017**: `NS1` and `NS2` MUST appear verbatim in engine output and MUST be
  surfaced in the interface only as faded text or tooltip content, never as
  primary copy — the same treatment every existing rule code receives.
- **FR-018**: The `NS1` reason copy MUST state, in simple Arabic at a sixth-grade
  reading level, that the campaign is not judged on direct sales but plays an
  indirect role supporting awareness that feeds long-term sales.
- **FR-019**: All new user-facing copy for `NS1` and `NS2` MUST be simple Arabic at
  a sixth-grade reading level, with numeric values rendered left-to-right inside
  the right-to-left layout.

#### Cross-cutting

- **FR-020**: Existing evaluation order MUST otherwise be unchanged; the non-sales
  branch is additive, not a reordering.
- **FR-021**: No new writes to the advertising platform MUST be introduced; all
  reads MUST remain scoped to the requesting user's account and read-only.
- **FR-022**: Verdicts for every lead-objective and sales-objective object MUST be
  unchanged, and the existing engine test suite MUST stay green except where a
  test explicitly asserts the two behaviours being corrected here.

### Key Entities

- **Evaluated object**: a campaign, ad set, or ad carrying a verdict, a rule code,
  an Arabic reason, an Arabic action, a configured status, a delivery status, an
  effective campaign objective, a three-day spend figure, and — at budgeted levels
  only — either a daily budget or a lifetime budget with a flight window.
- **Daily-rate figure**: the per-day amount an exempt object is judged against.
  Sourced from the daily budget when present, otherwise derived from a lifetime
  budget over its flight window, otherwise observed from recent average daily
  spend. Absence of all three is a judgeable state (⏳), not a pass.
- **Summary strip counters**: five per-verdict tallies displayed above the
  decision table, describing the live state of the account.
- **Rule catalog**: the fixed list of rule codes with Arabic titles and
  definitions, extended here by `NS1` and `NS2`.
- **Budget threshold**: ten US dollars per day, expressed for comparison in the
  account's own currency.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any account, the five strip counters sum exactly to the number
  of objects whose delivery status is active — verified across accounts that are
  fully active, fully paused, and mixed.
- **SC-002**: Toggling the table's hide-paused control produces zero change in any
  strip element — counters, bleed, or recommended actions.
- **SC-002a**: The three live-state strip elements never contradict one another:
  a zero kill counter always accompanies a zero daily bleed and a
  recommended-actions list containing no stop actions, on every account tested.
- **SC-002b**: Zero paused objects appear in the recommended-actions list, so no
  recommended action is a no-op at the moment it is shown.
- **SC-003**: Zero objects with a lead or sales objective change verdict, rule
  code, reason, or action as a result of this feature.
- **SC-004**: 100% of active objects under an awareness, engagement, or traffic
  campaign receive `NS1`, `NS2`, or the lifetime-budget ⏳ fallback of FR-009c,
  and none receives a rule from the sales rulebook. The ⏳ fallback is included
  because an exempt object with a lifetime budget but no resolvable daily rate
  has nothing to judge (FR-012b); it is not a sales verdict.
- **SC-005**: An account denominated in a currency other than the US dollar
  produces the same exempt/over-budget classification as an equivalent
  dollar-denominated account with the same real spend level.
- **SC-006**: 100% of paused objects — including those under non-sales campaigns —
  keep the existing paused ⏳ verdict and gate messaging.
- **SC-007**: All new Arabic copy passes a sixth-grade readability review, and no
  rule code appears as primary copy in the interface.
- **SC-008**: An advertiser reviewing a mixed account can state, from the strip
  alone and without opening the table, how many live objects need action —
  confirmed in review with the account owner.
- **SC-009**: The only two paths by which an exempt object may display ⏳ too_early
  are the paused gate and the lifetime-budget no-figure fallback (FR-009c). No
  exempt object displays ⏳ for reasons of age, impression volume, or spend
  volume.
- **SC-009a**: Zero exempt objects carrying a lifetime budget receive 🟢 `NS1`
  without a daily-rate figure behind them — verified across lifetime-budget
  objects with a valid schedule, with a broken schedule but active delivery, and
  with neither.
- **SC-010**: The evaluation sequence for non-exempt objects is provably
  unchanged, demonstrated by the existing engine test suite passing without
  modification except for tests that assert the two behaviours corrected here.
- **SC-011**: Zero campaigns carrying a conversion objective — current-era or
  legacy — and zero click-to-message campaigns are classified exempt, verified
  by enumerating every distinct objective value present in imported data and
  confirming its classification.
- **SC-012**: An objective value absent from the allow-list produces a full
  rulebook verdict, never `NS1` or `NS2` — verified with a deliberately
  unrecognised objective value.
- **SC-013**: Zero exempt objects carry diagnosis findings, and zero exempt
  objects appear as the trigger for the account-level funnel diagnosis or the
  discovery-call call-to-action — verified on an account whose only non-continue
  verdicts are `NS2`.

## Assumptions

- **Where the counters are produced.** The five strip counters are produced
  alongside the verdicts rather than recomputed in the page that displays them.
  The fix is therefore applied where the counters are built, and the display
  remains a pass-through. This does not change what the user sees beyond the
  corrected numbers.
- **No budget at the evaluated level.** When an exempt object sits at a level that
  carries no budget of any kind in the current account structure — a campaign in
  an ad-set-budget account, or an ad set in a campaign-budget account — it is
  treated the same way as an ad-level row: exempt, 🟢 continue, rule code `NS1`,
  no independent comparison. The budget-discipline flag fires only at the level
  that actually holds the budget, so it is raised exactly once per budget. This
  applies only to genuine absence of a budget; an object holding a **lifetime**
  budget is not "no budget" and follows the FR-012a ladder instead.
- **Lifetime-budget schedule data.** The platform requires start and end times
  whenever a lifetime budget is set, so the scheduled daily equivalent is
  expected to be resolvable in the normal case; the observed-spend rung exists for
  malformed or incomplete imported data, not as the expected path.
- **Threshold boundary.** A converted daily budget exactly equal to the threshold
  is compliant (`NS1`); only a strictly greater figure raises `NS2`.
- **Objective values.** Exemption is driven by an explicit allow-list of the
  awareness/traffic/engagement/video/reach family, not by "anything that is not a
  conversion objective" (FR-006). Unrecognised and future objective values default
  to non-exempt (FR-006b). The exact legacy membership of the allow-list is
  confirmed during planning against the objective values actually present in
  imported data; adding a missing legacy family member later is a safe, additive
  change, whereas an over-broad allow-list is not.
- **Currency conversion.** The existing conversion used for deriving targets is
  reused as-is, including its no-op fallback for unknown or unmapped currency
  codes. No new rate table or conversion path is introduced.
- **Verdicts reachable by exempt objects.** The non-sales branch itself emits only
  continue (`NS1`) and watch (`NS2`). Rescue is never reachable. Too_early is
  reachable by exactly two paths: the paused gate, and the lifetime-budget
  no-figure fallback (FR-009c).
- **Presentation of `NS1` / `NS2`.** These codes flow into the existing
  rule-code display mechanism with no new interface component; the faded/tooltip
  treatment is inherited.
- **Scope boundary.** Objective-aware *targets* and objective-aware baselines are
  out of scope, as is any reordering that would stop paused objects holding a
  `kill` verdict (FR-005c). What changes: verdict routing for exempt objects, the
  findings skip for exempt objects, and the three live-state strip elements
  (counters, bleed, recommended actions). Account spend totals and baselines are
  unchanged (FR-005b).

## Dependencies

- Existing campaign-to-child objective inheritance in the decision engine.
- Existing currency conversion used when deriving targets from funnel settings.
- Existing daily-budget field already read by the ±20% budget controls.
- **New data need**: the lifetime-budget figure and the flight-window start/end
  times must be available on imported objects. The lifetime budget is already
  requested from the platform but currently discarded rather than mapped; the
  schedule times are not requested at all today. Both are additional read-only
  fields on an existing import call — no new call, no new scope, no write.
- Existing three-day spend figure already carried on each object, used as the
  observed-spend fallback.
- Existing paused-state predicate used by the decision table for its paused badge
  and hide-paused filter.
- Existing rule-code display treatment (faded text and tooltips).

## Clarifications

### Session 2026-08-09

- **Q**: Which existing gates take priority over the non-sales branch — the paused
  check only, or the full set of early-data gates (minimum age, minimum
  impressions/spend, pre-separation snapshot)?
  **A**: The paused check only. The non-sales branch runs ahead of the minimum-age
  gate and the impressions/spend data-volume gate, and ahead of the archetype
  pre-separation gate. Rationale: budget compliance does not need time to become
  trustworthy. Those gates exist specifically to protect the reliability of
  *sales* verdicts, which is not what an exempt object is being judged on.
  Captured as FR-009 / FR-009a.

- **Q** (follow-up, raised during grounding): The two stated constraints — "exempt
  objects skip K/W/S/CB entirely" and "paused still takes priority" — cannot both
  hold if the branch is inserted at a single point in the current sequence,
  because the explicit-CTR kill and starved matrix (ad level) and the circuit
  breaker (ad-set level) are evaluated *before* the paused check today. Hoisting
  the paused check to the front would satisfy both, but would change verdicts for
  non-exempt objects, violating the no-regression constraint.
  **A**: The exempt branch is self-contained and evaluates the paused check itself,
  entered before the rest of the pipeline but only for exempt objects. Non-exempt
  objects follow exactly today's sequence, unchanged. Captured as FR-009b.

- **Q**: How should the objective vocabulary be defined, given that pre-ODAX legacy
  values (conversions, catalogue sales, lead generation) persist on live accounts
  and would be wrongly exempted by an "anything but the two outcome objectives"
  rule?
  **A**: Invert to an explicit **exempt allow-list** covering the
  awareness/traffic/engagement/video/reach family and its legacy equivalents.
  Non-exempt = the conversion objectives (current and legacy) plus click-to-message
  (WhatsApp/Messenger), which is a real lead-generation mechanism in this market.
  Anything not on the allow-list — including unenumerated and future values —
  defaults to non-exempt. The failure mode for an unrecognised objective must
  always be "gets fully judged" (safe, reproduces today's behaviour), never
  "silently exempted from diagnosis". Captured as FR-006 / FR-006a / FR-006b.

- **Q**: How does the daily threshold apply to an exempt object that carries a
  lifetime budget rather than a daily one, given that such an object has no
  daily-budget value and would otherwise be passed as compliant?
  **A**: A three-rung ladder. First, derive a daily equivalent from the lifetime
  budget over its scheduled flight window. Second, if the schedule is missing or
  malformed, fall back to observed average daily spend from the existing
  three-day window, provided delivery data is meaningful. Third, only when
  neither is available does the object fall through to the existing too_early
  gate. A lifetime-budget object must never reach 🟢 `NS1` without an actual
  daily-rate figure behind it, budgeted or observed. Captured as FR-012a /
  FR-012b / FR-012c, with the gate carve-out in FR-009c.

- **Q**: Paused objects can hold a `kill` verdict today, because the explicit-CTR
  kill, starved matrix, and circuit breaker precede the paused check. Should the
  active-only predicate extend beyond the five counters to the daily-bleed figure
  and the recommended-actions list, which both consume kill rows unfiltered?
  **A**: Yes — extend it to all three live-state strip elements so the whole strip
  describes the live account consistently. Without this the strip could report
  zero objects to stop beside a non-zero bleed and a "stop this ad" card for an
  already-stopped ad. Account spend totals stay unchanged (historical, not live
  state). Reordering the engine so paused objects never hold a kill verdict was
  explicitly rejected for this spec: it would change verdicts for ordinary
  non-exempt objects, contradicting FR-022 and SC-003, and belongs in its own
  spec with its own review. Captured as FR-005 / FR-005a / FR-005b / FR-005c.

- **Q**: Diagnosis is currently triggered by verdict, not rule code, so an `NS2`
  object — being a watch — would be routed into the sales diagnosis routine and
  could even trigger the account-level funnel diagnosis and discovery-call CTA.
  Should exempt objects be diagnosed?
  **A**: No. Exempt objects always carry an empty findings list and the diagnosis
  routine is never invoked for them, under any verdict. This is a hard skip at the
  call site, not a filter bolted onto the diagnosis routine, consistent with
  FR-010. Exempt objects therefore cannot contribute to the account funnel CTA or
  any discovery-call surface. The `NS1` / `NS2` reason and action copy already
  explain the verdict fully, so no detail is lost. Captured as FR-010a / FR-010b /
  FR-010c.
