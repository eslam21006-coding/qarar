# Feature Specification: Diagnosis Evidence & Honest Fallbacks

**Feature Branch**: `feature/diagnosis-evidence-fallbacks`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "The dashboard section «أين المشكلة تحديداً؟» shows the identical 'the problem is not the ads — book a discovery call' sentence on every flagged row, including rows carrying a 🔴 kill verdict. The root cause is that `diagnose()` treats an empty findings list as proof of innocence, when it actually conflates 'every rung was measured and came back healthy' with 'no rung had enough data to be measured at all'. Replace the single step-6 fallback with three honest, mutually exclusive terminal outcomes, make every sentence provable from that row's own numbers, and make the discovery-call CTA appear only when the evidence supports it."

---

## Context

The diagnosis ladder walks a flagged object through six rungs — ad cost-per-view,
hook strength, message/CTA mismatch, landing-page arrival, page conversion, and
post-conversion. Each of the first five rungs is behind a **volume gate**: below a
minimum number of impressions, link clicks, or landing-page views, the rung cannot
be judged at all and is silently skipped.

Today the ladder ends with a single fallback: *if no rung reported a problem, tell
the user the ads are fine and the problem is the offer or the funnel, and show a
booking button*. That fallback fires in two completely different situations:

1. Every rung **was** measured and every one came back healthy → the ad is genuinely innocent.
2. **No** rung had enough data to be measured → we know nothing at all.

Because a small-budget advertiser's three-day window routinely clears none of the
gates, case 2 is the common one in production — and the product answers it with a
confident innocence claim it never established. On one observed account, five
flagged rows produced five byte-identical diagnosis cards and five identical
full-width booking buttons; two of those rows simultaneously said "turn this ad
off" (🔴) and "the problem is not the ads."

Three independent defects produce this:

- **D1 — Absence of evidence rendered as evidence of innocence.** `findings.length === 0`
  cannot distinguish "measured and clean" from "never measured".
- **D2 — The diagnosis cannot see the verdict.** The diagnosis routine never receives
  the rule that fired, so it absolves an ad that a rule such as K3 (dead hook), K1 (no
  results at all) or K6 (cost per lead doubled) just condemned by name.
- **D3 — The innocence claim carries no numbers.** Nothing on screen justifies the claim
  or the booking button, so the card reads as a sales prompt rather than a diagnosis.

This feature is squarely a Constitution VII concern — the offer/funnel outcome is a
first-class diagnosis result, and it stays first-class only if it is *earned*. It is
also a Constitution III concern (plain Arabic, LTR numerals inside RTL) and a
Constitution I/VI concern in the negative sense: the verdict pipeline must not move.

---

## Clarifications

### Session 2026-08-26

- Q: Does the ad-fault classification stay binary, or gain a third "neither" bucket? → A: Three-way — ad-fault / funnel-fault / neither; a "neither" rule with no broken rung declines to place blame.
- Q: Is the page-conversion rung's own «الإعلان بريء» wording in scope for suppression? → A: In scope and strengthened — suppressed when the fired rule is ad-fault, and it additionally requires rungs 1–4 to be evaluated and clean, not merely non-firing.
- Q: Which rungs must be evaluable and clean before FUNNEL_CONFIRMED may fire? → A: Both the landing-page arrival and the page-conversion rungs; anything less resolves to INSUFFICIENT_DATA.
- Q: How does campaign-level W5 reconcile with FR-006b's rung precondition? → A: W5 is its own evidence path into FUNNEL_CONFIRMED, but only when the explicit funnel-underperforming flag is set AND a measured campaign cost-per-customer exists — both required; absent either, the campaign resolves to INSUFFICIENT_DATA like any other row.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A small-budget advertiser is told the truth, not a guess (Priority: P1)

An advertiser running a modest daily budget opens the dashboard three days after
launching. Their ad has a few hundred impressions, a dozen link clicks, and no
landing-page views yet. Today the product tells them, with a booking button, that
their ads are fine and the problem is their offer. That claim is unfounded: not one
rung of the ladder had enough traffic to be judged.

The advertiser must instead read a plain sentence that says what was observed and
what is still missing before a diagnosis is possible — with no claim about where the
problem is or is not, and no booking button.

**Why this priority**: This is the defect the user actually reported, it is the
majority case for the product's core audience, and it converts a false statement into
a true one. It is also the precondition for every other outcome being trustworthy —
until "we don't know" exists as an answer, every other answer is suspect.

**Independent Test**: Build a flagged object below every volume gate and confirm the
diagnosis states the observed counts and the missing volume, carries no booking link,
and contains no innocence claim in any wording.

**Acceptance Scenarios**:

1. **Given** a flagged ad with 800 impressions, 12 link clicks and 0 landing-page views,
   **When** the dashboard renders its diagnosis, **Then** exactly one diagnosis line
   appears, it names the counts observed and the volume still needed, it carries no
   discovery-call link, and it does not contain the phrase «ليست بالإعلانات» or any
   equivalent innocence claim.
2. **Given** the same ad, **When** the account-level summary is built, **Then** that row
   contributes nothing toward the account-level "your funnel is the problem" card.
3. **Given** an object whose only evaluable rung is the cost-per-view rung,
   **When** that rung comes back healthy, **Then** the outcome is not treated the same
   as an object where every rung was evaluated and clean: because the landing-page arrival
   and page-conversion rungs were not evaluable, the innocence claim is withheld and the
   row resolves to INSUFFICIENT_DATA (FR-006b), with no discovery-call link.

