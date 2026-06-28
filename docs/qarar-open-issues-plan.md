# Qarar (قرار) — Open Issues Plan
## Post-Auth Stabilization & Feature Completion

**Version:** 1.1
**Date:** June 28, 2026
**Status:** Batch 1 merged (engine fix, timeout, copy cleanup). This update adds ISSUE-009 (currency conversion) to Batch 2.

---

## Current State

### What works
- Better Auth login/signup with email + password
- Subscription gating (inactive users see upgrade screen)
- Admin auto-elevation via ADMIN_EMAIL
- GHL webhook endpoint (ready, not yet configured in GHL)
- Meta OAuth connection (redirect URIs updated for app.adqarar.com)
- Decision engine with 39 rules + zero-result gap fix (Batch 1)
- Dashboard.refresh timeout increased to 180s (Batch 1)
- Internal "خطوة" labels removed from user-facing copy (Batch 1)
- Dark Arabic RTL UI with branded split login screen
- Demo mode with synthetic data
- Password reset and email verification
- 179 tests passing

### What is broken or incomplete
- CPA column shows different value than what engine used
- No currency conversion between user's price currency and ad account currency
- New ad sets may not appear (verify after Batch 1 deploy)
- Too many "اقفل" verdicts (likely caused by currency mismatch — verify after Batch 2)
- Settings page collects unnecessary data
- GHL → auto-create-user flow not built

---

## Constitution Reference

All work in this plan must comply with `.specify/memory/constitution.md`:

1. **Deterministic engine** — no AI in decisions; evaluation order is sacred
2. **Rule codes verbatim** — K1, W6, etc. exactly as written, shown only faded in tooltips
3. **Simple Arabic** — ≤ 6th grade fusha, no jargon, no colloquial
4. **Hard data isolation** — every query scoped by userId
5. **Read-only by default** — writes to Meta only for pause/resume/budget with confirmation
6. **Fixed 5-verdict set** — 🔴 kill · 🟡 watch · 🟢 continue · 🛟 rescue · ⏳ too_early
7. **Offer/funnel routing** — when ads are healthy but funnel is broken, route to discovery call

---

## Issue Registry

### ~~ISSUE-001: Engine verdict bug — zero-result fallthrough~~
**Status:** ✅ FIXED in Batch 1

### ~~ISSUE-002: Cloudflare 524 timeout on dashboard.refresh~~
**Status:** ✅ FIXED in Batch 1 (timeout increased to 180s)

### ISSUE-003: New ad sets not appearing after publish
**Priority:** 🔴 CRITICAL (verify after Batch 1 deploy)
**Category:** Data freshness

**Problem:**
An ad set published on June 22 does not appear in the app on June 23.

**Action:**
Verify this resolves after deploying Batch 1 (timeout fix). If it doesn't:
- Check if the Meta API query filters out newly created objects
- Check if the snapshot caching logic skips objects below a spend/impression threshold
- Check if the normalization layer drops objects with no data

**No spec needed until verified.**

---

### ISSUE-004: CPA column shows different number than engine used
**Priority:** 🟡 IMPORTANT
**Category:** UI data consistency
**Files:** `client/src/components/DecisionTable.tsx`
**Batch:** 2

**Problem:**
The CPA column in the dashboard shows one value (e.g. 24.7) but the engine tooltip says a different value (e.g. 62 over 3 days). The user sees the column number and the tooltip number and they don't match.

**Root cause:**
The CPA column may be showing today's CPA or the selected range CPA, while the engine always evaluates on the 3-day rolling window (`w3d.cpa`). The engine output already includes `cpa_3d` in each row — the column should display this value.

**Required fix:**
- The CPA column must display `row.cpa_3d` (the 3-day rolling CPA the engine used)
- If `cpa_3d` is null (zero conversions), show "—" (dash, not zero, not infinity)
- The column header should indicate this is the 3-day value (e.g. "تكلفة العميل (٣ أيام)")
- Tooltip text that references CPA numbers must use the same `cpa_3d` value

**Constraints:**
- Do not change any engine logic
- Do not change the data the engine outputs — only how the UI reads and displays it

---

### ~~ISSUE-005: Internal step labels in user-facing messages~~
**Status:** ✅ FIXED in Batch 1

---

### ISSUE-006: Too many "اقفل" (kill) verdicts
**Priority:** 🟡 IMPORTANT (diagnose after ISSUE-009)
**Category:** Engine calibration

**Problem:**
The user reports that most ads are getting killed. Very few get "واصل" or "كمّل".

**Root cause (hypothesis):**
Most likely caused by ISSUE-009 — if the user entered prices in USD but the ad account is in AED, every CPA looks 3.67× higher than intended, causing almost everything to hit kill thresholds.

