# Quickstart: Diagnosis Evidence & Honest Fallbacks

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) ·
**Contract**: [contracts/diagnosis-outcomes.md](./contracts/diagnosis-outcomes.md)

How to run and validate this feature. This is a verification guide — implementation belongs in
`tasks.md`.

---

## Prerequisites

- Node with the repo's dependencies installed (`npm install`)
- No database work: this feature has **no schema change**, so `npm run db:push` is not part of the
  flow and must not be run
- No Meta credentials: every validation below runs against the in-repo demo snapshot
  (`server/demo.ts` → `buildDemoSnapshot()`, `DEMO_FUNNEL`)

---

## The three commands

```
npm test                 # vitest — full suite
npm run check            # tsc --noEmit, must be zero errors (SC-006)
npm run dev              # the app, for the visual checks in §4
```

Targeted runs while iterating:

```
npx vitest run server/engine.diagnosis.test.ts    # the new suite
npx vitest run server/engine.test.ts              # verdict invariance + stored snapshot
npx vitest run server/nonSalesContainment.test.ts # exempt hard-skip (must stay green untouched)
```

---

## 1. Baseline before you start

Capture the pre-change verdict output so SC-009 is checkable rather than asserted:

```
git stash list                     # note: shared across worktrees — do not pop blindly
npx vitest run server/engine.test.ts
```

Expected now and after: green, and `server/__snapshots__/engine.test.ts.snap` **unchanged**.

That snapshot was verified in [research.md §R5](./research.md) to contain zero `text_ar` entries — it
locks target derivation, not findings. **If it changes during this feature, stop and investigate.**
Do not re-record it. A moving snapshot means something outside the diagnosis moved.

---

## 2. Validating the four outcomes

Each scenario builds a `NormalizedObject` and a fired `RuleResult`, calls
`diagnose(o, baselines, archetype, fired)`, and asserts on the returned `Finding[]`. The gate values
they steer around are in [research.md §R1](./research.md); the assertions are the C3 obligations.

### 2.1 `INSUFFICIENT_DATA` — the reported defect

**Input**: 800 impressions, 12 link clicks, 0 landing-page views, kill verdict.
Below every gate: impressions < 1000, link clicks < 50, lpViews < 100.

**Expect**: exactly one finding, `outcome === "INSUFFICIENT_DATA"`, no `ctaUrl`, text names the
observed counts and the single furthest-from-met gate (spec A6), and does **not** contain
«ليست بالإعلانات», «الإعلان بريء» or «المشكلة في العرض».

This is the row that today prints a confident innocence claim and a booking button.

### 2.2 `AD_IS_THE_PROBLEM` — no absolution in the same breath

**Input**: a dead-hook rule (`K3`) fired; rungs otherwise unevaluable but at least one evaluable and
clean, so clause 1 does not swallow it.

**Expect**: one finding, `outcome === "AD_IS_THE_PROBLEM"`, no `ctaUrl`, text points at the ad and
restates the rule's reasoning from the code-keyed copy map (C3.2) — never echoing `fired.reason_ar`
and never printing the code. No innocence claim in any wording.

### 2.3 `NO_BLAME_ASSIGNABLE` — the Q1 bucket

**Input**: a cost-only rule (`K6` or `CB1`) fired, at least one rung evaluable and clean, none broken.

**Expect**: one finding, `outcome === "NO_BLAME_ASSIGNABLE"`, no `ctaUrl`, text states what was
measured and healthy and stops. Contains **neither** an innocence claim **nor** an offer/funnel
claim — this outcome exists because neither is known.

### 2.4 `FUNNEL_CONFIRMED` — the claim that shows its work

**Input**: every rung evaluable and clean — crucially `linkClicks >= 50` and `lpViews >= 100` so
rungs 4 and 5 clear their gates — with a funnel-fault rule (`W3` / `W4`) fired.