---

### User Story 2 — A condemned ad is never absolved in the same breath (Priority: P1)

An advertiser sees a 🔴 **أوقف** verdict on an ad because almost nobody clicked it —
the hook is dead. Directly beneath that verdict, today, the product says the problem
is not the ads and offers to book a call. The two statements contradict each other on
the same card, and the advertiser cannot tell which to believe.

When the rule that produced the verdict blamed the ad itself, the diagnosis must
restate that reasoning and point at the ad. It must never claim innocence, and it must
not offer the discovery call.

**Why this priority**: A self-contradicting screen destroys trust in every other
verdict on the page, and it is the second half of the reported defect. It is also
independently shippable: it only needs the diagnosis to know which rule fired.

**Independent Test**: Build a flagged object whose rungs are all unevaluable except one
clean rung, force an ad-fault rule to fire, and confirm the diagnosis points at the ad,
echoes the verdict's reasoning, and carries no booking link.

**Acceptance Scenarios**:

1. **Given** an ad whose verdict came from a dead-hook rule and whose rungs are otherwise
   unevaluable, **When** the diagnosis renders, **Then** it does not absolve the ad in any
   wording and carries no discovery-call link.
2. **Given** any row in any fixture, **When** its verdict is 🔴 and the rule that produced it
   is classified ad-fault by FR-008, **Then** no line on that row claims the problem is not the ads.
3. **Given** a row whose verdict came from a rule classified **funnel-fault** (not merely
   "not ad-fault"), and whose landing-page arrival and page-conversion rungs were both evaluated and
   clean, **When** the diagnosis renders, **Then** the innocence claim and the discovery-call link are
   permitted.
4. **Given** a row whose verdict came from a rule classified **neither** — a cost-driven or
   circuit-breaker code — and whose rungs were evaluated and clean, **When** the diagnosis renders,
   **Then** the innocence claim and the discovery-call link are withheld (NO_BLAME_ASSIGNABLE).

---

### User Story 3 — The innocence claim shows its work (Priority: P2)

