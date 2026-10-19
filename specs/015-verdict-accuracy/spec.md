# Feature Specification: Verdict Accuracy — Stop False Kills

**Feature Branch**: `015-verdict-accuracy`

**Created**: 2026-10-18

**Status**: Draft

**Input**: Section 2 "P0 — Stop false kills" of `docs/spec-015/spec-015-verdict-accuracy.md`
(tasks T1, T2, T3, T4, T4b, T5, T7b, T7c), judged against the rulebook
`docs/spec-015/qarar-rulebook-v2.2.md` (source of truth).

## Overview

Qarar told an advertiser to stop a campaign that had made 16 sales. It showed 🔴 on paused
ads and on ads with no impressions. It showed "0 to stop" in the summary while listing five
red ads in the diagnosis panel. In every case the data was right there on screen and the
verdict contradicted it.

This feature fixes only the false-kill class of errors: the engine must refuse to judge what
it cannot judge, and must judge using the same numbers it shows. It does not change the
judgment model, geo targets, ad identity, or copy — those are features 016–018.

## Clarifications

### Session 2026-10-18

- Q: Does "absent is not zero" cover conversion counts, or only the sales value? → A: Counts are
  unknown only when the actions array is absent **and** link clicks are greater than zero — an
  inconsistent payload. Absent actions with zero link clicks is a consistent genuine zero and
  K1/K3 evaluate normally; a present actions array with no purchase or registration entry is
  also a genuine zero. The sales value follows the same principle unconditionally: an absent
  value array is unknown, never zero. All three payload shapes get tests.
- Q: What counts as "not active" for the status gate, and what does each state show? → A: The
  gate keys off Meta's effective status only — an active object with zero spend is not gated and
  falls through to the data gates and the K5 exposure floor. `IN_PROCESS` and `PREAPPROVED`
  count as active, because they are transient states on objects that are still delivering and
  gating them would make verdicts flicker after every edit. Each gated state maps to its own
  display badge; archived and deleted objects are not shown at all.
- Q: What population do the summary counters count? → A: Ad sets and ads, never campaigns —
  a campaign is a summary per rulebook §5.0, so counting it would double-count the same loss.
  The counter shows the split rather than one merged number, and the daily bleed follows a
  parent-most rule so no spend is counted twice. Gated objects are never counted, and the
  numbers must not change when the table switches level.

## User Scenarios & Testing *(mandatory)*

### Acceptance scenario — live-account replay (15–17 Oct 2026)

This is the regression baseline. The account's funnel settings count registrations
("ندوة"/webinar), while the campaigns optimize for and record **purchases**. Observed before
the fix, compared against Ads Manager for the same window:

| Campaign | Ads Manager (spend / purchases / cost per purchase) | Qarar verdict before | Required after |
|---|---|---|---|
| ES - WW - 8 Oct | $809 / 16 / $50.59 | 🔴 K1 "صرفت $809 بدون أي نتيجة" | ⏳ GATE + settings-mismatch message |
| MO - CBO - 13 Oct | $369 / 8 / $46.18 | 🟡 W6 "العائد الكلي 0.0x" | ⏳ GATE + settings-mismatch message |
| Specific Countries (a) | $84.75 / 4 / $21.19 | ⏳ "صرف أقل من تكلفة عميل واحد" | ⏳ GATE + settings-mismatch message |
| Specific Countries (b) | $84.62 / 9 / $9.40 | ⏳ same | ⏳ GATE + settings-mismatch message |
| ABO - 17 Oct | $232 / 1 / $232 | ⏳ same | ⏳ GATE + settings-mismatch message |

The same rows displayed results of 16, 8, 4, 9 and 1 with an empty cost column. The ad-level
"أين المشكلة؟" panel showed 🔴 on a paused ad, 🔴 on an ad with zero impressions, and 🔴
beside the text "البيانات غير كافية".

After this feature, replaying the same window with the settings left unchanged must produce
⏳ on all five rows with the settings-mismatch message, no row claiming "بدون أي نتيجة" or
"0.0x", and no paused or zero-impression ad anywhere in the diagnosis panel or today's
decisions.

---

### User Story 1 - A campaign that is selling is never told to stop (Priority: P1)

A coach runs a **paid** webinar. The funnel settings count registrations, but the campaigns
record purchases, so every object reads as zero-result. Qarar must notice that the event it
counts is not the event the account records, say so plainly, and refuse to issue any verdict
built on that zero — instead of reading the zero as failure and ordering a stop.