**Expect**: one finding, `outcome === "FUNNEL_CONFIRMED"`, `ctaUrl` present, and the text is the
ordered ladder of C3.4: impressions → link clicks with the account median → landing-page views as a
share of clicks → conversions as a share of landing-page views → conclusion. At least three distinct
figures, all from that object's own window.

> **Fixture is synthetic — see [research.md §R3.3](./research.md).** With K7 classified *neither*,
> every remaining funnel-fault code is coupled to a rung: W3 fires on exactly the condition that
> breaks rung 5, W4 on exactly the condition that breaks rung 4. `runEngine` therefore never produces
> a W3/W4 row with rungs 4 and 5 clean, so this pairing is reachable only because `diagnose()`
> receives `fired` as a parameter rather than re-deriving it. The scenario still validates the C3.4
> ladder obligations; it does not validate a state production can reach. The production path to
> `FUNNEL_CONFIRMED` is C4's guarded W5 campaign path, exercised in §3. Rebuilding §2.4/§2.5 on that
> path is an open call.

**Also check C3.4a**: set `baselines.ctrLinkMedian90 = null` and confirm the median step says the
account median is unavailable — it must not print `0` and must not print the internal `1.0` fallback
as if it were the account's median.

### 2.5 The Q3 boundary — the case that changed

**Input**: same funnel-fault rule, but `lpViews = 40` so rung 5 is unevaluable while rung 1 is clean.

**Expect**: `INSUFFICIENT_DATA` (C2.2 clause 5), **not** `FUNNEL_CONFIRMED`. No `ctaUrl`, no
innocence claim, and no contribution to the account card.

This is the single most valuable assertion in the suite: it is the "one clean rung licenses the
booking button" behaviour that clarification Q3 removed.

### 2.6 The ad-blame exclusion — a finding that stands but does not fund the card

**Input**: an ad-fault rule fired (`K1` works at low volume), rungs 1–4 unevaluable, and the
page-conversion rung broken — `lpViews >= 100` with a conversion rate under the archetype floor.

**Expect**, and these two must both hold at once:

- **On the row**: the `RUNG_CONVERSION` finding stands, in its **neutral** wording (C8.1 — the fired
  rule is ad-fault, so the innocence wording is suppressed), and it still carries its `ctaUrl`
  (C8.3 / FR-017b).
- **At the account**: `summary.account_funnel_cta === null` when that is the only candidate row
  (C6.1a condition 2 / FR-010b). Add a second row carrying a clean funnel signal and the card
  returns — the exclusion is per-row, not per-account.

The distinction is the whole point of FR-010b: suppressing a row's **contribution** to the account
card is not the same as suppressing its **finding**. The conversion figure was genuinely measured, so
the finding is real; what the row cannot do is fund an account-level claim that the ads are fine
while the engine is condemning that same ad by name.

---

## 3. Validating the W5 evidence path

Both halves of the C4 guard need exercising, at the campaign level via `runEngine`.

| Case | `htoUnderperforming` | measured campaign CPA | Expect |
|------|----------------------|-----------------------|--------|
| Complete evidence | `true` | present | `FUNNEL_CONFIRMED`, exactly one funnel line, the cost-per-customer figure in the text, one `ctaUrl`, account card set |
| Flag only | `true` | null | `INSUFFICIENT_DATA`, no `ctaUrl`, account card **not** set from this row |
| CPA only | `false` | present | `INSUFFICIENT_DATA`, no `ctaUrl`, account card **not** set from this row |

The middle and bottom rows are what stop the Q1 binary-default problem reappearing at campaign level
(C4.3). Also assert C4.5: the row never carries two terminal findings — the old post-hoc `step: 6`
append is gone.

---

## 4. Visual checks

```
npm run dev
```

Open the dashboard and find «أين المشكلة تحديداً؟».

1. **One button** (C7.1, SC-007) — exactly one full-width «احجز مكالمة تشخيصية مجانية», in the
   account-level card at the top. No row repeats it. A row carrying funnel evidence shows at most one
   subtle inline text link.
