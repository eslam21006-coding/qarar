# Feature Specification: Fast Refresh & Trustworthy Funnel Settings

**Feature Branch**: `fix/refresh-perf-and-settings-data`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "Two related fixes to Meta insights refresh: (A) parallelize slow sequential API calls, (B) diagnose and fix funnel settings appearing blank after some time."

## Overview

Two defects degrade trust in the product:

- **Part A — Refresh is slow.** Building an account snapshot fetches insights for 3 levels (campaign / adset / ad) across 3 time windows (3-day, today, last-30-days) — 9 calls to Meta. They ran one after another, so every refresh paid the sum of all nine round-trips (~60+ seconds) and often hit the timeout. Nothing about the data requires them to be ordered.
- **Part B — Saved funnel settings appear to vanish.** Users who saved their funnel economics (AOV, HTO price, HTO conversion rate, …) later open Settings and see starting values instead. Funnel settings have **no TTL or expiry anywhere** — they are designed to persist indefinitely until edited. The values are not aging out; something in the read path is failing to find them.

Part B **must be root-caused with evidence before any fix is written.** Adding a retention/TTL mechanism would solve a problem that does not exist and is explicitly out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Refresh finishes in seconds, not minutes (Priority: P1)

A user opens their dashboard and taps refresh. Today they wait a minute or more, and often hit the timeout. They should get updated decisions in a few seconds, with **exactly the same numbers** they would have seen before.

**Why this priority**: The wait is the most visible product failure — it makes refresh feel broken and pushes users into the timeout error state. It is also the lowest-risk change: the fix is about *when* calls happen, not *what* they return.

**Independent Test**: Refresh an account and compare (a) wall-clock time against the previous behavior, and (b) the resulting snapshot against one produced by the old sequential path — every field must be identical.

**Acceptance Scenarios**:

1. **Given** an account requiring all 9 insight fetches, **When** the user refreshes, **Then** the snapshot is field-for-field identical to what the sequential implementation produced for the same inputs.
2. **Given** the same account, **When** the user refreshes, **Then** total time is close to the slowest single fetch rather than the sum of all nine.
3. **Given** Meta rate-limits one of the fetches, **When** the refresh runs, **Then** the user sees the same rate-limit outcome as before this change.
4. **Given** Meta fails one fetch with an auth error, **When** the refresh runs, **Then** the user is asked to reconnect, exactly as before.
5. **Given** any single fetch fails, **When** the refresh runs, **Then** the refresh fails as a whole and no partial snapshot is saved.

---

### User Story 2 - Prove why saved settings show as blank (Priority: P1)

Before anything is changed, an engineer must be able to state — with evidence — the exact mechanism by which a user who saved funnel settings later sees starting values. Specifically: is the saved record still stored, and if so, why did the lookup not find it?

**Why this priority**: This is a *diagnosis gate*. Several plausible theories survive code reading (below), and they imply **different fixes**. Fixing all of them at once would ship unnecessary changes and could mask the real cause. No Part B fix may be written until this story produces a confirmed root cause.

**Independent Test**: Take a real affected user, inspect stored records directly, and determine whether the settings record still exists and what it is keyed to versus what the screen asked for. Done when the failure is explained and can be re-triggered on demand.

**Acceptance Scenarios**:

1. **Given** a user reports blank settings, **When** stored records are inspected, **Then** the investigation states definitively whether the record still exists (read bug) or is genuinely gone (data-loss bug).
2. **Given** the record still exists, **When** the failing load is traced, **Then** the investigation reports which account the screen requested and which account the record is attached to, and whether they match.
3. **Given** the record still exists, **When** the account it points to is checked, **Then** the investigation reports whether that account still exists — i.e. whether the record has been left pointing at an account that is gone.
4. **Given** the stored records are inspected, **When** they are counted per user and account, **Then** the investigation reports whether more than one settings record exists for the same user and account.
5. **Given** a candidate cause, **When** it is deliberately triggered, **Then** the blank-settings symptom reproduces — confirming causation, not correlation.
6. **Given** the investigation completes, **When** findings are written up, **Then** each rejected theory is recorded as ruled out **with the evidence that ruled it out**.

