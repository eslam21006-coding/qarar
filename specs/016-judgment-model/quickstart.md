# Quickstart: validating feature 016

## Prerequisites

- Worktree on branch `016-judgment-model`, `pnpm install` done.
- **Run every test with `DATABASE_URL` empty** (shared MySQL makes DB suites flaky). With it empty,
  `server/auth-flow.e2e.test.ts` fails with "Database connection failed"; every other suite must
  pass.
- `server/engine.ts`, `server/engine.test.ts`, `server/demo.ts`, `shared/qarar.ts` and the snapshot
  are CRLF — keep them CRLF.

## Gates

```sh
pnpm run check                       # tsc, zero errors
DATABASE_URL= pnpm test              # full suite
DATABASE_URL= pnpm exec vitest run server/engine.test.ts   # engine only
```

Never run `vitest -u` blindly. Every snapshot change gets a row in the justification table in the
implementation report (expected: the four campaign rows in research.md §4.2, nothing else).

## Checkpoint 0 — shared selector is behaviour-neutral (SC-004)

After adopting `countedResults` in the engine and **before any other change**:
`DATABASE_URL= pnpm test` green with **no** snapshot diff (`git diff --stat server/__snapshots__`
empty).

## Scenarios

| ID | Requirement | How | Expected |
|---|---|---|---|
| S-R1-1 | FR-003 ≥1 🟢 | demo paid_lto `cmp_test` | 🟡 CB2; action `أوقِف «Stage A — جمهور اهتمام: ريادة أعمال»، «Stage B — جمهور Lookalike 1%» وأبقِ «Stage A — بروود + Advantage» — فيها إعلان واحد يستحق الإنقاذ` |
| S-R1-2 | FR-003 otherwise | demo `cmp_scale` (both funnels); demo free_lead `cmp_test` | 🟡 W1 from `as_w1`; free_lead `cmp_test` 🟡 W3 from `as_good`; actions list the ad sets with their own actions |
| S-R1-2a | FR-004 / D-R1 | hover the rule chip on demo paid_lto `cmp_test` | "من مجموعة Stage B — جمهور Lookalike 1%: خطر اليوم — أوقِفه فورًا" |
| S-R1-2b | FR-004 / Q2 | a derived 🔴 campaign in today's decisions | badge and "قاعدة: …" line carry "من مجموعة {name}: …" |
| S-R1-2c | FR-004a / Q1 | open the history dialog of a campaign that was S2 and is now 🟡 CB2 | old entries keep bare titles; the new 🟡 CB2 entry reads "من إحدى مجموعاتها: خطر اليوم — أوقِفه فورًا" |
| S-R1-3 | FR-003 all 🔴 / ⏳ / empty | hand-built campaigns | 🔴 "أوقِف الحملة — كل مجموعاتها تخسر"; ⏳ "اترك البيانات تتجمع" |
| S-R1-4 | FR-002 W5 | demo with `htoUnderperforming` | `cmp_scale` stays 🟡 W5 with findings + CTA |
| S-R1-5 | FR-008/009 | demo table | ABO `cmp_test`: no campaign buttons, ad-set buttons enabled; CBO `cmp_scale`: campaign buttons disabled with tooltip, ad-set rows show none |
| S-R1-6 | FR-005 / copy | read campaign reasons | counts agree (مجموعة واحدة / مجموعتان / 3 مجموعات) |
| S-R1-7 | FR-011 | `server/dailyRefresh.test.ts` new case | derived 🔴 campaign in `diffKillSet` |
| S-R2-1 | FR-014 | ⏳ row with results > 0 | cost shown, uncolored |
| S-R2-2 | FR-015 | unknown-count fixture | results and CPA show `؟` with tooltip |
| S-R2-3 | FR-013 | lead-counting archetype, every range | results counted by `countedResults` |
| S-R2-4 | FR-017 | footer with one unknown `conversionValue` | ROAS `—` with tooltip |
| S-R2-5 | FR-018 | invariant sweep test | all four invariants hold |
| S-R3-1 | FR-020/021 | guard tests | 🔴 → ⏳ GATE; K3/CB1/CB2 and 🟡/🟢/🛟 unchanged |
| S-R3-2 | FR-020a/021a | engine tests + card change log | derived campaign findings `[]`; W5 keeps CTA; card coverage holds; every card difference vs `main@a855599` is in "Funnel card changes" with a justification |
| S-R4-1 | FR-024 | two fixtures | paid_lto 0/5 → no CB2; webinar 0/0 → CB2 |
| S-R5-1 | FR-027 | two fixtures | 1 result → ⏳ K5, reason "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات", action "راجعه بعد أن يحقق نتيجة ثانية"; 2 → 🛟 |
| S-R6-1 | FR-028/029 | render table, switch to 7d | Arabic headers, abbreviations in header tooltips; banner text exact |

## Live account (brief §4, after merge)

1. No campaign shows 🔴 while it contains a 🟢 ad set; ES-WW / MO-CBO actions name ad sets, not
   "أوقف الحملة".
2. Switch the table 3d → 7d → 30d: never results > 0 with an empty cost; 3d numbers equal the
   verdict's numbers.
3. Column headers are Arabic; the banner says "بدون اليوم".
4. No 🛟 on an ad with a single sale.