An advertiser whose ads genuinely are clean deserves to see *why* the product reached
that conclusion before it asks them to book a call. Today the claim is a bare sentence.
It should read as a funnel walk-through built from that row's own figures: how many
people saw the ad, how many clicked (against the account's typical click rate), how many
of those clicks actually arrived on the page, and how many of those arrivals converted —
and only then the conclusion that the leak is in the offer or the funnel.

**Why this priority**: This is what turns the booking prompt into a diagnosis. It is
lower priority than US1/US2 only because it improves a correct answer rather than
replacing a wrong one.

**Independent Test**: Build an object where every rung is evaluable and clean and the
fired rule is not ad-fault; confirm the rendered text contains at least three distinct
figures drawn from that object's own window, presented as an ordered funnel, with the
conclusion last.

**Acceptance Scenarios**:

1. **Given** an object with every rung evaluable and clean and a non-ad-fault rule,
   **When** the diagnosis renders, **Then** the text presents impressions → link clicks
   (with the account median for comparison) → landing-page views as a share of clicks →
   conversions as a share of landing-page views → conclusion, in that order.
2. **Given** any such output, **When** it is inspected, **Then** it contains at least three
   distinct numeric values, every one of them drawn from that object's own window.
3. **Given** any such output, **When** it is rendered in the right-to-left layout, **Then**
   every numeric value renders left-to-right per Constitution III.
4. **Given** an object with 4,200 impressions, a link click-through rate above the account
   median, an 85% landing-page arrival rate and a 1.4% conversion rate, **When** the
   diagnosis renders, **Then** the page-conversion rung reports as broken, the reported
   conversion figure appears in the text, and that line carries the discovery-call link.

---

### User Story 4 — One booking button, and rows you can tell apart (Priority: P3)

The observed screen repeated a full-width «احجز مكالمة تشخيصية مجانية» button under
every row, and two rows carried the same name with no way to tell which was the campaign,
the ad set, or the ad.

The account-level card is the one place the booking *button* belongs. A row that has
earned a funnel signal may carry at most one subtle inline text link. Every row must
also show its level alongside its name.

**Why this priority**: Presentation polish that makes the corrected content legible.
It depends on US1–US3 landing first but is independently testable.

**Independent Test**: Render a mixed set of flagged rows and confirm exactly one
full-width booking button exists on the page, that every row carrying funnel evidence
shows at most one inline text link, and that every row shows حملة / مجموعة / إعلان next
to its name.

**Acceptance Scenarios**:

1. **Given** a page with three rows carrying funnel evidence, **When** it renders, **Then**
   exactly one full-width booking button appears, in the account-level card.
2. **Given** two objects sharing a name at different levels, **When** the diagnosis section
   renders, **Then** the level label distinguishes them.
3. **Given** an account where every flagged row is "not enough data", **When** the summary is
   built, **Then** no account-level funnel card renders at all.

---

### Edge Cases

- **Zero rungs evaluable and the fired rule is ad-fault.** The "not enough data" outcome is
  resolved first by construction, so the ad-fault message never fires here. The row still
  must not carry an innocence claim — trivially satisfied, but asserted.
- **Some rungs evaluable, at least one broken.** No terminal outcome is appended at all; the
  broken rungs speak for themselves. Existing behaviour, preserved.
- **A rung broke *and* the fired rule is ad-fault.** The page-conversion rung's own
  "⚠️ الإعلان بريء" wording is an innocence claim that would otherwise coexist with an ad-fault
  verdict. Per FR-017 it is suppressed in favour of the rung's neutral wording, so SC-003 holds
  across rung-level copy as well as terminal outcomes.
- **The page-conversion rung breaks while rungs 1–4 were never evaluated.** Today the rung absolves
  the ad because no earlier rung *fired*, which is defect D1 one rung lower. Per FR-017a the
  innocence wording now requires rungs 1–4 to have been evaluated and clean; otherwise the rung
  renders its neutral wording.
- **Non-sales exempt object (NS1 / NS2).** Hard-skipped before the ladder runs; still receives
  an empty findings list, exactly as Spec 013 defined. This feature must not change it.
- **Campaign-level W5.** The campaign path appends its own post-sale funnel line carrying the
  booking link. Per FR-009a it is expressed as FUNNEL_CONFIRMED via W5's own evidence path, and per
  FR-009c that line now carries the measured cost-per-customer figure instead of being a bare claim.
- **W5 fired but its evidence is incomplete.** The funnel-underperforming flag is set yet no measured
  campaign cost per customer exists (or the reverse). Per FR-009b the evidence path does not open:
  the campaign resolves to INSUFFICIENT_DATA, carries no discovery-call link, and contributes nothing
  to the account funnel card.
- **A rung whose gate is met but whose comparison baseline is absent** (for example, the account
  cost-per-view average is null). The rung is unevaluable, not clean.
- **Landing-page views recorded as zero while link clicks clear their gate.** The arrival rung
  today requires a non-zero landing-page count to fire; zero arrivals must not silently read
  as a healthy rung.
- **An object with enough volume on every gate but zero conversions.** The conversion rung is
  evaluable and broken, not unevaluable.
- **A funnel-fault rule fired, no rung broke, but the arrival or conversion rung was unevaluable.**
  The row resolves to INSUFFICIENT_DATA per FR-006b — not FUNNEL_CONFIRMED — so it carries no
  innocence claim, no discovery-call link, and contributes nothing to the account funnel card.

---

## Requirements *(mandatory)*

### Evaluability tracking

- **FR-001**: The diagnosis MUST track, per object, the set of rungs that were **evaluable**
  (data sufficient to judge) separately from the set that were **broken**. A rung skipped for
  lack of data is neither broken nor clean.
- **FR-002**: The evaluability thresholds are the volume gates that exist in the code today.
  They MUST be extracted into named constants and documented — each threshold, its rung, and its
  present value — in `research.md`. Their values MUST NOT change in this feature.
- **FR-003**: Rungs that were evaluated and came back **healthy** MUST be recorded, because the
  clean set is the evidence FR-007 renders.
- **FR-003a**: A rung whose volume gate is met but whose required comparison baseline is missing
  MUST be recorded as unevaluable, not clean.

### Four honest terminal outcomes

The single fallback is replaced by exactly four mutually exclusive terminal outcomes. A terminal
outcome is appended only when no rung broke. They are resolved in this precedence:

1. **INSUFFICIENT_DATA** — zero rungs evaluable (FR-004).
2. **AD_IS_THE_PROBLEM** — fired rule is ad-fault (FR-005).
3. **NO_BLAME_ASSIGNABLE** — fired rule is *neither* (FR-006a).
4. **FUNNEL_CONFIRMED** — fired rule is funnel-fault **and** the conversion-relevant rungs are
   evaluable and clean (FR-006).
5. Otherwise — fired rule is funnel-fault but the FR-006 rung precondition is unmet →
   **INSUFFICIENT_DATA** (FR-006b).

- **FR-004 — INSUFFICIENT_DATA**: Fires when zero rungs were evaluable, and as the fall-through of
  FR-006b. Its text MUST state the counts actually observed and the volume still needed before a
  diagnosis is possible. It MUST carry no discovery-call link, and MUST NOT contain any claim about
  where the problem is or is not — in any wording.
- **FR-005 — AD_IS_THE_PROBLEM**: Fires when at least one rung was evaluable, none broke, and the
  object's fired rule is classified **ad-fault** by FR-008. Its text MUST restate the fired rule's
  reasoning and point the user at the ad. It MUST carry no discovery-call link, and MUST NOT claim the ad is
  innocent in any wording.
- **FR-006 — FUNNEL_CONFIRMED**: Fires only when no rung broke, the fired rule is classified
  **funnel-fault** by FR-008, **and** both the landing-page arrival rung and the page-conversion rung
  were evaluable and came back clean. This is the **only** terminal outcome that may claim the ad is
  innocent, and the only one that carries the discovery-call link. A rule classified *neither* never
  reaches this outcome, and neither does an object whose conversion-relevant rungs could not be judged.
- **FR-006a — NO_BLAME_ASSIGNABLE**: Fires when at least one rung was evaluable, none broke, and the
  fired rule is classified **neither** by FR-008 — a rule that condemns on cost or on a spend/result
  circuit break without implicating the creative or the offer. Its text MUST state what was measured
  and came back healthy, and MUST stop there. It MUST carry no discovery-call link, and MUST NOT claim
  the ad is innocent nor that the problem lies in the offer or funnel — in any wording.
- **FR-006b**: Where the fired rule is funnel-fault and no rung broke but the FR-006 rung precondition
  is unmet — either the landing-page arrival rung or the page-conversion rung was unevaluable — the
  outcome resolves to INSUFFICIENT_DATA, not to FUNNEL_CONFIRMED. The innocence claim and the
  discovery-call link are withheld.
- **FR-007**: The FUNNEL_CONFIRMED text MUST be built from the object's own numbers as an ordered
  funnel ladder — impressions → link clicks (with the account median shown for comparison) →
  landing-page views as a percentage of link clicks → conversions as a percentage of landing-page
  views — followed by the conclusion. The reader MUST be able to see which step leaked before they
  read the word «العرض». Numeric values render left-to-right inside the right-to-left layout per
  Constitution III.
- **FR-007a**: Where a ladder step's figure is present in the object's own window, the step MUST print
  it; a step MUST be stated unavailable only when its own inputs are genuinely absent. On the FR-006
  route, the rung precondition guarantees the landing-page and conversion steps are always available, and
  the one figure that may still be missing is the account median link click-through rate used for
  comparison. On the FR-009c W5 route, other steps may also be unavailable — see FR-009c. In every case,
  a missing figure MUST be stated as unavailable rather than printed as a zero or omitted silently.

### Rung-level innocence wording

- **FR-017**: The page-conversion rung's innocence wording ("⚠️ الإعلان بريء، لا تعدّله") MUST be
  suppressed — falling back to the rung's neutral wording, which reports the weak page conversion
  without absolving the ad — whenever the object's fired rule is classified **ad-fault** by FR-008.
  SC-003 is therefore scoped to every line on the row, not only to terminal outcomes.
- **FR-017a**: The same innocence wording MUST additionally require that rungs 1–4 were **evaluated
  and clean**, not merely that they did not fire. Where any of rungs 1–4 was unevaluable, the rung
  renders its neutral wording. This applies defect D1's correction at the rung level.
- **FR-017b**: The rung's neutral wording still counts as a broken page-conversion rung and still
  carries the discovery-call link per FR-011, because the conversion figure that produced it is
  measured. Suppressing the innocence *claim* does not suppress the *finding*. Its contribution to the
  account-level card remains subject to FR-010b: where the neutral wording was selected because the
  fired rule is ad-fault, that row is excluded from the account card even though its finding stands on
  the row.

### The ad-fault rule set

- **FR-008**: A single exported classification MUST exist that assigns every rule code in the
  rulebook to exactly one of three buckets — **ad-fault** (the code's own definition **names** the
  creative, the hook, or the ad unit itself), **funnel-fault** (the code affirmatively exonerates the ad
  and points at the page, the offer or the post-sale step), or **neither** (the code condemns on cost or
  on a spend/result circuit break and implicates nothing) — derived from the rulebook's own definition of
  each code. A code qualifies as ad-fault only where it names the ad; it does **not** qualify merely
  because an ad-side failure such as poor targeting is one possible upstream cause of the quantity it
  measures. Cost-driven codes therefore fall in *neither* unless their own text names the ad.
  There is no default bucket: every code is assigned explicitly. The classification MUST be listed in
  `research.md` with a one-line justification per code. It is the single source of truth for FR-005,
  FR-006 and FR-006a.
- **FR-008a**: Rule codes that can never reach the diagnosis (the scale codes, the exempt codes, and
  the gate code) MUST still be classified, so the classification is total over the rule vocabulary
  and cannot silently default.
- **FR-009**: The diagnosis MUST receive the fired verdict result. Every call site — ad, ad set,
  campaign — is updated accordingly. The non-sales exemption hard-skip (Spec 013 / FR-010a) stays
  exactly as it is: exempt objects still receive an empty findings list.
- **FR-009a**: The campaign-level W5 path MUST be reconciled with the outcome model: its post-sale
  funnel line MUST be expressed as one of the four outcomes rather than as an unclassified extra
  fallback, and it MUST NOT produce a second funnel line on a row that already carries one. W5 is
  classified **funnel-fault** and reaches FUNNEL_CONFIRMED through its **own evidence path** — the
  measured campaign cost per customer together with the account's explicit funnel-underperforming
  declaration — rather than through FR-006's rung precondition, which the rung ladder was never
  designed to satisfy at campaign level.
- **FR-009b**: That exemption is conditional and MUST be enforced as a hard guard. The W5 evidence
  path opens FUNNEL_CONFIRMED **only** when **both** hold: the explicit funnel-underperforming flag
  is set for the account, **and** a measured campaign cost per customer exists (non-null, derived
  from real conversions in the window). Where either is absent, the campaign resolves to
  INSUFFICIENT_DATA exactly as any other row would, and carries no discovery-call link. The
  exemption MUST NEVER open on the mere absence of an ad-fault rule — that would reintroduce at
  campaign level the binary-default problem rejected in Q1.
- **FR-009c**: The FUNNEL_CONFIRMED line produced by the W5 evidence path MUST carry the measured
  cost-per-customer figure, so the claim is provable from the campaign's own numbers per FR-007's
  intent. A campaign's window carries the same metrics an ad's does, so most ladder steps **are**
  measurable at campaign level and MUST be printed per FR-007a; the exception is the account median
  link click-through rate, which is derived at ad level and is not a like-for-like comparison for a
  campaign aggregate. Steps whose own inputs are genuinely absent are stated as unavailable per FR-007a,
  never printed as zeros. The full enumeration is in `contracts/diagnosis-outcomes.md` §C4.4.

### Account-level CTA

- **FR-010**: The account-level funnel card MUST be set only when at least one row produced a
  *confirmed* funnel signal: a broken page-conversion rung, a FUNNEL_CONFIRMED outcome, or the
  campaign-level W5 that cleared the FR-009b guard — and in every case subject to the FR-010b
  exclusion. An INSUFFICIENT_DATA row and a NO_BLAME_ASSIGNABLE row MUST NOT contribute to it, and
  neither MUST a W5 campaign that failed the FR-009b guard.
- **FR-010a**: The account-level card MUST NOT be set when no row carries confirmed funnel
  evidence, even if flagged rows exist.
- **FR-010b**: A row contributes confirmed funnel evidence only when nothing on that row blames the
  ad. A row is excluded when **either** it carries a finding from rungs 1–4 (an ad or landing-flow
  issue was measured and is failing), **or** its fired rule is classified **ad-fault** by FR-008.
  This holds even when that row's page-conversion rung broke and is therefore genuine funnel evidence
  in isolation: an account-level card reading «مؤشرات إعلاناتك جيدة» MUST NEVER render on the strength of
  a row the engine has just condemned by name. The exclusion is per-row — an account MAY still show
  the card from a *different* row that carries no ad-blame signal.
- **FR-011**: The account-level card is the only place the «احجز مكالمة تشخيصية مجانية» **button**
  renders. A row-level finding carrying the discovery-call link renders at most one subtle inline
  text link per row — never a repeated full-width button.
- **FR-011a**: The account-level card's text MUST be provable from the rows that funded it, and it
  MUST NOT assert that the ads are healthy. FR-010b keeps ad-fault rows from funding the card, but a
  *neither*-class row with a measured page-conversion break still qualifies while its rungs 1–4 were
  never evaluable — so the card's qualifying conditions establish that **a funnel step is leaking**,
  never that the ads are fine. The copy states the measured leak and routes to the discovery call.

### Row presentation

- **FR-012**: Each row in the diagnosis section MUST show its level (حملة / مجموعة / إعلان) alongside
  its name, so two objects sharing a name are distinguishable.
- **FR-012a**: The observed duplicate row (`V22_Aug -_Caption 1 - عندك فكرة مشروع رائعة؟` appearing
  twice with identical verdict and identical text) MUST be investigated: two levels of the same
  object, or a genuine duplication defect. The finding is recorded in `research.md`, and fixed if it
  is a defect.

### Outcome identity

- **FR-016**: Each diagnosis line MUST carry a machine-readable identifier for which outcome or rung
  produced it, so that the summary logic (FR-010) and the presentation logic (FR-011) can distinguish
  outcomes without matching on Arabic text.

### Non-goals / invariants

- **FR-013**: The verdict pipeline is untouched. Verdict, rule, reason and action for every object are
  byte-identical before and after this change. Constitution I and VI hold: no rule reordering, no new
  verdicts, no threshold changes.
- **FR-014**: The volume gates from FR-002 are not tuned here. If the analysis suggests a threshold is
  wrong, it is recorded as a follow-up and left unchanged in this feature.
- **FR-015**: The diagnosis stays fully deterministic and rule-driven. No inference, no AI, no
  heuristic that cannot be traced to a rung or a rule code (Constitution I).

---

### Key Entities

- **Rung**: One step of the diagnosis ladder (cost-per-view, hook, message/CTA mismatch, landing-page
  arrival, page conversion, post-conversion). Each of the first five carries a volume gate and,
  optionally, a required comparison baseline.
- **Rung evaluation**: The per-object record of a single rung's state — *unevaluable* (gate or
  baseline missing), *clean* (judged, healthy), or *broken* (judged, failing). Exactly one state per
  rung per object.