**Action:**
1. Fix ISSUE-009 (currency conversion) first
2. User re-enters funnel settings with correct currency
3. Re-evaluate verdict distribution
4. If still too many kills, review kill thresholds against live data

**No spec until ISSUE-009 is deployed and tested.**

---

### ISSUE-007: Settings page collects unnecessary data
**Priority:** 🟢 FEATURE
**Category:** UX simplification
**Files:** `client/src/pages/Settings.tsx`, possibly `server/routers.ts`
**Batch:** 4

**Problem:**
The settings page asks for targeting options, countries, etc. that have no effect on engine decisions. The only inputs the engine uses are:
- `archetype`: funnel type (paid_lto / free_lead / direct_call)
- `aov`: average order value
- `htoPrice`: high-ticket offer price
- `htoConversionRate`: lead → HTO conversion %
- `frontEndRoas`: front-end ROAS target
- `marketCplBenchmark`: CPL benchmark for free-lead funnels
- `htoUnderperforming`: W5 funnel signal flag

Everything else (targeting, countries, demographics, arena, bestInterest, geoTiers) is noise.

**Required fix:**
- Remove or collapse unnecessary fields in the settings UI
- Keep only the fields the engine actually reads from `FunnelInputs`
- Add simple Arabic labels with examples
- This is a UI-only change — the server schema and engine logic stay the same

---

### ISSUE-008: GHL purchase → auto-create user flow
**Priority:** 🟢 FEATURE
**Category:** User onboarding automation
**Files:** `server/ghl-webhook.ts`, `server/auth.ts`, `server/passwordReset.ts`
**Batch:** 5

**Problem:**
The current flow requires manual activation. The desired flow:
1. Buyer pays on GHL sales page
2. GHL fires webhook to `/api/webhooks/ghl`
3. Webhook handler:
   a. Checks if user exists by email
   b. If not → creates a new Better Auth user with `subscriptionStatus: "active"`
   c. Generates a password-reset token
   d. Returns the set-password URL in the webhook response
4. GHL automation sends the buyer an email with the set-password link
5. Buyer sets password → logs in → sees dashboard immediately

**Dependencies:**
- `server/passwordReset.ts` already exists
- Better Auth user creation is implemented
- GHL webhook handler processes payment events

---

### ISSUE-009: Currency-aware funnel settings
**Priority:** 🔴 CRITICAL
**Category:** Engine accuracy / Settings
**Files:** `shared/qarar.ts`, `drizzle/schema.ts`, `client/src/pages/Settings.tsx`, `server/routers.ts`
**Batch:** 2

**Problem:**
There is no currency conversion between the user's price currency and the ad account currency. The `deriveTargets()` function takes raw numbers from funnel settings and compares them directly against Meta API data. If the user enters prices in USD but their ad account reports in AED, every target is ~3.67× too low, causing almost every ad to be killed.

**Example:**
- User enters AOV = $49 USD
- Ad account is in AED
- Engine derives target CPA = $49 (treated as 49 AED = ~$13.35 USD)
- Meta reports CPA = 180 AED (~$49 USD) — the actual correct CPA
- Engine sees 180 vs 49 → 3.67× above target → kills it
- Real comparison should be: target 180 AED vs CPA 180 AED → at target → continue

**Required fix:**

#### 1. Settings UI changes (`client/src/pages/Settings.tsx`)
- Add a currency selector dropdown at the top of the funnel settings form
- Label: "ما عملة أسعارك؟" (What currency are your prices in?)
- Options: USD, AED, SAR, EGP, EUR, GBP, KWD, QAR, BHD, OMR
- Default: the ad account's currency (from `adAccounts.currency`)
- The selector appears prominently BEFORE any price fields
- When the input currency matches the ad account currency, no conversion notice is shown
- When they differ, show a notice: "سيتم تحويل الأسعار تلقائيًا إلى {accountCurrency}" (Prices will be auto-converted to {accountCurrency})

#### 2. Schema change (`drizzle/schema.ts`)
- Add `inputCurrency` column to `funnelSettings` table
- Type: `varchar("inputCurrency", { length: 8 }).default("USD")`
- Run migration with `pnpm db:push`

#### 3. Exchange rate table (`shared/qarar.ts`)
- Add a hardcoded exchange rate table (rates per 1 USD):