**Why this priority**: This is the single most damaging error the engine can make. One
campaign with real revenue was marked 🔴 "spent $809 with no result". Telling an advertiser
to kill a profitable campaign destroys trust in every other verdict on the page.

**Independent Test**: Evaluate an object whose counted result event is zero while the other
event family is positive; confirm the verdict is ⏳ with the mismatch reason, and that an
object with both event families at zero still receives the existing zero-result kill.

**Acceptance Scenarios**:

1. **Given** funnel settings that count registrations and an object with 0 registrations,
   16 purchases and $809 spend, **When** the object is evaluated, **Then** the verdict is ⏳
   with rule code GATE, the reason says the funnel settings count a result type this campaign
   does not record, and the action points the user to review the funnel type in Settings.
2. **Given** the same settings and an object with 0 registrations and 0 purchases,
   **When** it is evaluated, **Then** the existing zero-result kill (K1) fires unchanged.
3. **Given** an account where at least half of the active spend sits on objects tripping this
   gate, **When** the dashboard loads, **Then** a warning card appears at the top of the
   dashboard linking to Settings.
4. **Given** settings that count purchases and an object with 0 purchases and positive
   registrations, **When** it is evaluated, **Then** the same gate fires with the result noun
   matching the counted event.

---

### User Story 2 - Nothing that is switched off gets judged (Priority: P1)

A paused ad, an ad inside a paused ad set, an ad awaiting review, a rejected ad and an ad with
a billing or delivery problem must all pass through no rule at all. Each carries ⏳ with a badge
naming its real state, and none appears in the diagnosis panel or in today's decisions. Qarar
never tells someone to stop something that is already stopped. An ad that is active but simply
is not being funded is a different case: it stays in the rules and is answered by the exposure
floor in Story 3, not by a "موقوف" badge that would be untrue.

**Why this priority**: Paused and non-delivering ads were producing 🔴 kill verdicts, because
the starvation rules ran before the status check and read "0% of spend" as weakness. These
phantom reds polluted the diagnosis panel and were the loudest items on the page.

**Independent Test**: Evaluate one object per badge group plus a transient-state object;
confirm the gated ones return ⏳ with the right badge and are absent from the diagnosis panel
and today's decisions, while the transient one is still evaluated normally.

**Acceptance Scenarios**:

1. **Given** a paused ad with 0% of its ad set's spend, **When** it is evaluated, **Then** the
   verdict is ⏳ with the "موقوف" badge — not a kill verdict from the starvation rules.
2. **Given** an ad whose ad set is paused, **When** it is evaluated, **Then** the verdict is ⏳.
3. **Given** an ad under review, a rejected ad, and an ad with a billing or delivery issue,
   **When** each is evaluated, **Then** each receives ⏳ with the badge naming its real state —
   "قيد المراجعة", "مرفوض", "به مشكلة — راجعه في مدير الإعلانات" — never "موقوف".
4. **Given** an ad in a transient state after an edit, **When** it is evaluated, **Then** it is
   treated as active and judged by the rules, so its verdict does not flicker.
5. **Given** any gated object, **When** the diagnosis panel, today's decisions and the summary
   counters render, **Then** that object appears in none of them.
6. **Given** an archived or deleted object, **When** the dashboard renders, **Then** it is not
   shown at all.
7. **Given** a paused object, **When** its reason and action are read, **Then** neither
   instructs the user to pause it.

---

### User Story 3 - An ad nobody has seen is not called weak (Priority: P2)

Meta decides how much each ad spends. An ad it starves of impressions has not failed — it has
not been tested. Qarar must not call such an ad weak, and must not declare it a rescue
candidate either, because a click-through rate measured on a few hundred impressions is noise.

**Why this priority**: Paired with the counting error, this produced kill verdicts on ads with
no data at all, and after the counting fix it produced ten 🛟 rescue recommendations, several
on tiny samples. Both directions waste the user's attention.

**Independent Test**: Evaluate starved ads at 0, 300 and 800 impressions and confirm the
verdict changes only once the exposure floor is met.

**Acceptance Scenarios**:

1. **Given** a starved ad with 0 impressions, **When** it is evaluated, **Then** the verdict is
   ⏳ with rule code K5 and a reason saying Meta is not giving it enough exposure to judge.
2. **Given** a starved ad with 800 impressions, a click-through rate below the median, no
   results, inside an ad set that is missing its target, **When** it is evaluated, **Then** the
   existing 🔴 K5 kill fires unchanged.
