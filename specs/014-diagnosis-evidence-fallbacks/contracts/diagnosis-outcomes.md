# Contract: Diagnosis Outcomes

**Feature**: [../spec.md](../spec.md) · **Plan**: [../plan.md](../plan.md) ·
**Data model**: [../data-model.md](../data-model.md) · **Research**: [../research.md](../research.md)

This is the normative contract for `diagnose()` after Spec 014. Where this document and prose
elsewhere disagree, this document governs the implementation. Clause IDs (C1..C9) are stable and are
cited by `tasks.md` and by the test names. (The range is C1..C10; the "C1..C9" in earlier drafts
predates C10.)

**Interface under contract**

```
diagnose(
  o: NormalizedObject,
  baselines: Baselines,
  archetype: FunnelInputs["archetype"],
  fired: RuleResult,                        // NEW — FR-009
  htoUnderperforming: boolean = false,      // NEW — C4.2 condition 1, per C4.2a
): Finding[]
```

---

## C1 — Rung evaluation (FR-001, FR-003, FR-003a)

**C1.1** — Before any finding is produced, `diagnose()` MUST build a `RungEvaluation` assigning each
of rungs 1–5 exactly one of `unevaluable` / `clean` / `broken`, per the table in
[research.md §R2](../research.md).

**C1.2** — `unevaluable` MUST NOT be counted as `clean` anywhere, in any derived set, at any layer.
This is the invariant the whole feature rests on.

**C1.3** — All thresholds MUST be read from the exported `DIAGNOSIS_GATES` constant
([research.md §R1](../research.md)). No numeric literal for a gate or a break threshold may remain
inline in `diagnose()`. Values MUST equal today's values exactly (FR-002, FR-014).

**C1.4** — Rung 1 is `unevaluable` when `baselines.cpmAvg14` is null or zero, even if the impression
gate is met (FR-003a). Rung 2 is NOT subject to this: its `1.0` literal fallback keeps it evaluable
without a median.

**C1.5** — Rung 4 is `unevaluable` when `lpViews === 0`, including when `linkClicks >= 50`. It is
neither `clean` (today's silent skip, the reported defect) nor `broken` (which would assert an
unobservable mechanism). Rationale: [research.md §R2.2](../research.md).

**C1.6** — Broken rungs produce their findings in ascending rung order, exactly as today, each
carrying the matching `RUNG_*` outcome. Rung copy other than rung 5's (see C8) is unchanged.

---

## C2 — Terminal outcome selection (FR-004, FR-005, FR-006, FR-006a, FR-006b)

**C2.1** — A terminal outcome is appended **only** when `broken.size === 0`. When any rung broke, the
broken rungs are the diagnosis and no terminal outcome is added (spec A1). This preserves today's
behaviour for that case.

**C2.2** — When `broken.size === 0`, exactly one terminal outcome is selected, by this precedence.
The first matching clause wins; the list is exhaustive.

| # | Condition | Outcome |
|---|-----------|---------|
| 1 | `evaluable.size === 0` | `INSUFFICIENT_DATA` |
| 2 | `RULE_FAULT[fired.rule] === "ad-fault"` | `AD_IS_THE_PROBLEM` |
| 3 | `RULE_FAULT[fired.rule] === "neither"` | `NO_BLAME_ASSIGNABLE` |
| 4 | `RULE_FAULT[fired.rule] === "funnel-fault"` **and** rung 4 is `clean` **and** rung 5 is `clean` | `FUNNEL_CONFIRMED` |
| 5 | `RULE_FAULT[fired.rule] === "funnel-fault"` and clause 4's rung precondition is unmet | `INSUFFICIENT_DATA` |
| — | campaign W5 override | see C4 |