---

### User Story 3 - A failed read never masquerades as "you have no settings" (Priority: P1)

When the system cannot load a user's saved settings — for any reason — the user must be told that loading failed. They must never be shown starting values that look like a real, saved configuration.

**Why this priority**: This is the harm the user experiences. Presenting defaults as if they were the user's own saved numbers is worse than an error: the user believes their work was erased, and wrong economics silently feed the decision engine. This story is worth doing **on its own merits regardless of what US2 concludes**, because a failed load must never be indistinguishable from an empty one.

**Independent Test**: Force the settings lookup to fail, open Settings, and confirm a clear failure state with a retry — never a form pre-filled with defaults.

**Acceptance Scenarios**:

1. **Given** the settings lookup fails, **When** the user opens Settings, **Then** they see an explicit "couldn't load your settings" state with a retry action — not a form pre-filled with starting values.
2. **Given** the settings lookup fails, **When** the user is on that screen, **Then** saving is not possible, so a failed read cannot become a bad write.
3. **Given** an account that genuinely never had settings saved, **When** the user opens Settings, **Then** they still get the normal first-time experience with starting values — this must remain distinguishable from a failure.
4. **Given** the user's session has expired, **When** they open Settings, **Then** they are prompted to sign in again rather than shown starting values.

---

### User Story 4 - Saved settings cannot be silently overwritten with defaults (Priority: P2)

A user whose screen is showing starting values (because a load failed) must not be able to overwrite their real saved settings with those values by pressing Save.

**Why this priority**: This converts a temporary display bug into permanent data loss, and likely explains reports where settings were *really* gone rather than merely mis-displayed. It is lower priority only because Story 3 removes the main way to reach this state.

**Independent Test**: Put the screen into the failed-load state, attempt to save, and confirm the stored record is unchanged.

**Acceptance Scenarios**:

1. **Given** the settings screen never successfully loaded the user's saved values, **When** a save is attempted, **Then** the existing stored values are left untouched.
2. **Given** settings loaded correctly and the user edits one field, **When** they save, **Then** the save succeeds as it does today.
3. **Given** a user double-submits a save, **When** both saves are processed, **Then** the user still ends up with exactly one settings record for that account.

---

### Edge Cases

- **Transient backend unavailability**: a momentary failure to reach storage must surface as "couldn't load", never as "no settings found". These are currently indistinguishable to the user and must be separated.
- **Session expiry while the tab is open**: the "after some time" in the bug report points at session/gating expiry. An expired session must produce a sign-in prompt, not starting values.
- **A settings record pointing at an account that no longer exists**: must be detected by the investigation, and must not simply read as "no settings".
- **More than one settings record for the same user and account**: reads must not be free to pick an arbitrary one.
- **User has several ad accounts (including the demo account)**: opening Settings for account X must never show account Y's settings, nor read blank because it looked at Y.
- **Account genuinely has no saved settings**: must still show first-time starting values — the fix must not turn a legitimate empty state into a scary error.
- **Refresh for an account with no campaigns/adsets/ads**: concurrent fetching must handle empty results exactly as the sequential version did.
- **Several of the 9 fetches fail at once**: the user gets one clear error, reported the same way a single failure is today.

## Requirements *(mandatory)*

### Functional Requirements

#### Part A — Refresh performance