3. **Given** a starved ad with 300 impressions and a click-through rate above the median,
   **When** it is evaluated, **Then** the verdict is ⏳ — not a 🛟 rescue.
4. **Given** an ad below 10% of its ad set's spend across the three-day total but at or above
   10% on one of those days, **When** it is evaluated, **Then** the starvation rule does not
   apply.

---

### User Story 4 - The target on screen is the target being judged against (Priority: P2)

The Settings page showed a target cost of $45 while the engine judged against a figure between
$232 and $404, derived from the account's own history. The user cannot argue with, or correct,
a number they cannot see. Qarar must show the exact figure it judges with, and where it came
from.

**Why this priority**: Every cost verdict on the dashboard is measured against this number.
While it is hidden, every kill and every green light is unexplainable to the user.

**Independent Test**: Configure an account whose history-derived target differs sharply from
its funnel-math target; confirm Settings displays the figure the engine actually used, names
its source, and shows both figures when they diverge materially.

**Acceptance Scenarios**:

1. **Given** an account whose 30-day history yields a target of $300 while the funnel math
   yields $45, **When** Settings is opened, **Then** $300 is shown as the judging number with
   a plain-Arabic line naming its source.
2. **Given** the same account, **When** the two figures differ by more than 20%, **Then** both
   are shown and the page states which one the engine uses.
3. **Given** an account with no usable history, **When** Settings is opened, **Then** the
   funnel-math figure is shown as the judging number with its source named.
4. **Given** any account, **When** the dashboard summary and Settings are compared, **Then**
   both show the same target figure and the same source.

---

### User Story 5 - A paid event cannot be filed as a free one (Priority: P2)

The funnel options offered "a **free** event: webinar, challenge, masterclass" and "a
low-priced product or service". An owner running a **paid** webinar found the word "ندوة" only
in the free option and picked it — which told Qarar to count registrations for a campaign
selling tickets. A dedicated paid-event option must exist, each option must state what Qarar
counts, and a save-time check must catch the mismatch.

**Why this priority**: This single mis-selection is the root cause of the entire live-account
failure. The event-match gate (Story 1) stops the damage; this stops the mistake. Any coach
running a paid challenge or webinar hits the same trap.

**Independent Test**: Select the new paid-event option, save, reload, and confirm the same
option is re-selected and that purchases are the counted event.

**Acceptance Scenarios**:

1. **Given** the funnel options, **When** the user runs a paid event, **Then** a dedicated
   option names it ("أقدّم فعالية مدفوعة: ندوة أو تحدٍّ أو ورشة أو ماستر كلاس، ثم أبيع بعدها")
   and is stored as the paid-offer archetype with a live component.
2. **Given** a saved paid-offer row with a live component, **When** Settings is reloaded,
   **Then** the paid-event option is the one selected.
3. **Given** the option list, **When** it is read, **Then** each option carries one short line
   naming what Qarar counts ("نعدّ: المشتريات" / "نعدّ: التسجيلات"), and the word "مجانية" is
   emphasised in the free-event option.
4. **Given** a chosen funnel type that counts registrations while the account's last 30 days
   record at least three times as many purchases as registrations, **When** the user saves,
   **Then** a question appears before saving asking whether the event is paid, with a
   one-click switch — and the same check applies in the opposite direction.

---

### User Story 6 - A number Meta did not send is not a zero (Priority: P3)

When Meta returns no data at all for a figure, that is "unknown", not "zero". A campaign with
real sales was shown 🟡 "العائد الكلي 0.0x" because a missing value was read as zero return.
Any rule that needs an absent number must stand down and say what is missing — but a real zero
must still be treated as a real zero, so the engine distinguishes the two by whether the
payload is internally consistent.

**Why this priority**: It is a narrow but entirely wrong verdict class — a loss declared on
evidence that was never received. The consistency test is what keeps the fix from swinging too
far and disarming the zero-result rules on genuinely failing objects.

**Independent Test**: Evaluate the three payload shapes — results absent with clicks, results
absent without clicks, and results present without a matching entry — and confirm only the
first is treated as unknown.

**Acceptance Scenarios**:

1. **Given** a campaign with results greater than zero and no sales-value data from Meta,
   **When** it is evaluated, **Then** no "العائد 0.0x" text appears and no return-based rule
   fires.
2. **Given** a campaign where Meta did return sales-value data whose total is zero,
   **When** it is evaluated, **Then** that genuine zero is used as before.