**C2.3** — The four terminal outcomes are mutually exclusive. Clauses 2, 3 and 4 are disjoint because
`RuleFaultClass` is a three-way total partition with no default (FR-008, FR-008a). The partition itself
— the three bucket definitions and the assignment of all 24 codes — is normative in
[research.md §R3](../research.md) per FR-008, and this contract consumes it without redefining it. A
code is ad-fault only where its own rulebook definition **names** the creative, the hook, or the ad
unit; an ad-side failure being one possible upstream cause of the measured quantity is not sufficient
(FR-008, research §R3.3).

**C2.4** — `INSUFFICIENT_DATA` appears at both ends of the precedence (clauses 1 and 5). This is
deliberate: "we could not judge the ladder" is one honest statement whether nothing was measured or
only the wrong things were. It is one outcome, not two.

**C2.6 — Clauses 4 and 5 are retained deliberately (I4).** Every funnel-fault code in today's
vocabulary is coupled to a rung — W3 fires on exactly the condition that makes rung 5 `broken`
(`server/engine.ts:617-637` vs `846-856`), W4 on a condition byte-identical to rung 4's
(`639-647` vs `833-840`) — and W5 enters through C4, not through clause 4. Combined with C2.1, **no row
`runEngine` can produce reaches clause 4 or clause 5.** They MUST NOT be deleted: they keep the
three-way partition total (FR-008a) and they are the landing spot for a future funnel-fault code that is
decoupled from the ladder, which would otherwise fall through the selector unhandled. Required scenarios
5 and 6 pin their behaviour as synthetic selector unit tests — see research §R3.3.

**C2.5** — Selection MUST be a pure function of `(RungEvaluation, RULE_FAULT[fired.rule])` plus the
C4 W5 inputs. No other input, and specifically no inspection of `fired.reason_ar` or any Arabic
string, may influence it (Constitution I, FR-015).

---

## C3 — Outcome text obligations (FR-004, FR-005, FR-006a, FR-007, FR-007a)

Each terminal outcome's copy is simple Arabic at the register of today's rung copy (Constitution
III). The obligations below are what tests assert; exact wording is an implementation choice within
them.

### C3.1 — `INSUFFICIENT_DATA`

- MUST state the counts actually observed (impressions, link clicks, landing-page views).
- MUST state the volume still needed. Per spec A6 it names **the single gate furthest from being
  met**, not all five, so the reader gets one actionable number rather than a table.
- MUST NOT carry `ctaUrl`.
- MUST NOT contain any claim about where the problem is or is not, in any wording — operationally, none
  of the `BLAME_CLAIMS` strings of C10.2.

### C3.2 — `AD_IS_THE_PROBLEM`

- MUST restate the fired rule's reasoning and point the user at the ad.
- MUST derive that restatement from the **rule code** via a code-keyed copy map — never by echoing
  `fired.reason_ar` verbatim (which would couple the diagnosis to verdict copy) and never by printing
  the code itself (Constitution II).
- MUST NOT carry `ctaUrl`.
- MUST NOT claim the ad is innocent in any wording — operationally, none of the `AD_HEALTH_CLAIMS`
  strings of C10.1.

### C3.3 — `NO_BLAME_ASSIGNABLE`

- MUST state what was measured and came back healthy, and MUST stop there.
- MUST NOT carry `ctaUrl`.
- MUST NOT claim the ad is innocent, and MUST NOT claim the problem lies in the offer or the funnel —
  operationally, none of the `BLAME_CLAIMS` strings of C10.2. This outcome exists precisely because
  neither is known.

### C3.4 — `FUNNEL_CONFIRMED`

- MUST be an ordered funnel ladder, in this order, conclusion last (FR-007):
  1. impressions
  2. link clicks, with the account median link CTR shown for comparison
  3. landing-page views as a percentage of link clicks
  4. conversions as a percentage of landing-page views
  5. the conclusion — the leak is in the offer or the funnel
- MUST contain at least three distinct numeric values, every one drawn from that object's own window
  (SC-004).
