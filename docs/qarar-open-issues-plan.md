# Qarar (قرار) — Open Issues Plan
## Post-Auth Stabilization & Feature Completion

**Version:** 1.0
**Date:** June 28, 2026
**Status:** All four auth phases (A–D) are merged and deployed. The product is live at app.adqarar.com with Better Auth, subscription gating, GHL webhook, and Arabic RTL login UI. This document covers everything that remains.

---

## Current State

### What works
- Better Auth login/signup with email + password
- Subscription gating (inactive users see upgrade screen)
- Admin auto-elevation via ADMIN_EMAIL
- GHL webhook endpoint (ready, not yet configured in GHL)
- Meta OAuth connection (redirect URIs updated for app.adqarar.com)
- Decision engine with 39 rules (K1–K7, CB1/CB2, F1/F2, W1–W6, S1–S4, GATE)
- Dark Arabic RTL UI with branded split login screen
- Demo mode with synthetic data
- Password reset and email verification (added by Manus)
- 174 tests passing

### What is broken or incomplete
- Engine verdict bugs (zero-result fallthrough, CPA column mismatch)
- Cloudflare 524 timeout on first data pull
- New ad sets not appearing after publish
- Internal step labels leaking into Arabic copy
- Settings page collects unnecessary data
- GHL → auto-create-user flow not built
- "خطوة" labels in user-facing messages

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

### ISSUE-001: Engine verdict bug — zero-result fallthrough
**Priority:** 🔴 CRITICAL
**Category:** Engine logic
**Files:** `server/engine.ts`

**Problem:**
When an ad has zero conversions and has spent between 1× and 2× the target CPA, it falls through every rule and defaults to "واصل" (continue). This is because:
- K1 (kill for zero results) only fires at spend ≥ 2× target
- Every watch rule (W1–W6) checks `cpa !== null` — but CPA is null when conversions are zero
- Every continue rule (S1–S4) checks `cpa !== null`
- The ad hits the default return of `continueRules()` which returns a continue verdict