3. **Given** an object with no results data and more than zero link clicks — an inconsistent
   payload, **When** it is evaluated, **Then** its counts are unknown, the verdict is ⏳ with a
   reason naming what is missing, and the zero-result kill does not fire.
4. **Given** an object with no results data and zero link clicks — a consistent payload,
   **When** it is evaluated, **Then** the counts are a genuine zero and the zero-result and
   click-through rules evaluate normally.
5. **Given** an object whose results data is present but carries no purchase or registration
   entry, **When** it is evaluated, **Then** the counts are a genuine zero and the zero-result
   and click-through rules evaluate normally.

---

### User Story 7 - No "raise the budget" advice while the cost is above target (Priority: P3)

Once the counting error was fixed, two campaigns costing 1.38× and 1.26× their target were
told 🟢 "raise the budget 20%", because the scale rule looked only at full-funnel return.
Scaling advice must require the cost per result to be at or below target.

**Why this priority**: It is the inverse false signal — pouring money into a campaign that is
losing against its own target. Smaller blast radius than a false kill, same loss of trust.

**Independent Test**: Evaluate a campaign with a healthy full-funnel return and a cost above
target; confirm no "+20%" appears in its action.

**Acceptance Scenarios**:

1. **Given** a campaign with full-funnel return 3.2 and a cost per result at 1.38× its target,
   **When** it is evaluated, **Then** the action contains no "+20%" and instead says to
   continue without raising the budget.
2. **Given** a campaign with full-funnel return at or above the safety floor and a cost per
   result at or below target, **When** it is evaluated, **Then** the S2 "+20%" action is
   unchanged.

---

### User Story 8 - The summary agrees with the panels (Priority: P3)

The summary strip read "للإيقاف 0" and "نزيف يومي $0" while the diagnosis panel listed five
red ads. Whatever the counters say must be what the page shows.

**Why this priority**: The counters are the first thing read and the last thing trusted. Fixing
the status gate removes the phantom rows; this makes the agreement a guaranteed invariant
rather than a coincidence.

**Independent Test**: For every fixture, compare the two counters against the red ad-set and
red ad rows, and check the daily bleed never counts the same spend twice.

**Acceptance Scenarios**:

1. **Given** any account snapshot, **When** the dashboard renders, **Then** the counter reads
   "للإيقاف: {N} مجموعة · {M} إعلان" with N equal to the red ad-set rows and M equal to the red
   ad rows, and a zero part hidden.
2. **Given** a red ad inside a yellow ad set, **When** the dashboard renders, **Then** M is 1,
   N excludes that ad set, and the daily bleed is that ad's spend.
3. **Given** a red ad inside a red ad set, **When** the dashboard renders, **Then** N is 1 and
   M is 1, and the daily bleed counts the ad set's spend only — not the ad's spend on top of it.
4. **Given** any account snapshot, **When** the table is switched between campaign, ad-set and
   ad level, **Then** neither counter changes.
5. **Given** an account whose only red rows were gated objects, **When** the dashboard renders,
   **Then** both counters and the panels show none.

---

### Edge Cases

- **Both event families at zero** — a genuine zero. The event-match gate must not fire; the
  existing zero-result kill applies.
- **Mismatch spend just under half the account's active spend** — individual rows are still
  gated, but no account-level warning card appears.
- **Ad with zero impressions and zero spend share** — if its effective status is not active the
  status gate catches it; if it is active, it is never judged weak, whatever its click-through
  rate reads, and its reason comes from the exposure floor rather than a "موقوف" badge.
- **Object in a transient state after an edit** — treated as active and judged normally, so a
  verdict does not disappear and reappear around every change.
- **Object rejected or awaiting review** — gated, but the badge names the real state so the user
  is not told it is paused when it is not.
- **Ad starved on the three-day total but not on every one of the three days** — not starved.
- **Rescue candidate on a small sample** — a click-through rate above the median on fewer than
  500 impressions is not a rescue. A cost-based rescue still requires at least one counted
  result.
- **An object that would have held a kill verdict but is paused** — becomes ⏳, and the summary
  counters must fall accordingly rather than keeping the row in the count.
- **Account with no usable history** — the target falls back to the funnel math, and the
  displayed source says so.
- **Account that rarely records registrations** — its history-derived cost per registration can
  be very large; this is exactly the case where both figures must be shown.
- **Settings row saved as a paid offer with a live component before this feature existed** —
  must re-select the new paid-event option, not the low-priced-product option.
- **Sales-value data absent while results are positive** — no return-based verdict; the cost
  per result is still shown.