- MUST carry `ctaUrl`. It is the only terminal outcome that does.
- **Step availability (SC-004a)** — a step whose figure is present in the object's own window MUST be
  printed; a step MUST be stated unavailable only when its own inputs are genuinely absent. On the
  clause-4 route, C2.2 clause 4's rung precondition guarantees steps 3 and 4 are always available. On
  the C4 W5 route there is no such guarantee, and C4.4 enumerates what a campaign can and cannot
  measure. SC-004a holds on both routes in this form: **never state unknown about a step you could see.**
- **C3.4a (FR-007a)** — on the clause-4 route the one figure that may be missing is the account median
  link CTR at step 2. When `baselines.ctrLinkMedian90` is null the ladder MUST say the account median is
  unavailable for that comparison. It MUST NOT print `0`, MUST NOT print the `1.0` internal fallback as
  if it were the account's median, and MUST NOT omit the step silently.

---

## C4 — The campaign W5 evidence path (FR-009a, FR-009b, FR-009c)

**C4.1** — W5 is classified `funnel-fault` ([research.md §R3.2](../research.md)) and reaches
`FUNNEL_CONFIRMED` through its **own evidence** — the measured campaign cost per customer together
with the account's explicit funnel-underperforming declaration — rather than through C2.2 clause 4's
rung precondition, which the rung ladder cannot satisfy at campaign level.

**C4.2 — The guard (FR-009b).** The W5 evidence path opens **only** when **both** hold:

1. the explicit funnel-underperforming flag is set for the account (`funnel.htoUnderperforming`), and
2. a measured campaign cost per customer exists — non-null, derived from real conversions in the
   window.

Where **either** is absent, the campaign resolves through the ordinary C2.2 precedence, which for a
funnel-fault rule with unevaluable conversion rungs means `INSUFFICIENT_DATA` (clause 5), with no
`ctaUrl`.

**C4.2a — How each condition is read (normative).** Both conditions were previously read through
proxies that did not carry the information they were assumed to carry. Both are now pinned:

| Condition | MUST be read as | MUST NOT be read as |
|-----------|-----------------|---------------------|
| 1 — the funnel flag | An **explicit parameter** on `diagnose()`, supplied by the caller from `funnel.htoUnderperforming`. It defaults to `false`, so the path fails closed for any caller that does not state it | `fired.ctaUrl`, or any other field of `Fired`. `evaluateCampaign` attaches the discovery CTA to **every** W5 `Fired` it returns, so that check is structurally always true and enforces nothing |
| 2 — the cost per customer | **`effectiveCpa(o, archetype)`** — the archetype-aware selector, so `appointment` / `webinar` are judged on cost-per-**lead**, the same judgement unit W5's own firing condition uses (T025) | `o.w3d.cpa`, the legacy cost-per-**purchase** field. It is null for exactly the archetypes whose purchase happens off-platform, so reading it denies the evidence path to the campaigns T025 exists to protect |

The unit is pinned here so it cannot drift back: **condition 2 is a cost per customer in the
archetype's own judgement unit**, not a cost per purchase.

**C4.3** — The exemption MUST NEVER open on the mere absence of an ad-fault rule. That is the
binary-default failure mode rejected in clarification Q1, and C4.2's two-condition guard is what
prevents it appearing one level up at the campaign.

**C4.3a — How C4.3 MUST be tested.** The guard's **closed** state MUST be exercised by calling
`diagnose()` directly with a W5 `Fired`, not by driving `runEngine`. W5's own firing condition
already requires the funnel flag and a measured CPA, so any `runEngine` fixture that closes the
guard also stops W5 from firing — such a test passes because `diagnose()` never saw a W5 at all,
which is no evidence about the guard. The fixture MUST hold rungs 4 and 5 **unevaluable**, so that
C2.2 clause 4 cannot match and `FUNNEL_CONFIRMED` is reachable only through C4; and it MUST include
an **open control** differing only in the guard's inputs, so the closed cases are demonstrably
attributable to the guard.

**C4.4 (FR-009c)** — The `FUNNEL_CONFIRMED` line produced by the W5 path MUST carry the measured
cost-per-customer figure, so the claim is provable from the campaign's own numbers.