- **FR-001**: Snapshot building MUST issue the 9 insight fetches (3 levels × 3 time windows) concurrently rather than awaiting each before starting the next.
- **FR-002**: The resulting snapshot MUST be identical to what the sequential implementation produced for the same inputs. This is a timing-only change; no value, rounding, ordering, or field may differ.
- **FR-003**: Existing rate-limit handling MUST be preserved — a rate-limited fetch produces the same user-visible outcome as before.
- **FR-004**: If any fetch fails, refresh MUST fail as a whole, with the same error classification (rate-limited / reconnect-required / upstream failure) and the same error UI as today. No partial snapshot may be persisted.
- **FR-005**: The existing 180-second outer timeout on the interactive refresh MUST remain unchanged.
- **FR-006**: Baseline and hierarchy fetching MUST NOT be modified unless strictly required by the change.
- **FR-007**: Concurrency MUST NOT introduce new rate-limiting. If issuing these calls together causes Meta to rate-limit where it previously did not, that MUST be reported as a finding rather than silently reintroducing the delay.

#### Part B — Investigation (blocks all Part B fixes)

- **FR-008**: The team MUST determine, with evidence, whether a saved settings record still exists when the user sees blanks — establishing read bug versus genuine deletion — **before** any Part B fix is written.
- **FR-009**: The investigation MUST record which account the Settings screen requested and which account the saved record is attached to, and whether they matched.
- **FR-010**: The investigation MUST determine whether settings records can be left pointing at an ad-account record that no longer exists, and if so, by what path that account record disappeared or was replaced.
- **FR-011**: The investigation MUST verify that every path that creates or updates ad-account records preserves the identity of an existing account — so that a re-sync cannot detach a user's settings from their account. This must cover **all** such paths, not only the main sync flow.
- **FR-012**: The investigation MUST determine whether duplicate settings records can exist for the same user and account, and whether a read could return the wrong one.
- **FR-013**: The investigation MUST determine whether the identity a user's records are keyed to can change across a re-login or re-provision, which would orphan both their accounts and their settings.
- **FR-014**: Findings MUST be written up with evidence, including theories ruled **out** and what ruled them out.
- **FR-015**: Only the confirmed root cause MAY be fixed. Speculative fixes for unconfirmed theories MUST NOT be shipped in this feature.
- **FR-016**: No TTL, expiry, retention window, or cleanup job may be introduced for funnel settings. Settings persist indefinitely until the user edits them — this is intended and is not the problem.

#### Part B — Fix

- **FR-017**: The system MUST distinguish "this account has no saved settings" from "we could not load the saved settings", and MUST NOT collapse the two into the same outcome.
- **FR-018**: When settings cannot be loaded, the user MUST see an explicit failure state with a retry action, in simple Arabic, and MUST NOT see a form populated with starting values.
- **FR-019**: When settings cannot be loaded, saving MUST be blocked so that starting values cannot overwrite a real saved record.
- **FR-020**: A user opening Settings for an account that has genuinely never been configured MUST still get the first-time starting-values experience.
- **FR-021**: An expired session MUST lead to a sign-in prompt rather than a starting-values form.
- **FR-022**: A user MUST end up with at most one settings record per ad account, even if a save is submitted twice.
- **FR-023**: Settings reads and writes MUST remain scoped to the owning user, with no cross-user or cross-account leakage.
- **FR-024**: Any fix that changes how settings are linked to an ad account MUST preserve every existing saved record — no user may lose settings as a result of this work.

### Key Entities

- **Funnel settings**: a user's per-ad-account funnel economics (offer type, AOV, HTO price, HTO conversion rate, front-end ROAS, budget, currency of entry, plus qualitative inputs). Intended as one record per (user, ad account). Persists indefinitely until edited. Feeds the decision engine's targets.
- **Ad account**: a Meta advertising account belonging to a user, kept in sync with Meta. It has both a **stable Meta identifier** and a **separate internal identifier**. Funnel settings are attached via the internal identifier — so anything that changes an account's internal identity endangers the link to its settings.
- **Account snapshot**: the cached picture of an account's performance, assembled from insight fetches across three levels and three time windows. Reads serve from this cache; Meta is contacted only on refresh.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A refresh that previously took 60+ seconds completes in under 15 seconds for a typical account.
- **SC-002**: Refreshes that failed purely by hitting the timeout drop to zero.
- **SC-003**: Snapshots produced after the change are identical to those produced before it for the same inputs — verified by comparison, with zero differing fields.
- **SC-004**: The blank-settings failure can be explained and deliberately reproduced on demand before any fix is written.
- **SC-005**: After the fix, a user who saved settings never sees starting values presented as their own — a failed load always says so.
- **SC-006**: Zero cases where a user's saved settings are overwritten by values they never entered.
- **SC-007**: Every settings record that exists today is still readable by its owner after the fix ships.
- **SC-008**: Support reports of "my settings disappeared" go to zero.