- **Results data absent while link clicks are positive** — an inconsistent payload. Counts are
  unknown, the object takes ⏳, and the zero-result kill stands down.
- **Results data absent and link clicks zero** — a consistent payload and a genuine zero. The
  zero-result and click-through rules evaluate normally; this is the case the engine must keep
  catching.
- **Campaign above target but with a healthy full-funnel return** — no scale advice; see
  Assumptions for how far above target this reading extends.

## Requirements *(mandatory)*

### Functional Requirements

**Event-match gate (T1 · rulebook §4.1)**

- **FR-001**: The engine MUST evaluate an event-match gate immediately after the status gate,
  at campaign, ad-set and ad level, before any other gate or rule.
- **FR-002**: The counted result event MUST be the event implied by the account's funnel type.
  The comparison event MUST be the opposite family — purchases for registration-counting funnel
  types, registrations for purchase-counting funnel types.
- **FR-003**: When the counted event is zero in the evaluation window and the comparison event
  is greater than zero, the object MUST receive verdict ⏳ with rule code `GATE`, the reason
  "إعدادات الفانل تعدّ نوعًا من النتائج لا تسجله هذه الحملة — هذه الحملة تسجل مبيعات/تسجيلات من
  النوع الآخر" with the result noun taken from the funnel type, and the action
  "راجع نوع الفانل في الإعدادات".
- **FR-004**: When both the counted and the comparison event are zero, the gate MUST NOT fire
  and existing zero-result behaviour (K1) MUST apply unchanged.
- **FR-005**: When objects tripping this gate hold at least 50% of the account's active spend,
  the account summary MUST carry a settings-mismatch flag, and the dashboard MUST render a
  warning card at the top linking to Settings.

**Status gate first (T2 · rulebook §4.2)**

- **FR-006**: The status gate MUST run first in every evaluator, before the event-match gate
  and before every rule — including the clear click-through kill (K3) and the starvation matrix
  (K5).
- **FR-007**: The gate MUST key off Meta's reported effective status alone. Any object whose
  effective status is not active MUST pass through no rule and MUST receive ⏳ with rule code
  `GATE`. An object that is active but spent nothing MUST NOT be gated here — it falls through
  to the data gates and the K5 exposure floor, which carry the accurate reason.
- **FR-007a**: `IN_PROCESS` and `PREAPPROVED` MUST be treated as active. They are transient
  states on objects that are still delivering, and gating them would make verdicts flicker
  after every edit.
- **FR-007b**: Where Meta returns no effective status for an object, its own status MUST be used
  as the fallback, preserving today's behaviour.
- **FR-008**: Each gated state MUST carry its own display badge. Badges are display states only
  and MUST NOT become a sixth verdict — the verdict stays ⏳ with rule code `GATE` in every row
  below:

  | Effective status | Badge |
  |---|---|
  | `PAUSED`, `CAMPAIGN_PAUSED`, `ADSET_PAUSED` | "موقوف" |
  | `PENDING_REVIEW` | "قيد المراجعة" |
  | `DISAPPROVED` | "مرفوض" |
  | `WITH_ISSUES`, `PENDING_BILLING_INFO` | "به مشكلة — راجعه في مدير الإعلانات" |
  | `ARCHIVED`, `DELETED` | not shown at all |

- **FR-009**: Gated objects MUST be excluded from the diagnosis panel ("أين المشكلة؟"), from
  today's decisions / top actions, and from the 🔴 count in the summary. Archived and deleted
  objects MUST NOT be rendered anywhere.
- **FR-010**: No reason or action text MUST instruct the user to pause an object that is
  already paused.

**Starvation floor (T3 · rulebook §5.0)**

- **FR-011**: An ad MUST be treated as starved only when its share of its ad set's spend is
  below 10% on **each** of the last three days individually, not merely across the three-day
  total — and only when it is older than 48 hours.
- **FR-012**: An ad MUST NOT be judged weak below 500 impressions in the window. Below that
  floor, and not rescue-eligible, it MUST receive ⏳ with rule code `K5`, the reason
  "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه", and the action "اتركه — لا قرار الآن".
- **FR-013**: An ad with zero impressions MUST never be judged weak.
- **FR-014**: The 500-impression floor MUST also apply to the click-through-based rescue
  branch, so that no 🛟 rescue is issued on a sample below the floor.
- **FR-015**: A cost-based rescue MUST still require at least one counted result.
- **FR-016**: The starvation matrix MUST read "zero results" only after the event-match gate
  has passed, so a counting mismatch can never present as weak efficiency.