- **Diagnosis outcome**: The terminal classification appended when no rung broke —
  INSUFFICIENT_DATA, AD_IS_THE_PROBLEM, NO_BLAME_ASSIGNABLE, or FUNNEL_CONFIRMED. Mutually exclusive;
  resolved in the precedence listed under *Four honest terminal outcomes*, with INSUFFICIENT_DATA also
  serving as the fall-through when FUNNEL_CONFIRMED's rung precondition is unmet. Absent when at least
  one rung broke.
- **Rule fault classification**: A total mapping from every rule code in the rulebook to exactly one
  of three buckets — ad-fault, funnel-fault, or neither. No default bucket. The single source of
  truth for the AD_IS_THE_PROBLEM, FUNNEL_CONFIRMED and NO_BLAME_ASSIGNABLE branches.
- **Finding**: One line of diagnosis on a row — its rung or outcome identity, its Arabic text, whether
  it is the primary (first) issue, and an optional discovery-call link.
- **Account funnel signal**: The account-level card asserting that the offer or funnel is the
  bottleneck, and the only place the booking button renders. Set only from confirmed funnel evidence —
  a broken page-conversion rung, a FUNNEL_CONFIRMED outcome, or a W5 campaign that cleared the FR-009b
  evidence guard.
- **W5 evidence path**: The campaign-level route into FUNNEL_CONFIRMED that bypasses the rung
  precondition. Gated on two conditions that MUST both hold — the explicit funnel-underperforming
  declaration, and a measured campaign cost per customer.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given a snapshot of five flagged rows with materially different metrics, no two rows
  produce identical diagnosis text.
