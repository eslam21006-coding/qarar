# Implementation Log — Spec 014 Diagnosis Evidence & Honest Fallbacks

Working through `specs/014-diagnosis-evidence-fallbacks/tasks.md` phase by phase.
Contract C1..C10 in `contracts/diagnosis-outcomes.md` governs where prose and intuition
disagree.

## Phase 1 — Setup (T001..T003)

### T001 — verdict baseline (SC-009)
Snapshot of `{id, verdict, rule, reason_ar, action_ar}` for every row in
`buildDemoSnapshot()` — this is the byte-identity check the rest of the feature
is judged against.

### T002 / T003 — empty test files

Skeleton `server/engine.diagnosis.test.ts` with the shared denylist constants
(`AD_HEALTH_CLAIMS`, `BLAME_CLAIMS`) and the builders (`makeObject`,
`makeBaselines`, `makeFired`).

Skeleton `client/src/pages/DiagnosisSection.test.tsx` with the jsdom pragma
matching the `FacebookPagesCard.test.tsx` convention.

## Phase 6 — US4 (T037..T041)

`DiagnosisSection` and `FindingRow` are now named exports of
`client/src/pages/Dashboard.tsx` (T037). The component test
`client/src/pages/DiagnosisSection.test.tsx` renders them in isolation.

`FindingRow`'s row-level `ctaUrl` is now an `<a>` with subtle inline
styling (text-primary underline), not a `<Button>` (T040, C7.2). The
full-width booking button lives only in the account-level card.

The row header carries the level label (T041, FR-012). `levelLabel()`
maps `EngineRow.level` → "حملة" / "مجموعة" / "إعلان".

## Phase 7 — Polish (T042..T053)

All 23 scenarios present and green:

- **T042** — Scenario 11 (distinctness).
- **T043** — Scenario 13 (verdict invariance over the demo).
  Byte-identity verified against `verdict-baseline.json`.
- **T044** — ctaUrl discipline sweep (`outcome` is
  `FUNNEL_CONFIRMED` or `RUNG_CONVERSION` whenever `ctaUrl` is set).
- **T045** — snapshot unchanged. `git diff main -- server/__snapshots__/engine.test.ts.snap`
  is empty.
- **T046** — `npm run check` zero errors.
- **T047** — FR-012a residual. Demo snapshot has no duplicate-name
  rows today; the level label is present on every row regardless, so
  the distinguishing behaviour is in place if a duplicate appears.
- **T050** — Scenario 15 (BLAME_CLAIMS sweep on INSUFFICIENT_DATA rows).
- **T051** — Scenario 16 (AD_HEALTH_CLAIMS sweep on ad-fault kill rows).
- **T052** — Scenario 17 (account card carries no AD_HEALTH_CLAIMS).
- **T053** — Scenario 18 (selector purity — fired.reason / fired.action
  have no influence on the outcome; fired is not mutated).

## Ambiguities resolved against the contract

- **K7** — `neither`. research §R3.3 settled it; not revisited.
- **RUNG_CONVERSION ctaUrl** — present in both wordings (FR-017b).
  Suppressing the *claim* does not suppress the *finding* or its CTA.
- **Precedence ordering** — clause 1 (INSUFFICIENT_DATA, evaluable.size === 0)
  has higher precedence than clause 2 (ad-fault). When all rungs are
  unevaluable, INSUFFICIENT_DATA wins even if the rule is ad-fault.
- **W5 with failed guard** — the engine does not produce a `W5`
  rule code when the guard fails; the campaign resolves through
  ordinary C2.2 precedence. Spec scenario 8 asserts the
  *summary card* behaviour, not the existence of a `W5` row.
- **rung-5 with `conv === undefined`** — pre-separation snapshot;
  rung 5 stays `unevaluable` (FR-035). `conv === 0` is a real
  captured zero and resolves to `cvr === 0` → `broken`.

## Final tally

| Phase | Tests added | Files touched |
|-------|------------|---------------|
| Foundation | — | `shared/qarar.ts`, `server/engine.ts` |
| US1–US3 | 23 in `server/engine.diagnosis.test.ts` | `server/engine.ts` |
| US4 | 6 in `client/src/pages/DiagnosisSection.test.tsx` | `client/src/pages/Dashboard.tsx` |
| Baseline | 18 rows | `specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json` |
| Impl log | — | `docs/impl-log-014.md` |