## Assumptions

- Part A's concurrent-fetch change has already landed on this branch. This spec covers it so it can be verified and reviewed against explicit criteria rather than re-derived; the remaining Part A work is verification, not implementation.
- "Blank/default" in the bug report means the Settings form shows starting values (not empty boxes), which a user reasonably reads as "my settings were reset".
- The decision engine, verdict pipeline, and the five-verdict vocabulary are untouched by this work.
- Settings storage remains unlimited by design. No schema change is assumed for Part B; if the confirmed root cause requires one, it must be additive and justified, per the constitution.
- User-facing copy stays in simple Arabic, consistent with the rest of the product.

## Preliminary Investigation Notes *(evidence gathered while drafting — leads for US2, NOT a settled root cause)*

A code trace produced firm exclusions and a shortlist. US2 still owns confirming the actual mechanism; per FR-015 only the confirmed cause gets fixed.

**Ruled out by code inspection (with evidence):**

- **Anything time-based.** No TTL, expiry, sweeper, or cleanup job exists. The only deletion of settings is an explicit, user-requested full data wipe — which deletes settings and accounts together, consistently. This confirms settings are not aging out.
- **Cascading deletion from the account record.** No foreign keys exist between these tables at all, so removing an account does not delete its settings.
- **Identifier-format mismatch during sync** (e.g. prefixed vs unprefixed Meta ids). Both the write and the lookup use the same identifier, so they agree.
- **A new connection/token creating a duplicate account.** The connection is not part of the match key; an existing account is updated in place.
- **The client defaulting to a different account after a session gap.** No auto-select-first logic exists anywhere in the client; the account is always taken from an explicit identifier in the URL. There is no stored account selection to go stale.
- **Onboarding / GHL auto-provisioning / webhooks / seed scripts creating account records.** None of them touch the ad-account table.

**Still open — these imply different fixes, which is exactly why US2 must run first:**

1. **The settings record is orphaned from its account (strongest lead).** Settings are attached to the account's *internal, auto-generated* identifier rather than its stable Meta identifier. If an account record is ever removed and re-synced, the same Meta account comes back under a **new** internal identifier. Because no cascade exists, the old settings record **survives, orphaned**, while a lookup against the new identifier finds nothing — producing exactly the reported symptom, with the data still sitting in storage. The investigation must find whether any path removes an account record, since the one known path also removes settings and so cannot by itself explain this.
2. **The user's own identity changed.** Settings are also keyed to a user identifier with no enforced link. If a user's identifier ever changes (re-provisioning, an auth migration), both their accounts and their settings orphan at once, and a reconnect would create fresh records with fresh identifiers — matching "blank after a session gap / re-login" closely.
3. **Duplicate settings records.** Nothing enforces one settings record per user and account, and saving is a non-atomic read-then-write, so a double-submit could create two records; a read then picks one arbitrarily and could return the emptier one.

**Independent of which is confirmed**, two defects are worth fixing on their own merits and are captured as US3/US4: a failed load is currently indistinguishable from "never configured" (the screen handles "still loading" but has **no failure branch**, so it renders its starting values as though they were the user's saved numbers), and that same screen stays fully usable — so pressing Save writes those starting values over the real record, turning a display bug into permanent loss.