**Evidence from live account:**
- Ad "C-V10 فكرتك حبيسة الدرج": cost 58.9 AED, results 0, CTR 0.89%
- Target: ~53 AED (derived from user's $25 input)
- Verdict: 🟢 واصل (continue) with tooltip "واصل بحذر — الحساب متعادل"
- Expected: 🟡 راقب (watch) — spending money with no results but hasn't hit kill threshold

**Root cause in code:**
In `watchRules()`, W1 checks `cpa > target * 1.2` — but CPA is null (0 conversions), so it skips.
In `continueRules()`, S1/S2/S3/S4 all check `cpaAtOrUnder = cpa !== null && cpa <= target` — null, so all skip.
The function falls to a default return that gives "continue."

**Required fix:**
Add a new watch-level catch BEFORE the continue rules fallback in both `evaluateAd()` and `evaluateAdset()`:

```
If spend >= 1× unitTarget AND conversions === 0:
  → verdict: "watch"
  → rule: "W1" (or a new code if preferred — but W1 "slightly above target" is closest)
  → reason: "صرف {money(spend)} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة"
  → action: "راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ {money(2 * target)} سيُوقف تلقائيًا"
```

This rule must fire AFTER all existing watch rules (W1–W6) and BEFORE `continueRules()`.

**Constraints:**
- Do not change the evaluation order for any existing rule
- Do not modify any existing rule's logic or thresholds
- This is purely additive — a new catch for a gap in coverage
- Must add tests for this exact scenario (0 conversions, spend between 1× and 2× target)

---

### ISSUE-002: Cloudflare 524 timeout on dashboard.refresh
**Priority:** 🔴 CRITICAL
**Category:** Server infrastructure
**Files:** `server/routers.ts`, `server/_core/index.ts`

**Problem:**
The `dashboard.refresh` tRPC procedure times out when pulling Meta insights for a large account with no cached snapshots. The request takes >100 seconds, Cloudflare kills it at 100s with a 524 error.

**Evidence:**
- Request: `POST /api/trpc/dashboard.refresh?batch=1`
- Status: 408 Request Timeout after 25.6 seconds (server timeout)
- Then Cloudflare 524 on retry attempts
- Error message: "استغرق تحميل البيانات وقتًا طويلًا"

**Root cause:**
The full user reset (Phase A/B) wiped all cached snapshots. The first data pull queries Meta's API for the full account hierarchy (campaigns → ad sets → ads) with multiple time windows (today, 3d, 7d, 14d, 30d, 90d baselines). For large accounts this exceeds the server timeout.

**Required fix — two-part:**

Part A — Increase server timeout:
- Find the timeout configuration in `server/routers.ts` for the refresh procedure
- Increase to 180 seconds (3 minutes)
- Check if there's a global Express timeout in `server/_core/index.ts` that also needs increasing
- Ensure the AbortController (if used) has a matching 180-second timeout

Part B — Background refresh pattern (recommended):
- Instead of blocking the HTTP request while Meta API responds, start the refresh as a background job
- Return immediately with `{ status: "refreshing" }` 
- The client polls for completion (e.g. every 5 seconds)
- When done, the client refreshes the dashboard data from cache
- This completely avoids the Cloudflare timeout issue

**Constraints:**
- Do not change the engine evaluation logic
- Do not change the Meta API query structure (it needs all windows for accurate verdicts)
- The refresh endpoint must remain user-triggered (Constitution §V: read-only by default)
- Part A is sufficient for MVP; Part B is the proper long-term solution

---

### ISSUE-003: New ad sets not appearing after publish
**Priority:** 🔴 CRITICAL (but likely resolves with ISSUE-002)
**Category:** Data freshness
**Files:** Likely same as ISSUE-002

**Problem:**
An ad set published on June 22 does not appear in the app on June 23.

**Root cause (hypothesis):**
The refresh fails silently due to the timeout (ISSUE-002). Since the refresh never completes, new ads are never pulled from Meta and never cached.

**Action:**
Verify this resolves after fixing ISSUE-002. If it doesn't, investigate whether:
- The Meta API query filters out newly created objects
- The snapshot caching logic skips objects below a certain spend/impression threshold
- The normalization layer drops objects with no data

**No spec needed until ISSUE-002 is fixed and verified.**

---

### ISSUE-004: CPA column shows different number than engine used
**Priority:** 🟡 IMPORTANT
**Category:** UI data consistency
**Files:** `client/src/components/DecisionTable.tsx`

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

### ISSUE-005: Internal step labels in user-facing messages
**Priority:** 🟡 IMPORTANT
**Category:** Arabic copy
**Files:** `server/engine.ts` (copy only, no logic)

**Problem:**
Some user-facing reason and action strings contain internal references like "خطوة 2" or "خطوة 6" which mean nothing to the user. These are engine-internal step labels.

**Required fix:**
- Search `server/engine.ts` for all occurrences of "خطوة" in reason/action strings
- Remove or rephrase them. The rule's meaning must be preserved — only the internal label is removed
- Example: "خطوة 6: تكلفة العميل أعلى..." → "تكلفة العميل أعلى..."
- The step numbering system stays in code comments for developer reference — it is only removed from strings that users see

**Constraints:**
- Do not change any rule logic, thresholds, or evaluation order
- Do not change rule codes (K1, W6, etc.)
- Only modify string literals inside `reason` and `action` fields
- Every modified string must remain simple Arabic (≤ 6th grade)
- Must run existing engine tests to confirm no logic regression

---

### ISSUE-006: Too many "اقفل" (kill) verdicts
**Priority:** 🟡 IMPORTANT (diagnose after ISSUE-001 and ISSUE-004)
**Category:** Engine calibration
**Files:** `server/engine.ts` (investigation only — no changes until diagnosed)

**Problem:**
The user reports that most ads are getting killed. Very few get "واصل" or "كمّل". This could be:
1. Correct — the ads genuinely underperform against the target
2. A target derivation issue — the derived target is too low, so everything looks expensive
3. A date range issue — the engine uses 3-day rolling, which might not represent actual performance
4. A threshold issue — kill thresholds might be too aggressive

**Action plan:**
1. Fix ISSUE-001 first (zero-result fallthrough)
2. Fix ISSUE-004 (CPA column alignment)
3. Re-evaluate with the user's live data
4. If still too many kills, compare the derived target (`unitTarget`) against what the user intended
5. Review kill thresholds K1 (2× target), K2 (consistent overspend), K6 (2× CPA median), K7 (70% of full buyer value)

**No spec until ISSUE-001 and ISSUE-004 are fixed.** This may resolve itself.

---

### ISSUE-007: Settings page collects unnecessary data
**Priority:** 🟢 FEATURE
**Category:** UX simplification
**Files:** `client/src/pages/Settings.tsx`, possibly `server/routers.ts`

**Problem:**
The settings page asks for targeting options, countries, etc. that have no effect on engine decisions. The only inputs the engine uses are:
- `archetype`: "free_lead" or "paid" (funnel type — determines CPA target calculation)
- `productPrice`: price of the product/service
- `costPerUnit`: cost to deliver
- `avgOrdersPerCustomer`: repeat purchase multiplier
- `ltoPrice` / `ltoTakeRate`: for low-ticket-offer funnels
- `htoUnderperforming`: flag for W5 funnel diagnosis

Everything else (targeting, countries, demographics, etc.) is noise that confuses non-technical users.

**Required fix:**
- Remove or collapse unnecessary fields in the settings UI
- Keep only the fields the engine actually reads from `FunnelInputs`
- Group them logically:
  1. "ما نوع الفانل؟" (funnel type — paid or free lead)
  2. "كم سعر المنتج/الخدمة؟" (product price)
  3. "كم تكلفة التوصيل/التقديم؟" (cost per unit)
  4. "كم مرة يشتري العميل عادةً؟" (repeat orders)
- Add simple Arabic labels with examples
- This is a UI-only change — the server schema and engine logic stay exactly the same

**Constraints:**
- Do not change `FunnelInputs` type definition
- Do not change `deriveTargets()` logic
- Do not change any engine rule
- Keep all existing fields in the database — just hide them from the UI

---

### ISSUE-008: GHL purchase → auto-create user flow
**Priority:** 🟢 FEATURE
**Category:** User onboarding automation
**Files:** `server/ghl-webhook.ts`, `server/auth.ts`, `server/passwordReset.ts`

**Problem:**
The current flow requires manual steps:
1. User signs up at app.adqarar.com
2. Admin manually activates them (or future: GHL webhook activates by matching email)

The desired flow:
1. Buyer enters email on GHL sales page → pays
2. GHL fires webhook to `/api/webhooks/ghl`
3. The webhook handler:
   a. Checks if user exists by email
   b. If not → creates a new Better Auth user with `subscriptionStatus: "active"` and a random temporary password
   c. Generates a password-reset token
   d. Returns the set-password URL in the webhook response (or stores it for GHL to send via email)
4. GHL automation sends the buyer an email with the set-password link
5. Buyer clicks link → sets their password → logs in at app.adqarar.com
6. They're already active (step 3b set it) → they see the dashboard immediately

**Dependencies:**
- `server/passwordReset.ts` already exists (Manus added it)
- Better Auth user creation is already implemented
- GHL webhook handler already processes payment events

**What needs to be built:**
- Auto-user-creation logic in the webhook handler (when email not found in DB)
- Password-reset token generation for the new user
- A way to get the set-password URL back to GHL (either in the webhook response body, or stored for retrieval)
- GHL workflow configuration to send the set-password email (manual step, not code)

**Constraints:**
- The set-password URL must point to `https://app.adqarar.com/auth/reset-password?token=<token>`
- The new user must have `subscriptionStatus: "active"` from creation (they paid)
- If the user already exists, just activate them (existing behavior)
- The password reset token must have a reasonable expiry (e.g. 72 hours)
- Must handle edge cases: duplicate webhook fires, GHL retry after timeout
- No changes to the engine

---

## Execution Plan

### Batch 1: Critical fixes (one branch, one PR)
**Branch:** `fix/engine-and-timeout`
**Scope:** ISSUE-001 + ISSUE-002 (Part A) + ISSUE-005

These three are all server-side, don't conflict, and are the minimum needed to make the product usable.

| Issue | Files | Risk |
|---|---|---|
| ISSUE-001 (zero-result gap) | `server/engine.ts` | LOW — additive rule, existing tests verify no regression |
| ISSUE-002 Part A (timeout) | `server/routers.ts`, `server/_core/index.ts` | LOW — config change |
| ISSUE-005 (step labels) | `server/engine.ts` | LOW — string-only changes, tests verify logic unchanged |

**Tests required:**
- New test: ad with 0 conversions, spend between 1× and 2× target → verdict "watch"
- New test: ad with 0 conversions, spend < 1× target → verdict "too_early" (existing gate behavior, but confirm)
- Existing engine tests must all still pass (39+ tests)
- Grep for "خطوة" in engine output to confirm all removed

**Done when:**
- Zero-result ad at 1.1× target gets "راقب" not "واصل"
- Dashboard.refresh completes for large accounts without timeout
- No "خطوة" appears in any user-facing tooltip or message
- All existing tests pass

---

### Batch 2: UI alignment (one branch, one PR)
**Branch:** `fix/ui-alignment`
**Scope:** ISSUE-004 + duplicate logo removal (if not already merged)

| Issue | Files | Risk |
|---|---|---|
| ISSUE-004 (CPA column) | `client/src/components/DecisionTable.tsx` | LOW — display only |

**Done when:**
- CPA column shows `cpa_3d` from engine output
- Null CPA shows "—" not red infinity
- Column header indicates 3-day window

---

### Batch 3: Reassess (no code — diagnosis only)
**Scope:** ISSUE-006 (too many kills) + ISSUE-003 (data gap)

After Batch 1 and 2 are deployed:
1. User refreshes data on the live account
2. Check if new ad sets now appear (ISSUE-003)
3. Check if verdict distribution looks reasonable (ISSUE-006)
4. If still broken, create targeted specs for each

---

### Batch 4: Settings simplification (one branch, one PR)
**Branch:** `feature/settings-simplification`
**Scope:** ISSUE-007

Frontend-only change. Remove unnecessary fields, keep only what the engine uses. Low risk, no engine changes.

---

### Batch 5: GHL auto-provisioning (one branch, one PR)
**Branch:** `feature/ghl-auto-provision`
**Scope:** ISSUE-008

Server-side change. Extends the existing webhook handler. Depends on password reset infrastructure (already built by Manus).

After code is deployed, the manual GHL configuration step follows:
1. Create webhook in GHL settings
2. Set signing key
3. Build GHL automation to send the set-password email

---

## Batch Dependency Graph

```
Batch 1 (engine + timeout + copy)
  ↓
Batch 2 (UI alignment)
  ↓
Batch 3 (reassess — no code)
  ↓
Batch 4 (settings simplification)    [independent]
Batch 5 (GHL auto-provision)         [independent]
```

Batches 4 and 5 are independent of each other and can run in parallel after Batch 3.

---

## Files Reference

| File | What it does | Touched by |
|---|---|---|
| `server/engine.ts` | Decision engine — 39 rules | Batch 1 (ISSUE-001, ISSUE-005) |
| `server/routers.ts` | tRPC procedures incl. dashboard.refresh | Batch 1 (ISSUE-002) |
| `server/_core/index.ts` | Express entry point, timeouts | Batch 1 (ISSUE-002) |
| `client/src/components/DecisionTable.tsx` | Dashboard table | Batch 2 (ISSUE-004) |
| `client/src/pages/Settings.tsx` | Funnel settings UI | Batch 4 (ISSUE-007) |
| `server/ghl-webhook.ts` | GHL webhook handler | Batch 5 (ISSUE-008) |
| `server/auth.ts` | Better Auth config | Batch 5 (ISSUE-008) |
| `server/passwordReset.ts` | Password reset logic | Batch 5 (ISSUE-008) |
| `shared/qarar.ts` | Shared types, rule catalog | Reference only |
| `.specify/memory/constitution.md` | Constitutional principles | Reference only |

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