| Currency | Code | Rate |
|---|---|---|
| US Dollar | USD | 1.00 |
| UAE Dirham | AED | 3.67 |
| Saudi Riyal | SAR | 3.75 |
| Egyptian Pound | EGP | 50.0 |
| Euro | EUR | 0.92 |
| British Pound | GBP | 0.79 |
| Kuwaiti Dinar | KWD | 0.31 |
| Qatari Riyal | QAR | 3.64 |
| Bahraini Dinar | BHD | 0.376 |
| Omani Rial | OMR | 0.385 |

- Add conversion function: `convertCurrency(amount: number, from: string, to: string): number`
  - Convert from source to USD first, then from USD to target
  - Example: 49 USD → AED = 49 × 3.67 = 179.83

#### 4. Target derivation change (`shared/qarar.ts` → `deriveTargets()`)
- Add two new parameters: `inputCurrency?: string` and `accountCurrency?: string`
- Before calculating targets, convert all monetary inputs to the account currency:
  - `aov` → convert
  - `htoPrice` → convert
  - `ticketPrice` → convert
  - `marketCplBenchmark` → convert
- The rest of the calculation stays exactly the same
- When both currencies are the same (or either is missing), no conversion happens
- Return both original and converted values for display

#### 5. Settings page display
- Show the derived target CPA in BOTH currencies on the Settings page
- Example: "هدف تكلفة العميل: $49 = د.إ179.83"
- This lets the user verify the conversion is correct

#### 6. Server changes (`server/routers.ts`)
- The `funnel.save` procedure must store `inputCurrency`
- The `funnel.get` procedure must return `inputCurrency`
- When calling `deriveTargets()` on the server, pass `inputCurrency` from funnel settings and `accountCurrency` from the snapshot/account

**Constraints:**
- Hardcoded rates are acceptable — they don't change fast enough to affect CPA threshold decisions
- The exchange rate table lives in `shared/qarar.ts` so both client and server use the same rates
- Do NOT introduce an external API dependency for exchange rates
- Do not change the engine evaluation logic — only the input values change
- All existing engine tests must pass (they use USD by default — no conversion)
- New tests: USD→AED conversion, same-currency no-op, zero/null handling
- The currency selector UI must be simple Arabic

---

## Execution Plan

### ~~Batch 1: Critical fixes~~ ✅ MERGED

---

### Batch 2: Currency conversion + CPA column (one branch, one PR)
**Branch:** `fix/currency-and-cpa-column`
**Scope:** ISSUE-009 + ISSUE-004

| Issue | Files | Risk |
|---|---|---|
| ISSUE-009 (currency) | `shared/qarar.ts`, `drizzle/schema.ts`, `client/src/pages/Settings.tsx`, `server/routers.ts` | MEDIUM — touches deriveTargets() but logic unchanged, only inputs converted |
| ISSUE-004 (CPA column) | `client/src/components/DecisionTable.tsx` | LOW — display only |

**Tests required:**
- USD input + AED account → target is 3.67× the USD value
- Same currency → no conversion
- Null/zero amount → returns 0
- Conversion roundtrip accuracy
- All existing engine tests pass unchanged
- CPA column shows `cpa_3d`
- Null CPA shows "—"

**Done when:**
- Currency selector appears in Settings
- Derived targets convert to account currency
- Settings page shows target in both currencies
- CPA column matches engine evaluation
- All tests pass

---

### Batch 3: Reassess (no code)
After Batch 2 deployed:
1. User re-enters funnel settings with correct currency
2. Refresh data
3. Check data gap (ISSUE-003)
4. Check verdict distribution (ISSUE-006)

---

### Batch 4: Settings simplification
**Branch:** `feature/settings-simplification`
**Scope:** ISSUE-007

---

### Batch 5: GHL auto-provisioning
**Branch:** `feature/ghl-auto-provision`
**Scope:** ISSUE-008

---

## Batch Dependency Graph

```
Batch 1 (engine + timeout + copy) ✅ DONE
  ↓
Batch 2 (currency conversion + CPA column)
  ↓
Batch 3 (reassess — no code)
  ↓
Batch 4 (settings simplification)    [independent]
Batch 5 (GHL auto-provision)         [independent]
```

---

## Non-Negotiables (apply to every batch)

- Engine evaluation order is sacred — do not reorder rules
- Rule codes are verbatim — K1, W6, etc. exactly as written
- All user-facing copy is simple Arabic (≤ 6th grade fusha)
- Every DB query scoped by userId — no cross-user leakage
- Read-only by default — Meta writes only for pause/resume/budget with confirmation
- Fixed 5-verdict set — no new verdicts
- Offer/funnel problems route to the discovery call
- `server/_core/` machinery (sdk.ts, oauth.ts, heartbeat.ts, dataApi.ts) is untouched
- Use pnpm for all commands
- Zero TypeScript errors before merge
- All existing tests must pass before merge
