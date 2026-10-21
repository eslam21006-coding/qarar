# Specification Analysis Report — 016-judgment-model (pass 5)

**Date**: 2026-10-20 · **Artifacts**: [spec.md](./spec.md), [plan.md](./plan.md),
[tasks.md](./tasks.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md) · **Constitution**: v1.1.2

Pass 5 runs after the owner's decisions on pass 4 (Q1, Q2, Q3). Analysis only — no implementation.

## Pass-4 findings: resolution

| ID | Decision | Applied in | Status |
|---|---|---|---|
| Q1 | (a), scoped: in the history dialog, prefix "من إحدى مجموعاته: " only when level = campaign, verdict = watch, and rule ∈ {K1, K2, K3, K4, K6, K7, CB2}; test one old entry (campaign/kill/K1 → no prefix) and one derived entry (campaign/watch/CB2 → prefixed) | spec Clarifications, new **FR-004a**, US1 scenario 5d; campaign-derivation **C2b** and C8 test 2e; data-model "Verdict history display"; copy L3; research D3; quickstart S-R1-2c; plan tree and scope; tasks T018 (`historyRuleTitle` at `VerdictHistoryDialog.tsx:99`), T019 (tests incl. ad set/watch/K1 and campaign/watch/W1 unprefixed) | ✅ resolved |
| Q2 | Pass `derived_from_adset` through to top actions; the same helper titles them; keep "every" | spec FR-004; campaign-derivation C2a surface table, C8 test 2d; data-model `TopAction.derived_from_adset`; quickstart S-R1-2b; plan tree; tasks T012 (field + copy in `buildSummary` `:2563–2620`), T018 (`Dashboard.tsx:621`, `:636`), T010 | ✅ resolved |
| Q3 | Prefix on every derived campaign, not only the mismatch case | spec Clarifications, FR-004; campaign-derivation C2a, C8 test 2c; research D3; tasks T010 | ✅ resolved |

Q1's premise was checked against `main@a855599`. The campaign evaluator there emits GATE (status,
event-match, pre-separation, results-unknown, spend), NS1/NS2, W5, W1, W6, S2 and K1 (as kill only).
It never emits watch with a kill-family code, so the prefix cannot attach to a pre-016 entry
produced by that code.

## New findings (pass 5)

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| R1 | Copy correctness (Principle III) | LOW | spec FR-004a; C2b; copy L3; quickstart S-R1-2c; tasks T019 | "من إحدى مجموعاته" uses a masculine pronoun, but the entry is about a campaign (حملة, feminine). Correct agreement is "من إحدى مجموعاتها". It was kept verbatim as the owner wrote it. | Confirm the wording, or switch to "من إحدى مجموعاتها: " in the five places listed (T047's copy review would also catch it). |
| R2 | Residual risk | LOW | FR-004a premise | The "only 016 can produce this combination" check covers the campaign logic at `main@a855599`. `verdictHistory` may also hold entries written by **earlier** releases (before spec 015). If any of those logged a campaign as watch with a kill-family code, they would now get the prefix. Nothing seen in this repo suggests that happened, but it was not verified across history. | Optional: one read-only query on production `verdictHistory` (`level='campaign' AND verdict='watch' AND rule IN (...)`) before release; expected count is 0. |

No CRITICAL, HIGH or MEDIUM findings.

## Coverage summary

| Requirement | Has task? | Task IDs | Notes |
|---|---|---|---|
| FR-001–002 | ✅ | T010, T013, T014 | |
| FR-003, 003a, 005 | ✅ | T009, T012, T013 | |
| FR-004 (D-R1, Q2, Q3) | ✅ | T009, T010, T012, T018, T019 | |
| FR-004a (Q1) | ✅ | T018, T019 | R1, R2 |
| FR-006 | ✅ | T010, T015, T018 | |
| FR-007 | ✅ | T013, T016 | |
| FR-008–009 | ✅ | T010, T015, T017, T019 | |
| FR-010 | ✅ | T022 | |
| FR-011 | ✅ | T011 | |
| FR-012–018 | ✅ | T003, T005–T007, T023–T036 | |
| FR-019–021a | ✅ | T008, T010, T014, T016, T022, T037–T039, T052 | |
| FR-022–027 | ✅ | T040–T043 | |
| FR-028–030 | ✅ | T044–T047 | |
| FR-031–035 | ✅ | T013, T020, T021, T038, T039, T048–T050 | |
| SC-001–SC-010 | ✅ | T007, T010, T022, T027, T037, T040, T042, T044, T050, T052 | |

## Constitution alignment

No MUST violated.

- **Principle II**: codes are unchanged and still faded/tooltip-only. The prefixes are title text.
- **Principle III**: new strings are in copy.md L3 (see R1).
- **Engineering constraints**: still no migration. The history prefix is computed on display from
  stored `(level, verdict, rule)`.

## Unmapped tasks

None.

## Metrics

- Total requirements: 39 FR (FR-001–FR-035 plus FR-003a, FR-004a, FR-020a, FR-021a) and 10 SC
- Total tasks: 53 (53/53 match the checklist format; IDs T001–T053 in order)
- Coverage: 100%
- Ambiguity count: 0 · Duplication count: 1 (D1, accepted)
- Critical: 0 · High: 0 · Medium: 0 · Low: 2 (R1, R2)

## Next actions

- Confirm **R1**'s wording. The rest is ready.
- `/speckit-implement`, starting with Checkpoint 0 (T007).
