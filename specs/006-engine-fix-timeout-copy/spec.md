# Feature Specification: Engine Fix + Timeout Increase + Copy Cleanup (Batch 1)

**Feature Branch**: `fix/engine-and-timeout`

**Created**: 2026-06-28

**Status**: Draft

**Input**: User description: "Batch 1 of the Qarar Open Issues Plan — ISSUE-001 (zero-result fallthrough), ISSUE-002 Part A (dashboard.refresh timeout increase), and ISSUE-005 (remove internal 'خطوة' step labels from user-facing copy). All three are server-side, do not conflict, and ship together in one PR."

## Context

The product is live at app.adqarar.com. Three issues — one critical engine bug, one critical infrastructure timeout, and one copy-quality fix — need to ship together in a single pull request. They are all server-side and touch different concerns, so they do not conflict. This is the minimum set of fixes needed to make the live product usable for accounts that were fully reset.

## Current State

- The decision engine has 39 rules (K1–K7, CB1/CB2, F1/F2, W1–W6, S1–S4, GATE) and 174+ tests passing.
- A zero-result ad or ad set that has spent between 1× and 2× the target CPA falls through every rule and incorrectly receives "واصل" (continue): the kill rule for zero results (K1) only fires at spend ≥ 2× target, and every watch and continue rule short-circuits because CPA is `null` when there are zero conversions — so evaluation reaches the continue fallback.
- `dashboard.refresh` can exceed the platform request window and surface a Cloudflare 524 for large accounts with no cached snapshot (initial sync), because the first pull queries Meta's full account hierarchy across multiple time windows.
- Some user-facing reason strings contain internal "الخطوة N" (step N) labels (7 occurrences in the funnel-diagnosis findings) that mean nothing to end users.

> **Implementation note (verified at spec time):** The `dashboard.refresh` procedure already races its work against a `180_000` ms (180 s) timeout, and the HTTP server already sets `requestTimeout = 190_000` and `headersTimeout = 195_000`. ISSUE-002 Part A may therefore already be satisfied on this branch; the requirement below is retained so the value is asserted and verified rather than assumed. ISSUE-001 and ISSUE-005 are not yet implemented.

## Clarifications

### Session 2026-06-28