**What a campaign can measure — the enumeration (U1).** Campaign-level insights are fetched from the
same endpoint and parsed by the same `parseInsightsRow` as ad-level insights
(`server/meta.ts:385-415`, `/insights` with `level: "campaign"`), so a campaign's `w3d` carries the
identical `WindowMetrics` shape. Per ladder step:

| Ladder step | Campaign-level availability | Rule |
|-------------|-----------------------------|------|
| 1 — impressions | **Always available** — `w3d.impressions` is populated at every level | MUST be printed |
| 2 — link clicks | **Available** — `w3d.linkClicks` is populated at every level | MUST be printed |
| 2 — account median link CTR (the comparison) | **Never a like-for-like figure.** `baselines.ctrLinkMedian90` is fetched with `level: "ad"` (`server/meta.ts:1320-1340`) — a median over ad-days. Comparing a campaign aggregate against it is not a valid comparison | MUST be stated unavailable **for a campaign**, in the C3.4a form, whether or not the baseline is null |
| 3 — landing-page views as a share of link clicks | **Available when `lpViews > 0`**; `lpViews === 0` against real clicks is the untracked case of research §R2.2 | Printed when available; stated unavailable when `lpViews === 0` |
| 4 — conversions as a share of landing-page views | **Available when `lpViews > 0`** — the denominator is step 3's numerator | Printed when available; stated unavailable when `lpViews === 0`. The numerator MUST be the archetype's own unit — see C4.4a |
| 5 — conclusion + measured cost per customer | **Always available on this path** — C4.2 condition 2 makes a measured campaign CPA a precondition for opening it at all | MUST be printed (FR-009c) |

So the W5 line always carries at least two figures (impressions, link clicks) plus the cost per customer
that C4.2 guarantees — three distinct values, satisfying SC-004 without relying on `lpViews`. Steps 3
and 4 join them whenever the campaign tracks landing-page views.

Steps stated unavailable use the C3.4a form — never a `0`, never a silent omission, and never the `1.0`
internal fallback presented as the account's median. Because a campaign can measure more than the
original text assumed, SC-004a binds here in its rescoped form: **only the steps enumerated as
unavailable above may be stated unknown.** Any step whose figure is present MUST be printed.

**C4.4a — The ladder's figures MUST be computed with the same archetype the rung evaluation used.**
This binds both `FUNNEL_CONFIRMED` routes, not only the W5 one. Rung 5 counts
`leadConversions` for `appointment` / `webinar` and `conversions` otherwise; step 4 of the ladder
MUST use that same selector. An `appointment` campaign whose rung 5 is `clean` on 50 leads and whose
ladder prints `0.0%` from zero purchases states a number that contradicts the evidence licensing the
claim — the precise dishonesty this feature exists to remove, relocated into the copy layer. The
archetype is therefore a **required** argument to the ladder builder, never defaulted and never
assumed to be `paid_lto`.

*Known follow-on, out of scope here:* step 4's verb is «اشتروا» ("bought") on every archetype, and
rung 5's own broken-wording at `server/engine.ts:~1200` says «يشترون» likewise. For an
appointment/webinar account the counted unit is a booked lead, not a purchase. The **figure** is now
correct on every archetype; the **noun** is not. Changing it alters existing rung-5 finding copy and
belongs in its own change.

**C4.5** — Exactly one funnel line per row. The original campaign block
(`server/engine.ts:~1451-1466`) appended a second step-6 finding when `diagnose()` did not already
produce one, and patched `ctaUrl` onto an existing step-6 when it did. Both halves are replaced: the
W5 evidence is passed **into** `diagnose()` so the outcome selector produces the single correct
finding, and the post-hoc patching is deleted. A row MUST NOT carry two findings whose outcome is a
terminal member (data-model V8).