2. **Levels visible** (C7.3) — every row shows حملة / مجموعة / إعلان beside its name.
3. **The duplicate row** (FR-012a, [research.md §R4](./research.md)) — find the two rows sharing a
   name and confirm they now differ by level. **If they show the same level *and* the same `id`, R4's
   conclusion is wrong and there is a genuine duplication defect** — record it and stop rather than
   papering over it with the level label.
4. **Numerals LTR** (C5.2) — in the `FUNNEL_CONFIRMED` ladder, the densest numeric string the product
   prints, every figure reads left-to-right inside the RTL line.
5. **No card without evidence** (C6.2, SC-008) — on an account whose flagged rows are all
   `INSUFFICIENT_DATA`, the account-level funnel card is absent entirely.
6. **No card funded by a condemned ad** (C6.1a, SC-003a) — on an account whose only funnel evidence
   comes from a row carrying an ad-fault 🔴, the card is absent too, even though that row shows a
   page-conversion finding with an inline link.
7. **The card claims no ad health** (C6.4, SC-003b) — wherever the card does render, its text states
   the measured funnel leak and routes to the call. It must not say «مؤشرات إعلاناتك جيدة» or any
   equivalent: a *neither*-class row with a broken conversion rung can fund the card while its
   rungs 1–4 were never evaluable.

---

## 5. Definition of done

| # | Check | Source |
|---|-------|--------|
| 1 | `npm test` green | Constitution engineering constraints |
| 2 | `npm run check` zero errors | SC-006 |
| 3 | `server/__snapshots__/engine.test.ts.snap` unchanged | SC-005, research §R5 |
| 4 | Verdict / rule / reason / action byte-identical over fixtures | SC-009, C9.1 |
| 5 | All 17 required test scenarios present and green | spec *Required Test Scenarios* |
| 6 | Zero rows claim innocence with zero evaluated rungs | SC-002, C9.4 |
| 7 | Zero rows show an ad-fault 🔴 next to "not the ads" — every line, rung copy included | SC-003, C9.5 |
| 8 | Five differing rows produce five differing texts | SC-001, C9.6 |
| 9 | Exactly one full-width booking button per page | SC-007, C9.7 |
| 10 | All-`INSUFFICIENT_DATA` account produces no funnel card | SC-008, C6.2 |
| 11 | `nonSalesContainment.test.ts` green **and unmodified** | C9.3, spec A4 |
| 12 | No ad-fault row contributes to the account funnel card | SC-003a, C6.1a, C9.10 |
| 13 | The account card's text contains no ad-health claim | SC-003b, C6.4, C9.11 |

---

## Troubleshooting

**`npm run check` reports errors at `Finding` construction sites.** Expected and intended.
`outcome` is a required field precisely so the compiler names every site that has not been updated
(data-model §6). Work through the list; do not make the field optional.

**The stored snapshot wants re-recording.** Do not. See §1 — it holds no finding text, so a diff
means something outside the diagnosis moved.

**A row shows two funnel lines.** The old campaign post-hoc `step: 6` append at
`server/engine.ts:~1451-1466` survived. C4.5 deletes both halves of that block: the W5 evidence is
passed into `diagnose()` instead.

**A guard-failing W5 campaign still sets the account card.** The old
`rows.some(r => r.rule === "W5")` scan in `buildSummary` survived. C6.3 removes it.

**The card still says the ads look good.** C6.4 was not applied to the `reason_ar` string at
`server/engine.ts:1798`. The exclusion in C6.1a removes ad-fault rows from funding the card, but a
*neither*-class row with a measured conversion break still funds it — and that row proves nothing
about the ads.

**An ad-fault row still sets the account card.** C6.1a **condition 2** is missing — the
`RULE_FAULT[row.rule] === "ad-fault"` half of the exclusion. Condition 1 alone cannot catch this
case: rungs 1–4 were unevaluable, so they produced no findings for it to test against.