**Shown target = judging target (T4 · rulebook §4.1, principle 9)**

- **FR-017**: The server MUST return the exact target figure and its source — the same pair the
  engine judged with — to both the dashboard summary and Settings.
- **FR-018**: When account history is available, Settings MUST display the engine's target with
  its source in simple Arabic ("محسوب من متوسط حسابك في آخر 30 يومًا" /
  "محسوب من أرقام الفانل").
- **FR-019**: When the funnel-math figure differs from the engine's target by more than 20%,
  Settings MUST show both figures and state which one the engine uses.
- **FR-020**: The target figure shown in the dashboard summary and in Settings MUST be
  identical.

**Paid-event funnel option (T4b · rulebook §2.1)**

- **FR-021**: The funnel-type list MUST offer a dedicated paid-event option
  ("أقدّم فعالية مدفوعة: ندوة أو تحدٍّ أو ورشة أو ماستر كلاس، ثم أبيع بعدها"), stored as the
  paid-offer archetype with the live component set. It MUST be a presentation option only — no
  new engine archetype, and no change to target math or result counting.
- **FR-022**: A saved paid-offer row with a live component MUST re-select the paid-event option
  when Settings is reloaded.
- **FR-023**: Each funnel option MUST carry one short line naming what Qarar counts
  ("نعدّ: المشتريات" / "نعدّ: التسجيلات").
- **FR-024**: The word "مجانية" MUST be emphasised in the free-event option so the paid and
  free event options cannot be confused.
- **FR-025**: On save, the system MUST read the account's last 30 days of recorded events. If
  the chosen funnel type counts registrations while purchases are at least three times
  registrations — or the reverse — it MUST ask before saving
  ("حملاتك تسجل مبيعات أكثر بكثير من التسجيلات — هل الفعالية مدفوعة؟") and offer a one-click
  switch.

**Absent is not zero (T5 · rulebook principle 10)**

- **FR-026**: The **sales value** MUST be carried as unknown whenever Meta returned no value
  data at all, and MUST never be coerced to zero. When the value data is present, its total is
  used as returned — including a genuine zero.
- **FR-027**: **Conversion counts** MUST be carried as unknown in exactly one case: the results
  data is absent **and** link clicks are greater than zero — an inconsistent payload, where
  clicks happened but no results came back. The following two shapes are genuine zeros and MUST
  be evaluated normally by the zero-result rules (K1) and the click-through kill (K3):
  - results data absent and link clicks zero — consistent: nobody clicked;
  - results data present but carrying no purchase or registration entry.
- **FR-028**: Any rule reading an unknown figure MUST stand down. The campaign return rule (W6)
  MUST NOT produce "العائد الكلي 0.0x" on an unknown value, and the zero-result rules MUST NOT
  fire on unknown counts. An object whose verdict depends on an unknown figure MUST receive ⏳
  with a reason naming what is missing.

**Scale advice respects the target (T7b · rulebook §5.4)**

- **FR-029**: The S2 "+20%" scaling action MUST require the campaign's cost per result to be at
  or below its unit target. Otherwise the action MUST be "واصل بدون زيادة الميزانية" and the
  verdict MUST follow the watch rules.

**Counters agree with the page (T7c · rulebook §5.5)**

- **FR-030**: The counted population MUST be ad sets and ads. Campaigns MUST never be counted —
  a campaign is a summary of its ad sets (rulebook §5.0), so counting it would double-count the
  same loss.
- **FR-030a**: The red counter MUST display the split rather than one merged number:
  "للإيقاف: {N} مجموعة · {M} إعلان", where N is red ad sets and M is red ads. A part whose count
  is zero MUST be hidden.
- **FR-030b**: The daily-bleed figure MUST sum the spend of every red ad set, plus the spend of
  red ads whose parent ad set is **not** red — the parent-most rule, so no spend is counted
  twice. The existing daily-bleed formula is otherwise unchanged.
- **FR-030c**: Gated objects (FR-007) MUST never be counted in N, M or the daily bleed.
- **FR-030d**: The invariant MUST hold and MUST be view-independent: N equals the number of red
  ad-set rows, M equals the number of red ad rows, every red ad or ad set shown in
  "أين المشكلة؟" or in top actions is included in N or M, and nothing else is. Switching the
  table between campaign, ad-set and ad level MUST NOT change either number.

**Cross-cutting (constitution)**

- **FR-031**: The verdict vocabulary MUST remain exactly 🔴 🟡 🟢 🛟 ⏳. No verdict is added,
  renamed, merged or recoloured.