- Q: How should a zero-result **ad** at ≥ 2× target be classified, and how is the new watch catch bounded? → A: Bound the new watch/W1 catch to the 1×–2× gap (`spend ≥ 1× AND spend < 2× target`), and add a zero-result kill (reusing K1) for **ads** at `spend ≥ 2× target` so ad-level behavior reaches parity with ad sets. (Discovery: K1 currently fires only in the ad-set pipeline; `evaluateAd()` has no zero-result kill, so without this an ad at 2.5× target would wrongly become watch instead of kill.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-result ad is flagged for watching, not continued (Priority: P1)

A user opens the dashboard for an account where an ad has spent more than the target cost-per-result but produced zero results, and has not yet reached the automatic-stop threshold. Today the app tells them to "continue" with a reassuring tooltip, which burns money. The user needs the app to instead say "watch this" and explain that it will be stopped automatically if it keeps producing nothing.

**Why this priority**: This is a critical correctness bug in the core promise of the product — telling users when to stop spending. Wrongly saying "continue" on a money-losing ad directly damages user trust and budget. It is the single most important fix in this batch.

**Independent Test**: Feed the engine an ad (and separately an ad set) with zero conversions and spend at 1.5× the target. The verdict must be "watch" with rule code "W1", a reason that states money was spent with no result, and an action that warns it will be stopped automatically at 2× the target spend.

**Acceptance Scenarios**:

1. **Given** an ad with zero conversions and spend at 1.1× target, **When** the engine evaluates it, **Then** the verdict is "watch" (not "continue") with rule "W1".
2. **Given** an ad with zero conversions and spend at 1.5× target, **When** the engine evaluates it, **Then** the verdict is "watch", rule "W1", the reason reads "صرف {amount} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة", and the action reads "راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ {2× target amount} سيُوقف تلقائيًا".
3. **Given** an ad set with zero conversions and spend at 1.5× target, **When** the engine evaluates it, **Then** the verdict is "watch" with rule "W1".
4. **Given** an ad with zero conversions and spend at 2.5× target, **When** the engine evaluates it, **Then** the verdict is "kill" with rule "K1" (the new ad-level zero-result kill per FR-001b fires before the watch catch; the watch catch's exclusive upper bound at 2× ensures it does not fire here).
5. **Given** an ad with zero conversions and spend at 0.5× target, **When** the engine evaluates it, **Then** the verdict is still "too_early" (the existing data gate still catches it; the new catch must not fire below 1× target).

---

### User Story 2 - First data pull completes for large accounts without a timeout error (Priority: P1)

A user with a large ad account whose cached data was cleared triggers a refresh. The first pull takes longer than a typical request because it walks the whole account across several time windows. The user needs the refresh to be allowed enough time to finish instead of being cut off and shown a timeout error.

**Why this priority**: Without a completed first pull, the user sees no data at all — the product is unusable for them. Allowing up to three minutes covers observed large-account pull times.

**Independent Test**: Confirm the refresh procedure's internal timeout and the HTTP server's request timeout are configured to at least 180 seconds (3 minutes), so a pull that takes up to that long is not severed prematurely.

**Acceptance Scenarios**:

1. **Given** a large account with no cached snapshot, **When** the user triggers a refresh that takes up to ~180 seconds, **Then** the request is allowed to run to completion rather than being aborted before 180 seconds.
2. **Given** a refresh that genuinely exceeds the allotted time, **When** the timeout fires, **Then** the user sees the existing friendly Arabic timeout message (unchanged) rather than a raw gateway error, and may retry.

---

### User Story 3 - User-facing copy contains no internal step labels (Priority: P2)

A user reads a diagnosis tooltip explaining what is wrong with an ad's funnel. Today some of these messages begin with "الخطوة 6 —" (step 6), which is an engine-internal label that means nothing to them. The user needs the message to read as plain advice, with the internal numbering removed.

**Why this priority**: This is a copy-quality issue, not a correctness or availability issue, so it ranks below the two P1 fixes. It still matters because leaked internal labels undermine the product's "simple Arabic, no jargon" promise.

**Independent Test**: Search all engine output strings (reason and action fields and the findings they feed) for the token "خطوة". There must be zero matches. Re-run the full engine test suite to confirm no verdict, rule, threshold, or ordering changed.

**Acceptance Scenarios**:

1. **Given** any object whose diagnosis previously produced a finding beginning with "الخطوة N —", **When** the engine evaluates it after the fix, **Then** the same finding's meaning is preserved but the "الخطوة N —" prefix is gone.
2. **Given** the complete set of engine reason, action, and finding strings, **When** searched for "خطوة", **Then** there are zero matches.
3. **Given** the modified strings, **When** read by an Arabic speaker, **Then** they remain simple Modern Standard Arabic readable at a 6th-grade level.

---

### Edge Cases

- **Zero-result catch boundary at exactly 1× target**: spend exactly equal to 1× target with zero conversions must fire the new watch catch (the condition is spend ≥ 1× target), provided no earlier rule already fired.
- **Zero-result catch boundary at exactly 2× target**: spend at exactly 2× target with zero conversions is claimed by K1 (kill) — for ad sets by the existing `killRulesAdset` K1, and for ads by the new ad-level K1 parity (FR-001b). The watch catch's exclusive upper bound (< 2×) guarantees it never fires at or above 2× target.
- **Object still in the data gate (below the impression/spend gate)**: a zero-result object that has not yet cleared the "too_early" gate must continue to return "too_early"; the new catch must sit after the gate so gated objects are never reclassified as "watch".
- **CPA is null but conversions > 0**: not applicable — the new catch only fires when conversions are exactly zero; objects with conversions are handled by existing CPA-based rules.
- **Paused / inactive object**: continues to return the existing paused "too_early" gate message; the new catch must not override it.
- **Refresh that fails for a non-timeout reason** (auth expired, rate limited, upstream error): existing error handling and messages are unchanged by the timeout adjustment.

## Requirements *(mandatory)*

### Functional Requirements

**ISSUE-001 — Zero-result fallthrough catch**

- **FR-001**: The engine MUST add a watch-level catch that fires when an object has spend ≥ 1× the unit target AND spend < 2× the unit target AND conversions equal exactly zero AND CPA is null (no results from which to compute CPA). The catch is bounded to the 1×–2× gap; the lower bound is inclusive (≥ 1×) and the upper bound is exclusive (< 2×), because zero-result objects at or above 2× target are handled by the kill path (K1 / FR-001b).
- **FR-001b**: To reach parity with the ad-set pipeline, the ad evaluation pipeline MUST kill a zero-result ad at spend ≥ 2× the unit target with verdict "kill" and rule code "K1" (reusing the existing K1 logic and copy already applied to ad sets; no new rule code is introduced). This kill MUST evaluate before the new watch catch so a zero-result ad at ≥ 2× target gets "kill", not "watch".
- **FR-002**: The new watch catch MUST evaluate AFTER all existing watch rules (W1–W6) and BEFORE the continue/scale fallback, in both the ad evaluation pipeline and the ad-set evaluation pipeline.
- **FR-003**: When the watch catch fires, the verdict MUST be "watch" and the rule code MUST be the existing "W1" (reused — this is a variant of "slightly above target"); no new rule code is introduced.
- **FR-004**: The reason string MUST be "صرف {money(spend)} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة" and the action string MUST be "راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ {money(2 × target)} سيُوقف تلقائيًا", with monetary values rendered in the account's currency.
- **FR-005**: The change MUST be purely additive — no existing rule's logic, thresholds, evaluation order, or rule code may change. The new coverage (the watch catch and the ad-level K1 parity) only fills previously uncovered gaps; it reuses existing rule codes (W1, K1) and does not reorder or alter any existing rule.

**ISSUE-002 Part A — Refresh timeout increase**

- **FR-006**: The `dashboard.refresh` procedure's internal timeout MUST be set to 180 seconds (3 minutes).
- **FR-007**: Any global/HTTP server request timeout that could sever the refresh MUST be at least 180 seconds (with a buffer above the procedure timeout so the procedure's own timeout message wins).
- **FR-008**: If an AbortController or equivalent cancellation timer governs the Meta fetch, its timeout MUST match (≥ 180 seconds).
- **FR-009**: The existing Arabic timeout error message MUST remain unchanged; it should simply fire less often.

**ISSUE-005 — Remove internal step labels**

- **FR-010**: Every user-facing reason, action, and finding string produced by the engine MUST contain zero occurrences of the token "خطوة".
- **FR-011**: Removing a step label MUST preserve the rule's meaning — only the internal "الخطوة N —" prefix/label is stripped or rephrased (e.g. "الخطوة 6 — تكلفة العميل أعلى…" → "تكلفة العميل أعلى…").
- **FR-012**: The internal step-numbering system MUST remain available to developers as code comments; it is removed only from strings end users can see.
- **FR-013**: Every modified string MUST remain simple Modern Standard Arabic readable at a 6th-grade level.

**Cross-cutting constraints (apply to all of the above)**

- **FR-014**: No changes may be made to the evaluation order of any existing rule.
- **FR-015**: No changes may be made to any existing rule's thresholds, logic, or rule code.
- **FR-016**: No files outside the server may change; specifically, no client/ files, no drizzle/ schema files, and nothing in the Meta OAuth flow.
- **FR-017**: Within server/_core/, only timeout configuration may change; all other machinery (sdk, oauth, heartbeat, dataApi) stays untouched.
- **FR-018**: All 174+ existing engine tests MUST continue to pass unchanged, and the project MUST compile with zero type errors.

### Key Entities *(include if feature involves data)*

- **Verdict**: One of the fixed five — kill, watch, continue, rescue, too_early. This batch produces only existing verdict values; no new verdict is added.
- **Rule firing**: The engine's output for one object — a verdict, a rule code (e.g. W1, K1, GATE), a reason string, and an action string. The new catch produces a watch firing with rule code W1.
- **Evaluated object**: An ad or an ad set carrying a 3-day rolling window of spend, conversions, and derived CPA, plus a derived unit target. The new catch keys off spend vs. target and zero conversions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A zero-result ad at 1.1× target is shown as "watch", not "continue".
- **SC-002**: A zero-result ad at 2.5× target is shown as "kill" with rule "K1" (ad-level parity per FR-001b; ad sets already behaved this way). A zero-result ad just below 2× target (e.g. 1.9×) is shown as "watch"/"W1", confirming the catch's exclusive upper bound.
- **SC-003**: A zero-result ad at 0.5× target is still shown as "too_early" (existing data gate unchanged).
- **SC-004**: A zero-result ad set at 1.5× target is shown as "watch" with rule "W1".
- **SC-005**: The `dashboard.refresh` timeout is 180 seconds, and a large-account first pull taking up to ~180 seconds completes instead of erroring.
- **SC-006**: A search for "خطوة" across all engine reason, action, and finding output strings returns zero matches.
- **SC-007**: All 174+ existing engine tests pass with no modification, and the project compiles with zero type errors.
- **SC-008**: New automated tests exist and pass for: zero-result ad at 1.5× target → watch/W1; zero-result ad at 0.5× target → too_early; zero-result ad at 2.5× target → kill/K1; zero-result ad set at 1.5× target → watch.
- **SC-009**: No existing rule's evaluation order or thresholds changed (verified by the unchanged passing test suite and code review).

## Assumptions

- "Target" / "unit target" refers to the engine's derived `unitTarget` (the derived cost-per-result threshold); the new catch compares 3-day-window spend against it. Multiples (1×, 2×) are of that derived target.
- "Spend" and "conversions" in the new catch use the same 3-day rolling window the surrounding watch rules already use, so the catch is consistent with adjacent rules.
- The new catch reuses rule code "W1" as instructed; the existing W1 (CPA between 1×–1.5× target) and the new zero-result variant are mutually exclusive at runtime because the existing W1 requires a non-null CPA while the new catch requires a null CPA, so the same code never produces two different firings for one object.
- The ad-level zero-result kill (FR-001b) reuses the existing K1 logic and copy already present in the ad-set pipeline (`killRulesAdset`), keeping ad and ad-set behavior symmetric. No new rule code is introduced and no existing rule is reordered; the K1 check is simply also reachable from the ad pipeline. This was added because the original issue description assumed ads were already killed at 2× zero results, but the engine only killed ad sets — see the Session 2026-06-28 clarification.
- ISSUE-002 Part B (background-refresh/polling pattern) is explicitly out of scope for this batch; only Part A (timeout increase) is included. Part A is considered sufficient for this release.
- The timeout values found on the branch at spec time (180 s procedure, 190 s request, 195 s headers) are treated as the intended target; the requirement asserts and verifies them rather than necessarily changing them.
- "خطوة" occurrences are confined to engine output strings (currently in the funnel-diagnosis findings); no occurrences exist in code that users cannot see except comments, which are intentionally retained.
- Verification commands are the project's existing `pnpm`/`npm` test and type-check scripts (`test` and `check` per the constitution); no new tooling is introduced.

## Out of Scope

- ISSUE-002 Part B (background refresh job + client polling).
- ISSUE-003 (new ad sets not appearing) — expected to be reassessed after this batch, no code here.
- ISSUE-004 (CPA column display) — Batch 2, client-only.
- ISSUE-006 (too many kills) — diagnosis only, after this batch.
- ISSUE-007 (settings simplification) and ISSUE-008 (GHL auto-provisioning) — later batches.
- Any change to client/ UI, drizzle/ schema, the Meta OAuth flow, or `server/_core/` machinery other than timeout configuration.