"Passed into `diagnose()`" means the two C4.2 conditions, per C4.2a — the flag as its own argument
and the CPA re-derived inside the selector from `effectiveCpa`. The call site MUST NOT rebuild the
`Fired` to signal the guard; a `Fired` that already carries `ctaUrl` from `evaluateCampaign` conveys
nothing, and a hand-built one is indistinguishable from the rule's own output.

---

## C5 — Arabic and numeral rendering (Constitution III, FR-007)

**C5.1** — All outcome copy is simple Modern Standard Arabic at 6th-grade reading level. No jargon,
no marketing-speak.

**C5.2** — Every numeric value in every outcome renders left-to-right inside the RTL layout, via the
existing `.num` mechanism used by the current rung copy. This is load-bearing for `FUNNEL_CONFIRMED`,
which is the densest numeric string the product prints.

**C5.3** — Currency figures go through the engine's existing `money()` helper bound to the account
currency, as today.

---

## C6 — The account funnel card (FR-010, FR-010a, FR-010b, FR-011, FR-011a)

**C6.1** — `summary.account_funnel_cta` is set when **any** row satisfies one of the conditions below
**and** passes the C6.1a ad-blame exclusion:

- a `RUNG_CONVERSION` finding; **or**
- a `FUNNEL_CONFIRMED` finding — which by C4 already covers every W5 campaign that cleared the guard.

**C6.1a — ad-blame exclusion (FR-010b).** A row is excluded from C6.1 when **either**:

1. it carries a finding whose outcome is `RUNG_CPM`, `RUNG_HOOK`, `RUNG_MISMATCH` or `RUNG_ARRIVAL`
   (today's "no earlier issue" condition, now expressed structurally); **or**
2. `RULE_FAULT[row.rule] === "ad-fault"`.

Condition 2 is what stops the C8 case — ad-fault rule, rungs 1–4 unevaluable, rung 5 broken — from
setting an account card that reads «مؤشرات إعلاناتك جيدة» beside a 🔴 the engine just issued
against the ad. Condition 1 alone does not catch it, because unevaluable rungs produce no findings.

The exclusion is per-row. An account MAY still set the card from a different, unexcluded row.

**C6.2** — It is `null` otherwise, even when flagged rows exist (FR-010a). Rows whose only finding is
`INSUFFICIENT_DATA` or `NO_BLAME_ASSIGNABLE` contribute nothing.

**C6.4 — Card copy (FR-011a).** The card's `reason_ar` MUST NOT contain an ad-health claim — defined
operationally as the `AD_HEALTH_CLAIMS` set of C10.1, **not** the wider `BLAME_CLAIMS` set, because the
card is required to state the measured leak and must stay free to name the offer or the funnel. C6.1's
qualifying conditions establish that *a funnel step is leaking*; they do not establish that the ads
are fine, because a qualifying row's rungs 1–4 may all have been unevaluable. C6.1a removes the
ad-fault rows, but not the *neither*-class ones. The copy therefore states the measured leak and
routes to the discovery call, and asserts nothing about the ads.

**C6.3** — The predicate MUST read `f.outcome`. It MUST NOT match on `text_ar`, and the existing
`rows.some(r => r.rule === "W5")` scan is removed — C4 makes it redundant, and leaving it would let a
guard-failing W5 campaign set the card, defeating C4.2.

---

## C7 — Row presentation (FR-011, FR-012)

**C7.1** — The full-width «احجز مكالمة تشخيصية مجانية» `<Button>` renders in exactly one place: the
account-level card. Exactly one per page, regardless of how many rows carry funnel evidence (SC-007).

**C7.2** — A row-level finding carrying `ctaUrl` renders at most **one subtle inline text link** —
never a repeated full-width button. `FindingRow` in `client/src/pages/Dashboard.tsx` changes
accordingly.

**C7.3** — Each row in the diagnosis section shows its level alongside its name: حملة / مجموعة /
إعلان, mapped from the existing `EngineRow.level`. No new data is required (FR-012).

---

## C8 — Rung-5 innocence suppression (FR-017, FR-017a, FR-017b)

**C8.1** — Rung 5's innocence wording («⚠️ الإعلان بريء، لا تعدّله») is selected only when **both**
hold:

1. `RULE_FAULT[fired.rule] !== "ad-fault"` (FR-017), **and**
2. rungs 1–4 are **all** `clean` — measured and healthy, not merely non-firing (FR-017a).

Otherwise rung 5 renders its neutral wording, which reports the weak page conversion without
absolving the ad.

**C8.2** — Condition 2 is the D1 correction one rung lower. Today the selector is
`findings.length === 0`, which is true when rungs 1–4 were never *measured*.

**C8.3 (FR-017b)** — The wording choice does not change the finding's standing. `RUNG_CONVERSION`
keeps its `ctaUrl` and its standing **on the row** in both wordings, because the conversion figure that
produced it was genuinely measured. Suppressing the claim does not suppress the finding.

Its **contribution** to the account card is a separate question and remains subject to C6.1a: where the
neutral wording was selected because the fired rule is ad-fault, that same rule excludes the row from
C6.1 entirely. The finding stands; the row does not fund the card. `data-model.md` V18 is the source of
truth for this split, and required scenarios 4 and 14 assert the two halves on the same fixture — 4 that
the finding stands, 14 that the row contributes nothing.

---

## C9 — Invariants under test

**C9.1 — Verdict invariance (FR-013, SC-009).** For every object in every fixture, `verdict`, `rule`,
`reason_ar` and `action_ar` are byte-identical to the pre-change output. `diagnose()` receives
`fired` as a **read-only** input and MUST NOT mutate it.

**C9.2 — No new verdict vocabulary (Constitution VI).** `DiagnosisOutcome` never appears in
`EngineRow.verdict`, is never rendered as text or badge, and is read by the UI only to decide link
placement.

**C9.3 — Exempt objects unchanged (FR-009, spec A4).** Non-sales exempt objects are hard-skipped at
the call site and still receive `findings: []`. They never reach `diagnose()` and never reach any of
the four outcomes. `server/nonSalesContainment.test.ts` must stay green unmodified.

**C9.4 — No innocence without evaluation (SC-002).** Zero rows in any fixture display any
`BLAME_CLAIMS` string (C10.2) while having zero evaluated rungs.

**C9.5 — No self-contradiction (SC-003).** Zero rows display both a 🔴 kill verdict produced by an
ad-fault rule and any `AD_HEALTH_CLAIMS` string (C10.1) — counting **every** line on the row,
terminal outcomes and rung-level copy alike.

**C9.6 — Distinctness (SC-001).** Given five flagged rows with materially different metrics, no two
produce identical diagnosis text.

**C9.7 — CTA placement (SC-007).** Exactly one full-width discovery-call button per page.

**C9.8 — `ctaUrl` discipline (data-model V10).** `ctaUrl` appears only on findings whose outcome is
`FUNNEL_CONFIRMED` or `RUNG_CONVERSION`. Any other combination fails the contract.

**C9.9 — Classification totality (FR-008a).** Every member of the `RuleCode` union has exactly one
`RuleFaultClass`. Asserted at compile time by the `Record` type and again at runtime by iterating the
`RULES` keys, so a future rule code cannot be added without being classified.

**C9.10 — No ad-blame row funds the account card (FR-010b).** No row whose fired rule is classified
ad-fault contributes to `summary.account_funnel_cta`, even when that row's page-conversion rung broke
and its finding legitimately stands on the row (C8.3, FR-017b).

**C9.11 — The account card claims no ad health (FR-011a).** `summary.account_funnel_cta.reason_ar`
contains none of the `AD_HEALTH_CLAIMS` strings (C10.1) in any fixture (SC-003b).

---

## C10 — Copy denylists, the operational definition (A1)

"Contains no innocence claim / no ad-health claim, in any wording" is not decidable by inspection. These
two substring sets **are** the operational definition: a test asserts the absence of every string in the
applicable set, and any copy that avoids them satisfies the obligation. Both sets are exported as named
constants from the test file so C6.4, C9.4, C9.5 and C9.11 assert the *same* strings, and a future
rewording is a one-line change in one place.

**C10.1 — `AD_HEALTH_CLAIMS`** — assertions that the ads are fine. Three strings:

| # | String |
|---|--------|
| 1 | «مؤشرات إعلاناتك جيدة» |
| 2 | «الإعلان بريء» |
| 3 | «ليست بالإعلانات» |

**C10.2 — `BLAME_CLAIMS`** — `AD_HEALTH_CLAIMS` plus any assertion of *where* the problem is. Four
strings: the three above, plus «المشكلة في العرض».

**C10.3 — Which clause uses which set.** The distinction is load-bearing: the account card is *required*
to state the measured leak, so it must be free to name the offer or the funnel — it may not use
`BLAME_CLAIMS` as its denylist without contradicting C6.4's own mandate.

| Clause / requirement | Set | Rationale |
|----------------------|-----|-----------|
| C3.1 — `INSUFFICIENT_DATA` (FR-004) | `BLAME_CLAIMS` | MUST NOT claim where the problem is **or is not** |
| C3.3 — `NO_BLAME_ASSIGNABLE` (FR-006a) | `BLAME_CLAIMS` | MUST claim neither innocence nor an offer/funnel fault |
| C3.2 — `AD_IS_THE_PROBLEM` (FR-005) | `AD_HEALTH_CLAIMS` | MUST NOT absolve the ad; it is free to name the ad as the fault |
| C6.4 / C9.11 — the account card (FR-011a) | `AD_HEALTH_CLAIMS` | MUST NOT assert the ads are fine, but MUST state the measured leak |
| C9.4 — no innocence without evaluation (SC-002) | `BLAME_CLAIMS` | A row with zero evaluable rungs may assert nothing about any party |
| C9.5 — no self-contradiction (SC-003) | `AD_HEALTH_CLAIMS` | The banned pairing is a 🔴 from an ad-fault rule beside a not-the-ads claim |

**C10.4** — These are substring matches against `finding.text_ar` and
`summary.account_funnel_cta.reason_ar`, applied across **every** line on the row, not only the terminal
one (C9.5).

---

## Traceability

| Clause | Requirements | Required test scenario |
|--------|--------------|------------------------|
| C1 | FR-001, FR-002, FR-003, FR-003a, FR-014 | 1, 6 |
| C2 | FR-004, FR-005, FR-006, FR-006a, FR-006b, FR-008, FR-008a | 1, 2, 5, 6, 9, 18 |
| C3 | FR-004, FR-005, FR-006a, FR-007, FR-007a | 1, 2, 5, 9 |
| C4 | FR-009a, FR-009b, FR-009c | 7, 7b, 8, 8b |
| C5 | Constitution III | 5, 7 |
| C6 | FR-010, FR-010a, FR-010b, FR-011a | 12, 14, 17 |
| C7 | FR-011, FR-012, FR-012a | 12 |
| C8 | FR-017, FR-017a, FR-017b | 4, 14 |
| C9 | FR-013, FR-015, FR-016, SC-001..SC-009, SC-003a, SC-003b | 3, 10, 11, 13, 14, 15, 16, 17, 18 |
| C10 | FR-004, FR-005, FR-006a, FR-011a (operational definition for SC-002, SC-003, SC-003b) | 1, 2, 9, 15, 16, 17 |

**Route coverage for `FUNNEL_CONFIRMED`** — the two routes are asserted separately, and only one of
them is reachable in production:

| Route | Clause | Scenario | Status |
|-------|--------|----------|--------|
| Rung precondition | C2.2 clause 4 | 5, 6 | Synthetic selector unit tests — unreachable via `runEngine` per C2.6 |
| W5 evidence | C4.2 | 7, 7b, 8, 8b | **The production route.** Scenario 7 carries SC-004 and SC-004a; 7b pins C4.4a; 8 exercises the guard's closed state per C4.3a |
