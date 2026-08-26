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

`npx vitest run` — 620 pass, 11 skipped (auth-flow e2e needs a DB),
0 fail. `npm run check` — zero errors. Snapshot diff — empty.
