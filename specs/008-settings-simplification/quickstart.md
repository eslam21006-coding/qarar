# Quickstart / Validation Guide: Settings Page Simplification (Batch 4)

How to verify the feature works end-to-end. Implementation details live in `tasks.md`; field rules
and copy live in `contracts/settings-fields.md`.

## Prerequisites

- Dependencies installed (`npm install` / `pnpm install`).
- Able to run the app locally (`npm run dev`) and reach the Settings route for an account:
  `/settings/:accountId`. Demo mode works for manual checks.

## Automated verification

```bash
npm run check     # tsc --noEmit — MUST report zero errors
npm test          # vitest run — existing suite stays green + new settingsFields.test.ts passes
```

Expected:
- `settingsFields.test.ts` passes (visibility predicate + field-set invariants — see data-model.md).
- All pre-existing tests (`shared/qarar.test.ts`, `server/engine.test.ts`, `server/isolation.test.ts`,
  etc.) pass **unchanged** — this feature touches no server/shared/engine code.

## Manual validation scenarios

### Scenario A — Only engine-used fields are visible (US1, FR-001/FR-002)

1. Open Settings for any account.
2. Confirm the visible inputs are exactly: archetype, currency selector, متوسط قيمة الطلب,
   كم ضعفًا تريد استرداده, سعر المنتج الغالي, نسبة شراء الغالي, plus the advanced section
   (htoUnderperforming toggle + dailyBudget; marketCplBenchmark only for free_lead).
3. Confirm there is **no** "طريقة الاستهداف" selector, **no** "وصف العرض" textarea, **no**
   "الاستهداف (اختياري)" card, **no** live-broadcast toggle, **no** ticket-price field.
4. Confirm every visible field shows an Arabic label + Arabic help text, and no English is visible.

**Expected**: ≤ 9 visible inputs (SC-001); 100% Arabic labels/help (SC-002).

### Scenario B — No data loss for hidden fields (US2, FR-003, SC-003)

1. Pick an account whose stored funnel row has non-empty hidden values (e.g. `geoTiers`,
   `bestInterest`, `offerDescription`, `arena = "interests"`). (Seed via DB or a prior save.)
2. Open Settings, change a visible field (e.g. متوسط قيمة الطلب), click "احفظ وارجع للوحة".
3. Re-open Settings / inspect the persisted row.

**Expected**: save succeeds; the previously stored hidden values are unchanged (not nulled, not
reset to defaults). `arena` still saved as its prior value.

### Scenario C — Brand-new account saves cleanly (FR-003, SC-004)

1. Use an account with no funnel row yet.
2. Fill only the visible fields; save.

**Expected**: save succeeds with no validation error (hidden fields, incl. required `arena`, are
sent with `DEFAULTS`).

### Scenario D — Archetype-conditional field (US3, FR-011/FR-012)

1. Set archetype to "أجمع بيانات عملاء مجانًا…" (free_lead) → the market-CPL benchmark field
   appears.
2. Switch to "أبيع منتجًا رخيصًا…" (paid_lto) or "العميل يحجز مكالمة" (direct_call) → the benchmark
   field disappears; متوسط قيمة الطلب / كم ضعفًا / سعر المنتج الغالي / نسبة شراء الغالي remain.

**Expected**: only `marketCplBenchmark` toggles with archetype; `frontEndRoas` etc. stay visible for
`direct_call`.

### Scenario E — Batch 2 features preserved (FR-007/FR-008)

1. Choose an input currency different from the account currency.
2. Confirm the conversion notice appears and the derived-targets card shows dual currency
   ("هدف تكلفة العميل: {input} = {account}").
3. Change `aov` / `frontEndRoas` and confirm the targets card recalculates live.
4. Enter a daily budget and confirm the suggested per-ad-set budget hint still appears.

**Expected**: currency selector, conversion notice, dual-currency target display, live recalc, and
suggested-budget hint all behave exactly as in Batch 2 (SC-005: identical derived values).

### Scenario F — Advanced section default state (Q4)

1. Open Settings.

**Expected**: the "إعدادات متقدمة" section is **expanded by default** (engine-used
`htoUnderperforming` / `marketCplBenchmark` visible on load); the user can collapse it.

## Done

- All automated checks green; Scenarios A–F pass on manual review.