- **FR-032**: Every output MUST carry its rulebook rule code verbatim, surfaced to users only
  faded and in tooltips.
- **FR-033**: All new and changed user-facing copy MUST be simple Modern Standard Arabic at a
  6th-grade reading level, with numerals rendered left-to-right inside the right-to-left layout.
- **FR-034**: The verdict, the written reason and the diagnosis for an object MUST all come from
  the same evaluation, the same numbers and the same window. The **cost column** is deliberately
  excluded here: making it share one source with the verdict is task T7, which this spec defers to
  feature 016 (see Out of scope). Rulebook §5.5's consistency rule covers all four; this feature
  delivers three of them.
- **FR-035**: A kill action at **ad** level MUST name the ad, not its ad set. The ad-level
  zero-result kill currently emits "أوقِف هذه المجموعة" ("stop this ad set") on an ad row; it MUST
  read "أوقِف هذا الإعلان". The three ad-set-level kill rules keep their existing wording, which is
  correct for their level.

### Key Entities

- **Funnel settings**: the account's economic funnel type, whether it has a live component, the
  counted result event derived from them, and the judging target with its source. Owned by one
  account; read by every evaluation.
- **Evaluated object**: a campaign, ad set or ad, carrying its effective status, its spend,
  impressions and results for the evaluation window, its counted and comparison result counts,
  its per-day share of its ad set's spend, and whether its sales value is known.
- **Verdict record**: the outcome for one object — verdict, rulebook code, written reason,
  recommended action, and any display badge such as "موقوف".
- **Account summary**: the counters shown above the table (objects to stop, daily bleed), plus
  the settings-mismatch flag that drives the top-of-dashboard warning card.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Replaying the 15–17 Oct 2026 window with the account's funnel type left unchanged
  produces ⏳ with the settings-mismatch message on all five campaigns in the evidence table,
  and zero rows claiming "بدون أي نتيجة" or "0.0x".
- **SC-002**: Zero gated objects appear in the diagnosis panel, in today's decisions, or in the
  summary's red count, across every fixture; and every gated object's badge matches its real
  reported state, with one test per badge group.
- **SC-003**: Zero **K5** kill or rescue verdicts are issued on an ad with fewer than 500
  impressions in the window. The floor is scoped to the starvation path: the ad-level zero-result
  kill (K1) fires on spend against target with no impression floor, and this feature deliberately
  adds none — an ad that burned twice its target with no result is a real failure however few
  impressions it bought.
- **SC-004**: The target figure displayed in Settings equals the figure the engine judged with
  in 100% of accounts, and its source is named on screen.
- **SC-005**: An owner running a paid event can select a funnel option that names a paid event
  explicitly and states that purchases are counted, and a saved paid-event choice survives a
  reload unchanged.
- **SC-006**: Zero loss verdicts — kill or watch — are issued on the basis of a figure Meta did
  not return; and in the other direction, an object with a consistent genuine zero still
  receives its zero-result verdict in 100% of cases. Both directions are covered by tests for
  all three payload shapes.
- **SC-007**: Zero campaigns whose cost per result exceeds their target receive "+20%" budget
  advice.
- **SC-008**: For every fixture, the ad-set and ad counters each equal their matching red rows,
  no campaign is counted, no spend is counted twice in the daily bleed, and neither number
  changes when the table switches level.
- **SC-009**: Across every fixture, no row holds a 🔴 verdict whose written reason claims no
  results while that row's `w3d.conversions` is greater than zero. Verified by an invariant test
  over all fixtures, not by inspection.
- **SC-010**: The verdict set remains exactly five, and every emitted rule code matches the
  rulebook verbatim.

## Assumptions

- **Window**: all judgments in scope read the last 3 complete days excluding today, per rulebook
  Part 4. Today's data is used only by the daily circuit breaker, which this feature does not
  change.
- **Verdict for a campaign above target with a healthy funnel return (FR-029)**: the source task
  says the verdict "follows W1 territory", which the rulebook defines as a cost between 1× and
  1.5× target. For a cost above 1.5× target with a full-funnel return at or above the safety
  floor, this spec assumes the existing W6 reading ("كمّل بحذر — الحكم النهائي للفانل") applies,
  since the rulebook defines W6 for exactly that case. Either way, no "+20%" action is emitted.
  This is an interim rule: feature 016 replaces campaign rule logic with a derivation from the
  ad sets.