- **SC-002**: Zero rows in any fixture display an innocence claim while having zero evaluated rungs.
  "Innocence claim" is defined operationally by the `BLAME_CLAIMS` substring set of
  `contracts/diagnosis-outcomes.md` §C10.2 — §C10.3 maps every criterion to its set.
- **SC-003**: Zero rows display both a 🔴 kill verdict produced by an ad-fault rule and a claim that
  the problem is not the ads — counting every line on the row, terminal outcomes and rung-level copy
  alike (FR-017). Operationally the `AD_HEALTH_CLAIMS` set of §C10.1, not `BLAME_CLAIMS`: an ad-fault
  row naming the offer is not a self-contradiction.
- **SC-003a**: No row carrying a 🔴 kill produced by an ad-fault rule contributes to the account-level
  funnel card, in any fixture.
- **SC-003b**: The account-level card's text contains no ad-health claim in any fixture, in any
  wording — operationally, none of the `AD_HEALTH_CLAIMS` strings of `contracts/diagnosis-outcomes.md`
  §C10.1. It is deliberately **not** held to the wider `BLAME_CLAIMS` set: the card is required to state
  the measured leak, so it must stay free to name the offer or the funnel.
- **SC-004**: Every FUNNEL_CONFIRMED output contains at least three distinct numeric values drawn from
  that row's own window.