**Verification at the end of the initial implementation** (before the
self-review remediation pass recorded at the bottom of this file):

- `npx vitest run` — 620 passed, 11 skipped, **1 suite failed**:
  `server/auth-flow.e2e.test.ts`, which throws `Database connection
  failed` in `beforeAll` because no database is reachable in this
  environment. It is untouched by this feature. An earlier draft of this
  line read "0 fail", which was wrong — vitest exits `0` even with a
  failed suite, and that exit code was mistaken for a green run.
- `npm run check` — zero errors.
- Snapshot diff — empty.

The final, post-remediation numbers are in *Verification* at the end of
this file.


---

# Self-review remediation pass (2026-08-26)

`docs/self-review-014.md` audited the implementation against the eight
verification points and found four defects the suite did not cover, plus
two cosmetic ones. All six are fixed here. Nothing outside `diagnose()`,
its helpers and its call sites changed; the verdict pipeline is
byte-identical and the stored snapshot diff is still empty.

## F1 (HIGH) — the ladder computed step 4 with the wrong archetype

`funnelConfirmedText` hardcoded `effectiveConversionsLocal(o, "paid_lto")`
while `evaluateRungs` used the real archetype for rung 5. Since
`effectiveConversionsLocal` returns `leadConversions` for
`appointment` / `webinar` and `conversions` otherwise, an appointment
account whose rung 5 was `clean` on 50 leads printed a percentage
computed from zero purchases — `0.0% من زوار الصفحة اشتروا` sitting
underneath a claim that the funnel was confirmed healthy. The number
contradicted the evidence that licensed it.

`archetype` is now a **required** parameter of `funnelConfirmedText`,
threaded from `diagnose()` at both call sites (the C4 route and the
clause-4 route). Normative in contract **C4.4a**.

Not fixed, and recorded there as a follow-on: step 4's verb is «اشتروا»
("bought") on every archetype, as is rung 5's own broken-wording at
`server/engine.ts:~1200`. For an appointment account the counted unit is
a booked lead. The *figure* is now right everywhere; the *noun* is not.
Changing it alters existing rung-5 finding copy and belongs in its own
change.

## F2 (HIGH) — the guard's flag half was dead code

`diagnose()` inferred the account funnel flag from `fired.ctaUrl` being
set. That carries no information: `evaluateCampaign` attaches the
discovery CTA to **every** W5 `Fired` it returns, so the check was
structurally always true. The guard agreed with the intended behaviour
only by accident — W5's own firing condition already requires the flag.
The conditional `Fired` rebuild at the campaign call site was likewise a
no-op, since `rawFired` already carried `ctaUrl` on both branches.

`diagnose()` now takes `htoUnderperforming: boolean = false` as an
explicit fifth parameter, passed from `funnel.htoUnderperforming` at all
three `runEngine` call sites. It defaults to `false` so the evidence path
fails closed for any caller that does not state it. The `Fired` rebuild
is deleted and the misleading comment is gone. Normative in **C4.2a**;
the reasoning is recorded as data-model **V20**.

## F3 (MEDIUM) — the guard read the wrong CPA

Both halves read `o.w3d.cpa` / `c.w3d.cpa`, the legacy cost-per-purchase
field, while W5's own firing condition reads `effectiveCpa(o, archetype)`
— explicitly, per the T025 comment, so that appointment / webinar are
judged on cost-per-lead. The result: an appointment campaign with the
funnel flag and a real measured cost-per-lead fired W5 and was then
denied its own evidence path, falling through to `INSUFFICIENT_DATA`
while its row copy still asserted the ad was innocent.

The guard now reads `effectiveCpa(o, archetype)`. The unit is pinned in
**C4.2a** so it cannot drift back.

## F4 (MEDIUM) — the production route asserted almost nothing

Scenario 7's only figure check was `expect(f.text_ar).toMatch(/[0-9]+/)`,
which any digit satisfies — the SC-004 and SC-004a assertions the
pre-implementation remediation moved onto it never landed. Scenario 8 was
worse: both sub-cases built fixtures where W5 never fires at all, so
contract C4.3's *closed* state had zero coverage and the tests passed for
an unrelated reason.