- **Account-level mismatch threshold**: the 50% figure in FR-005 is the share of *active* spend,
  as written in the source task. Rows below that threshold are still gated individually.
- **Save-time event check (FR-025) costs no new request**: it reuses the per-day results data
  for the last 30 days that the account already fetches for its baseline medians, read from the
  cached snapshot. It MUST NOT issue a new request to Meta. If no snapshot exists the check is
  skipped silently, and it MUST never block or delay the save — an absent history is unknown,
  not a mismatch (rulebook principle 10).
- **The save-time event check is advisory (FR-025)**: if the user declines the suggested switch,
  their original choice is saved unchanged. The check informs; it never overrides.
- **"Active spend" in the account-level threshold (FR-005)** means the window spend of ad sets
  that pass the status gate — the same population the counters use (FR-030). Gated objects are
  excluded from both the numerator and the denominator, so paused history cannot drag the
  threshold either way.
- **The paid-event option changes no math**: it reuses the existing paid-offer target
  calculation and purchase counting. Existing saved rows keep their stored values.
- **Non-sales funnel rules (NS1/NS2) and the appointment/webinar archetypes** from features 012
  and 013 stay in force; the rulebook's compatibility note states its changes apply to them too,
  and nothing in this feature removes them.
- **Rulebook v2.2 is the source of truth** and supersedes v2.1 where they differ. The project
  constitution's Principle I was amended to the v2.2 evaluation order before this spec was
  written.
- **Existing engine tests stay green**, except tests that assert the specific wrong behaviours
  this feature fixes — those are updated deliberately and called out.
- **Arabic number–noun agreement in the new counter copy (FR-030a)**: the label is specified as
  "للإيقاف: {N} مجموعة · {M} إعلان", which reads correctly for 1 and for 11 and above but not
  for 2 or for 3–10 in formal Arabic. The helper that fixes agreement across all engine copy is
  task T14 in feature 018; until it lands, this label ships as written above rather than
  inventing a one-off rule here.

## Out of scope / follow-up features 016–018

Everything in sections P1, P2 and P3 of the source spec is excluded here. Two P1 items — T7b
and T7c — were pulled into this feature because they are false-signal fixes of the same class;
the rest stay out.

**Feature 016 — Judgment model (rulebook §5.0, §5.5)**

- **T6** — the ad set becomes the judgment unit and the campaign verdict is derived from its
  child ad sets; ±20% controls move to the right level by budget type.
  - Deferred from feature 015's self-review (finding M3, owner decision 2026-10-19):
    `evaluateCampaign` still runs its own inline rules (spend gate, W5, the T070 W1/W6 guard,
    S2, W6, K1) instead of deriving the campaign verdict from its ad sets as constitution
    Principle I requires. 015 only placed its new gates (status, event-match, unknown counts)
    ahead of them.
- **T7** — a single source for the results and cost columns, counted with the same selector as
  the verdict, with the cost shown whenever results are greater than zero.
  - Recorded deviation from feature 015 (T007, accepted by the owner 2026-10-19): the
    DecisionTable footer aggregation coalesces `conversionValue ?? 0`. The footer must treat an
    unknown `conversionValue` as unknown, not 0.
  - Deferred from feature 015's self-review (finding L4, owner decision 2026-10-19): on an
    unknown-count window (`resultsUnknown`) the table's results cell still shows `0`
    (`conversions_3d: rowConv ?? 0`). The verdict is already ⏳ naming the missing data; the cell
    must show the count as unknown, not 0.
- **T8** — verdict/diagnosis consistency post-check: a row diagnosed "insufficient data" cannot
  hold 🔴 unless the rule was designed to work without a full sample.

**Feature 017 — Geo tiers (rulebook §2.5, §3.1, G1)**

- **T9** — ad-set geo targeting and per-country breakdown plumbing, with unknown treated as
  unknown.
- **T10** — qualified-country list and cheap-country target percentage in Settings, with the
  production migration.
- **T11** — per-tier targets for every rule that reads a target, including the allowed-spend
  calculation for mixed ad sets and the new G1 spend-leak alert.

**Feature 018 — Identity, cost per impression, copy (rulebook Part 8, Part 11)**

- **T12** — ad identity everywhere: thumbnail, campaign › ad set line, deep link, and grouping
  of copies that share a Post ID.
- **T13** — compare an ad's cost per impression against its siblings in the same ad set, not
  against the account average.
- **T14** — copy fixes: the evaluation-window banner, Arabic number–noun agreement, and Arabic
  column labels.