- **SC-004a**: No FUNNEL_CONFIRMED output renders as unknown a step it **could have measured**. Where the
  underlying figure is present in the object's own window, the step prints it; a step is stated unavailable
  only when its own inputs are genuinely absent. This is the form that holds on both routes into the
  outcome — FR-006's rung precondition (which guarantees the arrival and conversion figures) and FR-009c's
  W5 evidence path (which does not).
- **SC-005**: The existing engine test suite and stored snapshot pass unchanged, except for entries
  that specifically encoded the old fallback string — those are updated deliberately and called out in
  the pull request.
- **SC-006**: `npm run check` reports zero TypeScript errors.
- **SC-007**: Exactly one full-width discovery-call button renders per page, regardless of how many
  rows carry funnel evidence.
- **SC-008**: An account whose flagged rows are all INSUFFICIENT_DATA or NO_BLAME_ASSIGNABLE produces no
  account-level funnel card.
- **SC-009**: For every object in every fixture, verdict, rule code, reason and action are byte-identical
  to the pre-change output.

---

## Required Test Scenarios

These land as failing tests **before** implementation.

1. **Below every gate.** Ad with 800 impressions, 12 link clicks, 0 landing-page views, kill verdict →
   exactly one finding, INSUFFICIENT_DATA shape, no discovery-call link, text does not contain the
   substring «ليست بالإعلانات».
2. **Ad-fault rule, unevaluable rungs.** Ad firing the dead-hook rule with otherwise unevaluable rungs →
   output does not absolve the ad, no discovery-call link.
3. **Confirmed page leak.** Ad with 4,200 impressions, link click-through above the account median, 85%
   landing-page arrival rate, 1.4% conversion rate → broken page-conversion finding carrying the
   discovery-call link, text contains the conversion figure.
4. **Broken page rung under an ad-fault rule.** Ad firing an ad-fault rule with rungs 1–4 unevaluable and
   the page-conversion rung broken → the page-conversion finding renders its neutral wording, contains no
   innocence claim, and still carries the discovery-call link. Its **contribution** to the account funnel
   card is governed by FR-010b and asserted by scenario 14, not here — the finding stands on the row while
   the row is excluded from the card.
5. **Fully clean, funnel-fault rule — *synthetic selector unit test*.** Ad with every rung evaluable and
   clean — including the landing-page arrival and page-conversion rungs — and a fired rule classified
   funnel-fault → FUNNEL_CONFIRMED with the full ladder and the discovery-call link.
   **This pairing is not producible by `runEngine`**: every funnel-fault code is coupled to a rung (W3
   fires on exactly the condition that breaks the page-conversion rung, W4 on the condition that breaks
   the arrival rung), so a real row firing one of them always has that rung broken and never reaches a
   terminal outcome. The fixture is constructable only because `diagnose()` receives `fired` as a
   parameter rather than re-deriving it. It exercises the **selector and the ladder builder**, not a
   reachable production state. The production route into FUNNEL_CONFIRMED is scenario 7's W5 path.
   See research §R3.3.
6. **Funnel-fault rule, conversion rungs unevaluable — *synthetic selector unit test*.** Ad firing a
   funnel-fault rule with no broken rung but an unevaluable landing-page arrival rung →
   INSUFFICIENT_DATA shape (FR-006b), no discovery-call link, no innocence claim, no contribution to the
   account funnel card. **Synthetic for the same reason as scenario 5** — it pins the Q3 boundary in the
   selector so that a future funnel-fault code decoupled from the rung ladder inherits the correct
   behaviour, rather than asserting a state today's rule set can reach.
7. **W5 with complete evidence — the production FUNNEL_CONFIRMED path.** Campaign firing W5 with the
   funnel-underperforming flag set and a measured cost per customer → FUNNEL_CONFIRMED, exactly one funnel
   line, the cost-per-customer figure present in its text, one discovery-call link, and a contribution to
   the account funnel card. **This scenario carries SC-004 and SC-004a**, because it is the only route a
   real row can take into the outcome: assert at least three distinct numeric values drawn from the
   campaign's own window (SC-004), and assert that every ladder step whose figure is present in that
   window is printed rather than stated unknown (SC-004a), with only the genuinely absent steps of
   FR-009c stated unavailable.
8. **W5 with incomplete evidence.** Campaign firing W5 with the flag set but no measured cost per
   customer → INSUFFICIENT_DATA (FR-009b), no discovery-call link, no account funnel card contribution.
9. **Cost-driven rule, clean rungs.** Ad firing a cost-only rule (classified *neither*) with at least one
   rung evaluable and none broken → NO_BLAME_ASSIGNABLE shape, no discovery-call link, text contains
   neither an innocence claim nor an offer/funnel claim.