**Scenario 7** now asserts the ladder parts, `50,000` and `2,000`
verbatim, at least three distinct figures (SC-004), that the arrival and
conversion steps are printed rather than declared unavailable (SC-004a),
and that the ad-level median is correctly stated unavailable per C4.4.
Asserting the cost-per-customer figure verbatim also proves the finding
came through C4 rather than clause 4 — the fixture's rungs 4 and 5 are
both clean, so the outcome alone cannot distinguish the two routes.

**Scenario 8** is rebuilt on direct `diagnose()` calls, the way scenarios
5 and 6 work. The shared fixture holds rungs 4 and 5 **unevaluable**, so
clause 4 cannot match and `FUNNEL_CONFIRMED` is reachable only through
C4; every case then varies just the guard's two inputs against an open
control. Five cases: the open control, flag-only, CPA-only, a case
proving `fired.ctaUrl` alone is not enough (F2), and an appointment case
proving the CPA half reads `effectiveCpa` (F3). The two old `runEngine`
cases are kept as **scenario 8b** with an honest label — they cover
FR-010a, not the guard, and now also assert that no W5 row exists.
Testing requirement recorded as **C4.3a**.

**Scenario 7b** is new and covers F1 directly: scenario 8's appointment
case has `lpViews = 0`, so it never reaches step 4 and would not have
caught the hardcode.

## Mutation check

The point of F4 was that a passing test proves nothing until you know it
can fail. Each fix was reverted in turn and the suite re-run:

| Reverted | Result |
|----------|--------|
| `archetype` to `"paid_lto"` in the ladder | 1 failed — scenario 7b, on the missing `25.0%` lead-based figure |
| explicit flag to `fired.ctaUrl` | 3 failed — scenario 8 control, the F2 case, the F3 case |
| `effectiveCpa(o, archetype)` to `o.w3d.cpa` | 1 failed — scenario 8's F3 case |

Restored: 30 passed.

## F5, F6 (LOW)

Two U+FFFD replacement characters (bytes `EF BF BD`) sat where a red
circle emoji was intended, in the scenario 14 and scenario 16 comments
and `describe` titles. Replaced with the real emoji, written through an
explicit UTF-8 encode so they survive.

`client/src/pages/Dashboard.swr.test.tsx` mocked
`@/components/DiagnosisSection`, a module that has never existed —
`DiagnosisSection` is defined inside `@/pages/Dashboard`, the module
under test, so it cannot be stubbed from outside. Repointing it would
mock the subject of the test, so the mock is deleted and replaced with a
comment saying why there isn't one.

## Documentation

- **C4.2a** (new) — how each guard condition MUST and MUST NOT be read.
- **C4.3a** (new) — why the guard's closed state MUST be tested through
  `diagnose()` directly, with an open control.
- **C4.4a** (new) — the ladder's figures MUST use the rung evaluation's
  archetype; the copy follow-on recorded.
- **C4.4** step-4 row and **C4.5** amended; the contract's interface
  block now shows the fifth parameter.
- **data-model section 9** — the diagram, the two-input list, and **V20**
  on why the flag is an argument rather than a borrowed field.
- Traceability: C4 maps to scenarios 7, 7b, 8, 8b; route-coverage table
  updated.

## Verification

| Command | Result |
|---------|--------|
| `npm run check` | zero errors, exit 0 |
| `npx vitest run` | 627 passed, 11 skipped, 1 suite failed |
| `npx vitest run server/engine.diagnosis.test.ts` | 30 passed (was 23) |
| `npx vitest run server/engine.test.ts` | 93 passed |
| `git diff --numstat server/__snapshots__/engine.test.ts.snap` | no rows — **empty** |

The one failing suite is `server/auth-flow.e2e.test.ts`, unchanged and
untouched by this feature: it throws `Database connection failed` in
`beforeAll` because no database is reachable here. It failed identically
before this pass. Note vitest still exits `0` with a failed suite, so CI
keyed on the exit code would not catch it — worth a separate look.
