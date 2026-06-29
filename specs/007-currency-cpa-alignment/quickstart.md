# Quickstart / Validation Guide: Batch 2 (Currency + CPA Column)

How to prove the feature works end-to-end. Commands use **pnpm** (constitution). Run from
repo root `D:\qarar-batch2`.

## Prerequisites

- Dependencies installed (`pnpm install`).
- A MySQL database reachable by the app (for the migration + manual UI check).
- Branch `fix/currency-and-cpa-column` checked out.

## 1. Apply the schema migration

```
pnpm db:push
```

Expected: `funnelSettings` gains a nullable `inputCurrency varchar(8)` column. No other table
changes. Existing rows keep `inputCurrency = NULL`.

## 2. Type-check (must be zero errors)

```
pnpm check
```

Expected: `tsc --noEmit` passes with no errors (acceptance: zero TS errors).

## 3. Automated tests

```
pnpm test
```

Expected: the full suite is green, including:

- **Existing** `deriveTargets` + `runEngine` + isolation tests — pass **unchanged** (they pass
  no currency params ⇒ no-op path). This is the core backward-compat proof.
- **New** `convertCurrency` cases — see `contracts/currency-conversion.md`.
- **New** `deriveTargets` conversion + backward-compat cases — see `contracts/derive-targets.md`.
- **Updated** `cpaCell` cases — null/zero ⇒ `—` (not `∞`) — see `contracts/cpa-column.md`.

Quick targeted runs while developing:

```
pnpm test convertCurrency
pnpm test deriveTargets
pnpm test cellFormat
```

## 4. Manual UI validation — currency (ISSUE-009)

Use **Demo mode** if no live Meta account is connected (demo account currency is USD). To
exercise conversion, the simplest path is a live/connected account whose currency is **not**
USD (e.g. AED); otherwise inspect via the unit tests in step 3.

1. Open **Settings** for the account.
2. Confirm a **price-currency selector** ("ما عملة أسعارك؟") appears **above** the price
   fields, defaulted to the account's currency.
3. Pick a currency **different** from the account currency (e.g. account AED, pick USD):
   - A notice appears: "سيتم تحويل الأسعار تلقائيًا إلى {account symbol}".
   - The target preview shows **both** currencies, e.g.
     "هدف تكلفة العميل: $49 = د.إ179.83".
4. Set the selector **equal** to the account currency:
   - The notice disappears; the preview shows a **single** account-currency value.
5. **Save**, reload Settings → the selector reflects the saved `inputCurrency`.
6. Open the **Dashboard**: with input USD / account AED, derived targets are ~3.67× higher than
   before, and the verdict mix is no longer dominated by kills for at-target ads.

### Backward-compat spot check
For a pre-existing funnel (saved before this feature, `inputCurrency = NULL`): the dashboard
verdicts and Settings targets are **unchanged** until the user explicitly picks a foreign
currency.

## 5. Manual UI validation — CPA column (ISSUE-004)

1. On the Dashboard decision table, keep the default **"آخر 3 أيام" (3d)** range.
2. For a row with conversions: the **CPA column value equals** the number referenced in the
   verdict reasoning (both are `cpa_3d`). Header reads "تكلفة العميل (٣ أيام)".
3. For a zero-conversion row (e.g. `⏳ too_early`): CPA shows **"—"** with **neutral** color —
   not "0", not "∞", not red.
4. For a zero-conversion **kill** row: CPA shows **"—"** (red is acceptable; never "∞").
5. Switch the range to **30 days**: the CPA column now reflects the 30-day aggregate (column is
   range-aware); the verdict text still references the 3-day figure.

## 6. Acceptance checklist (maps to spec Success Criteria)

- [ ] `pnpm db:push` adds nullable `inputCurrency`; existing rows untouched (SC-003 path).
- [ ] `pnpm check` → 0 errors (SC-007).
- [ ] `pnpm test` → all green; existing engine/isolation tests unchanged (SC-002).
- [ ] `convertCurrency` returns documented values (SC-006).
- [ ] USD→AED targets ≈ ×3.67 (SC-001); same-currency identical (SC-003).
- [ ] Settings shows selector + notice + dual-currency preview (SC-004).
- [ ] Default 3d CPA column == verdict figure; null ⇒ "—" (SC-005).
- [ ] No engine rule/order/threshold change; no `server/_core/` change.