10. **Non-sales exemption.** Exempt object on the NS1 / NS2 path → empty findings list, unchanged from
   Spec 013.
11. **Distinctness.** Mixed snapshot of five flagged rows → assert pairwise distinctness of the diagnosis
   text (SC-001).
12. **Account CTA suppression.** Summary built from rows that are all INSUFFICIENT_DATA → no account-level
   funnel card.
13. **Verdict invariance.** Full-engine run over the existing fixtures → verdict, rule, reason and action
   identical to the pre-change baseline (SC-009).
14. **Ad-fault row excluded from the account card.** Row with an ad-fault rule fired, rungs 1–4 unevaluable
   and the page-conversion rung broken → the row's page-conversion finding stands with its discovery-call
   link, but that row contributes nothing to the account-level card; adding a second row carrying a clean
   funnel signal brings the card back (FR-010b, SC-003a).
15. **No innocence without evaluation, swept.** Full-engine run over every fixture → no row with zero
   evaluable rungs carries an innocence claim on any line (SC-002).
16. **No self-contradiction, swept.** Full-engine run over every fixture → no row with a 🔴 kill from an
   ad-fault rule carries a not-the-ads claim on any line, terminal outcomes and rung copy alike (SC-003).
17. **Account card claims no ad health.** Account whose only funnel evidence is a *neither*-class row with a
   broken page-conversion rung → the card renders, and its text contains none of the `AD_HEALTH_CLAIMS`
   strings (FR-011a, SC-003b, contract C10.1).
18. **Selector purity.** For each of the four terminal outcomes, re-run the diagnosis with the fired rule's
   Arabic reason and action replaced by arbitrary strings — including one containing every banned
   substring → the selected outcome and the presence of the discovery-call link are identical across every
   run, and the fired result is not mutated. Proves the selection reads no Arabic copy (FR-015,
   Constitution I).

---

## Deliverables

`spec.md` (this document), `plan.md` with the Constitution Check table filled per principle,
`research.md`, `data-model.md` (the finding-shape change and the outcome enumeration),
`contracts/diagnosis-outcomes.md`, and `tasks.md` phased so the tests land before the implementation.

---

## Assumptions

- **A1** — The four outcomes are appended only when **no** rung broke. When at least one rung broke, the
  broken rungs are the diagnosis and no terminal outcome is added; this preserves today's behaviour for
  that case.
- **A2** — "Zero rungs evaluable" counts rungs 1 through 5. Rung 6 is the terminal position itself and is
  never independently evaluable.
- **A3** — The stored engine snapshot currently contains no entry encoding the old fallback string (it
  locks target derivation, not findings), so SC-005 is expected to hold with no snapshot edit. If any
  entry does change, it is called out in the pull request rather than silently re-recorded.
- **A4** — The non-sales exemption hard-skip is evaluated at the call site, before the ladder runs, and
  stays there. Exempt objects never reach any of the four outcomes.
- **A5** — The discovery-call destination is unchanged: <https://eslamsalah.com/team-discovery-call>.
- **A6** — INSUFFICIENT_DATA text states the gate that is furthest from being met, not all five gates, so
  the advertiser reads one actionable number rather than a table.
- **A7** — Diagnosis still runs only for objects whose verdict is 🔴 kill or 🟡 watch, as today. Rows with
  other verdicts continue to carry an empty findings list.

---

## Clarifications Needed

### Q1 — Is a two-way ad-fault split sufficient?

**Context**: FR-005 fires AD_IS_THE_PROBLEM when the fired rule "belongs to the ad-fault set", and FR-006
fires FUNNEL_CONFIRMED — the innocence claim plus the booking button — when it does not. That makes
*not-ad-fault* mean *funnel-fault by default*.

Several rule codes are neither. A rule that fires because the cost per customer is far above target
(persistent loss), because today's spend produced nothing (circuit breaker), because the cost is
*slightly* above target, or because a single bad day followed good ones, says nothing about whether the
creative or the offer is at fault. Under a two-way split, every one of those rows would receive the
innocence claim and the booking button on the strength of one clean rung — which is the same unfounded
confidence this feature exists to remove.

**What we need to know**: Does the classification stay binary, or does it gain a third "neither" bucket
with its own honest outcome?

| Option | Answer | Implications |
|--------|--------|--------------|
| A | Three-way: ad-fault / funnel-fault / neither. A "neither" rule with no broken rung falls back to INSUFFICIENT_DATA-style honesty — it states what was measured and declines to place blame. | Most conservative. Adds a fourth terminal state in practice, so `contracts/diagnosis-outcomes.md` and the data model grow one branch. Fewest false innocence claims. |
| B | Binary, defaulting to not-ad-fault. Any rule not explicitly ad-fault permits FUNNEL_CONFIRMED. | Matches the FR text literally and is the smallest change. Risks re-introducing an unearned innocence claim for cost-driven and circuit-breaker rules. |
| C | Binary, defaulting to ad-fault. Only rules that explicitly exonerate the ad (the page/funnel/post-sale codes) permit FUNNEL_CONFIRMED. | Never over-claims innocence, and the booking button becomes rare. Risks under-serving Constitution VII by suppressing a genuine funnel outcome. |
| Custom | Provide your own answer | Name the exact bucket per code, or name the default. |

**Your choice**: **A — Three-way: ad-fault / funnel-fault / neither.** Resolved 2026-08-26. Encoded in
FR-006, FR-006a and FR-008; the *neither* bucket resolves to the NO_BLAME_ASSIGNABLE outcome.

---

### Q2 — Does SC-003 reach the page-conversion rung's own innocence wording?

**Context**: The page-conversion rung already emits «⚠️ الإعلان بريء، لا تعدّله» when it breaks and no
earlier rung fired. That is an innocence claim, and it lives *inside* a broken rung — so no terminal
outcome is appended and FR-005 never runs. If an ad-fault rule produced the verdict while rungs 1–4 were
unevaluable and rung 5 broke, the row shows a 🔴 kill from an ad-fault rule next to «الإعلان بريء».
SC-003 says zero rows may show both.

**What we need to know**: Is that wording in scope for suppression, or is SC-003 scoped only to the
terminal outcomes?

| Option | Answer | Implications |
|--------|--------|--------------|
| A | In scope. The page-conversion rung's innocence wording is suppressed (falling back to its neutral "review the page too" wording) whenever the fired rule is ad-fault. | SC-003 becomes literally true. Touches an existing rung's copy, so its own tests need review. |
| B | Out of scope. SC-003 governs only the three terminal outcomes; the rung keeps today's wording. | Smallest blast radius; leaves a narrow but real contradiction on screen. |
| C | In scope, and strengthened: the rung's innocence wording additionally requires that the earlier rungs were *evaluated and clean*, not merely "did not fire". | Fixes both the ad-fault contradiction and the same absence-of-evidence bug one rung lower. Largest change to existing rung behaviour. |
| Custom | Provide your own answer | |

**Your choice**: **C — In scope, and strengthened.** Resolved 2026-08-26. Encoded in FR-017, FR-017a
and FR-017b; SC-003 is scoped to every line on the row.

---

### Q3 — What does FUNNEL_CONFIRMED require, minimally?

**Context**: FR-006 fires on "at least one rung evaluable, none broke". But FR-007 demands a four-step
funnel ladder and SC-004 demands three distinct figures — and the landing-page and conversion figures
come from precisely the rungs that a low-volume object cannot evaluate. An object whose only evaluable
rung is the cost-per-view rung satisfies FR-006 while being unable to satisfy FR-007.

**What we need to know**: Does the innocence claim require the conversion-relevant rungs specifically?

| Option | Answer | Implications |
|--------|--------|--------------|
| A | Require the landing-page arrival **and** page-conversion rungs to be evaluable and clean. Anything less resolves to INSUFFICIENT_DATA. | FR-007's ladder is always fully renderable and SC-004 is always satisfiable. The innocence claim becomes strictly earned; the booking button appears less often. |
| B | Keep "at least one rung", and let FR-007a print "not enough data yet" for the missing steps. | Matches the FR text literally. Produces a ladder that claims innocence while three of its four steps say "unknown". |
| C | Require the page-conversion rung only (the rung that actually measures the funnel), with the arrival step rendered as unknown when unevaluable. | Middle ground: the conclusion is always backed by a real conversion figure; the ladder may be partially unknown above it. |
| Custom | Provide your own answer | |

**Your choice**: **A — Require the landing-page arrival and page-conversion rungs to be evaluable and
clean.** Resolved 2026-08-26. Encoded in FR-006, FR-006b, FR-007a and SC-004a.

---

### Q4 — Does campaign-level W5 satisfy FUNNEL_CONFIRMED on its own evidence?

**Context**: Raised during `/speckit-clarify` after Q3 was answered. W5 fires from a measured campaign
cost per customer plus the account's explicit funnel-underperforming declaration — evidence that does
not come from the rung ladder at all. FR-006b now sends a funnel-fault rule with unevaluable
arrival/conversion rungs to INSUFFICIENT_DATA, which would strip the CTA from exactly the campaigns
W5 exists to catch, while FR-010 still names W5 as confirmed funnel evidence.

**What we need to know**: Is W5 exempt from FR-006's rung precondition, and if so, on what terms?

| Option | Answer | Implications |
|--------|--------|--------------|
| A | W5 is its own evidence path into FUNNEL_CONFIRMED, satisfied by the measured CPA plus the explicit funnel flag rather than the rung precondition. | Keeps FR-010's W5 clause and Constitution VII intact. Requires the line to carry the CPA figure so it is not a bare claim. |
| B | No exemption — W5 obeys FR-006b like any funnel-fault rule. | Maximum consistency; in low-volume accounts it removes the W5 CTA almost everywhere and requires striking W5 from FR-010. |
| C | W5 keeps a distinct fifth outcome. | Reintroduces the unclassified extra fallback FR-009a exists to eliminate. |

**Your choice**: **A, with a conditional guard.** Resolved 2026-08-26. The W5 evidence path opens
FUNNEL_CONFIRMED only when **both** the explicit funnel-underperforming flag is set **and** a measured
campaign cost per customer exists. Absent either, the campaign resolves to INSUFFICIENT_DATA like any
other row. The exemption must never open on the mere absence of an ad-fault rule — that would
reintroduce, one level up at the campaign, the binary-default problem rejected in Q1. Encoded in
FR-009a, FR-009b, FR-009c and FR-010.

---

## Dependencies

- Spec 013 (verdict accuracy fixes) — the non-sales exemption hard-skip must remain byte-identical.
- The rulebook (محرك القرار الإعلاني v2.1) is the source for the FR-008 classification; no code is
  reclassified against its rulebook definition.
- No schema change, no new external data, no additional Meta API fields. Every figure the funnel ladder
  needs is already present in the cached snapshot (Constitution V).
