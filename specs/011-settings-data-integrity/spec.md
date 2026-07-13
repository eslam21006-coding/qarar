# Feature Specification: Settings Data Integrity (Funnel Settings Loss)

**Feature Branch**: `fix/settings-data-integrity`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "Investigate and fix funnel settings (aov, htoPrice, htoConversionRate, etc.) appearing reverted to blank/default after some time, and fix a related data-loss bug in the Settings screen."

## Problem Summary

Users report that the funnel economics they entered on the Settings screen (average order value, HTO price, HTO conversion rate, and the rest) come back blank or set to unfamiliar starting values after some time has passed. Because those numbers feed the decision engine, the user then sees verdicts computed from figures they never entered.

Two independent defects are in scope, and they compound each other:

1. **A lookup defect (root cause, still to be confirmed).** The saved record is not being found for the account the user is looking at. Prior investigation ruled out deletion and expiry — the record is not being erased, it is not being *found*. Three candidate causes survive and must be discriminated between with evidence, not guesswork.

2. **A silent-fallback defect in the Settings screen (confirmed, independent).** When the settings lookup fails or comes back empty, the screen does not say so. It renders its built-in starting values as though they were the user's saved data, leaves the form fully editable, and lets Save proceed — which overwrites the user's real, still-existing record with placeholder numbers. A display glitch is thereby converted into permanent data loss. This alone can produce the "my settings disappeared" reports even if defect (1) is a transient blip.

Defect 2 is fixed on its own merits and ships regardless of how long defect 1 takes to confirm.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Settings screen never passes off placeholder numbers as my saved data (Priority: P1)

A user opens Settings for an account where they previously saved their funnel economics. If the app cannot load that record — whether the lookup errors out or returns nothing — the screen tells them plainly, in simple Arabic, that their settings could not be loaded. It does not populate the form with invented numbers, and it does not let them save over a record it could not read. The user can retry. If they know they never configured this account and genuinely want to start fresh, they must explicitly say so before the form becomes editable and Save unlocks.

**Why this priority**: This is the defect that destroys data. Every other defect in this feature is recoverable; this one silently overwrites the user's real record with placeholders and makes the loss permanent. It is independently shippable and independently valuable — it stops the bleeding even before the root cause of the failed lookup is known.

**Independent Test**: Force the settings lookup to fail (and separately, to return nothing) for an account that has a saved record. Confirm the screen shows a failure state rather than the starting values, that Save is unavailable, and that the stored record is byte-for-byte unchanged after the user interacts with the screen.

**Acceptance Scenarios**:

1. **Given** a user with saved settings for an account, **When** the settings lookup fails with an error, **Then** the screen shows a clear failure message with a retry action, does not display any pre-filled economics values, and offers no way to save.
2. **Given** a user with saved settings for an account, **When** the settings lookup succeeds but returns no record (an empty result), **Then** the screen treats this as "could not load", not as "you have no settings" — it does not silently seed the form with starting values and does not permit Save.
3. **Given** the failure state is on screen, **When** the user chooses Retry and the lookup then succeeds, **Then** the form fills with the user's real saved values and Save becomes available.
4. **Given** the failure state is on screen, **When** the user explicitly confirms they want to configure this account from scratch, **Then** the form becomes editable with no economics values pre-filled as if saved, and Save becomes available.
5. **Given** a user who has genuinely never saved settings for an account, **When** they open Settings, **Then** they get a first-time setup experience that is visibly distinct from the failure state, and no number is presented as an already-saved value.
6. **Given** a user saves from the explicit "start fresh" path, **When** a real record for that account in fact already exists on the server, **Then** the server refuses the write rather than clobbering the existing record, and the user is told their settings were found after all and shown them.

---

### User Story 2 - Support can tell, in one step, why a user's settings went missing (Priority: P1)

Someone diagnosing an affected user runs a single reconciliation check that compares every stored settings record for that user against the ad accounts that actually exist for them. The result discriminates between all three surviving candidate causes at once, rather than requiring three separate guesses to be tested serially.

**Why this priority**: No fix for the root cause is justified without evidence identifying *which* root cause. This check is the gate on all root-cause work and is therefore scheduled first. It is cheap, read-only, and immediately conclusive.

**Independent Test**: Run the check against an affected user's data and confirm it produces a verdict — orphaned, drifted, duplicated, or none of these — without requiring any code change to ship.

**Acceptance Scenarios**:

1. **Given** an affected user, **When** the reconciliation check runs, **Then** it reports every settings record for that user alongside the ad account it points at, flagging any record whose account does not exist.
2. **Given** a settings record pointing at an account that no longer exists, **When** the check runs, **Then** that record is reported as orphaned — confirming candidate cause 1.
3. **Given** more than one settings record for the same user and account, **When** the check runs, **Then** the duplicate count is reported — confirming candidate cause 3.
4. **Given** an affected person whose settings records are stranded under a user identifier that no longer exists, **When** the check runs, **Then** those records are surfaced — the check MUST NOT be scoped only by the person's *current* identifier, because a drifted identifier returns an empty result that is indistinguishable from "never configured". Finding stranded records confirms candidate cause 2.
5. **Given** the person's accounts exist, their settings records point at them correctly, there are no duplicates, and no records are stranded under a dead identifier, **When** the check runs, **Then** the check reports a clean result and all three candidate causes are eliminated for that person.
6. **Given** the check has been run, **When** its findings are recorded, **Then** `docs/part-b-investigation.md` is updated so its conclusions reflect the evidence, with superseded claims corrected and still-valid findings retained.

---

### User Story 3 - My settings stay attached to my account through re-syncs and re-provisioning (Priority: P2)

A user's saved funnel economics remain findable for the ad account they belong to, across every event that can reshuffle the internal bookkeeping — an ad account being removed and re-synced, a re-authentication with the ad platform, or the user's own record being re-provisioned. The economics are a property of *that ad account for that user*, and they are retrieved as such.

**Why this priority**: This is the root-cause fix. It is P2 rather than P1 only because it is gated on the evidence from User Story 2 — its precise shape depends on which candidate cause the check confirms. Its user-facing value is the highest of any story here, and it is what stops the reports recurring.

**Independent Test**: Reproduce the confirmed failure mode in a controlled environment (e.g. remove and re-sync an ad account that has saved settings), then confirm the settings are still returned for that account afterwards.

**Acceptance Scenarios**:

1. **Given** a user with saved settings for an ad account, **When** that ad account is removed and re-synced from the ad platform, **Then** opening Settings for that account still shows the user's saved economics.
2. **Given** settings records that are already orphaned in production, **When** the repair runs, **Then** each orphaned record is re-attached to the correct ad account for that user, and any record that cannot be attributed with certainty is left untouched and reported rather than guessed at.
3. **Given** a returning customer whose subscription is re-provisioned under a changed email address, **When** provisioning runs, **Then** it recognises them as the existing person by a durable identifier (their external CRM contact id) rather than minting a new identity, and their previously saved economics are still found when they next open Settings.
4. **Given** a person whose settings are already stranded under a superseded identifier, **When** the repair runs, **Then** their records are re-attributed to their live identity only after the two identities are proven to be the same person.
5. **Given** any repair or re-linking operation, **When** it runs, **Then** it can be previewed without writing, and it never deletes a settings record.

---

### User Story 4 - Saving twice at once cannot produce two conflicting records (Priority: P3)

Two saves for the same user and account arriving at the same moment result in exactly one stored record, not two. Reads for that account can therefore never return an arbitrary one of several rows.

**Why this priority**: This is a latent correctness hazard rather than a confirmed cause of the reports — the save path is a read-then-write with no single-record guarantee behind it, so duplicates are possible in principle. It is P3 because User Story 2's check will say whether it has actually happened. The guarantee is worth having either way, and it is cheap.

**Independent Test**: Issue concurrent saves for the same user and account and confirm exactly one record exists afterwards, holding the last-written values.

**Acceptance Scenarios**:

1. **Given** no existing settings for an account, **When** two saves for that account are issued concurrently, **Then** exactly one record exists afterwards.
2. **Given** duplicate records that already exist in production, **When** they are consolidated, **Then** the most recently updated record's values are the ones retained, and the consolidation is reported.
3. **Given** the one-record-per-account guarantee is in place, **When** a settings lookup runs, **Then** it can only ever match a single record.

---

### Edge Cases

- **Load fails while the user has unsaved edits in progress**: the in-progress edits are not discarded, and Save remains blocked only for the load that failed — the user is not silently returned to a state where their typing is gone.
- **A user genuinely has no settings for a brand-new account**: this must be distinguishable from a failed load. A never-configured account is a legitimate first-time setup, not an error, and must not be presented as one.
- **A user confirms "start fresh" but a real record does exist** (the load was merely a transient failure): the server must not let the fresh-start save destroy the existing record. See User Story 1, scenario 6.
- **The demo account**: settings saved against the demo account are distinct from those saved against a real ad account. Opening Settings for the demo account must not appear to be a data-loss event.
- **An orphaned record that cannot be confidently attributed to any current account** (e.g. the user has several accounts and nothing distinguishes which one the record belonged to): the repair must leave it alone and report it, rather than attaching it to the wrong account.
- **Repair re-run**: running the repair a second time must be safe and must not change anything already repaired.
- **Two people, one email history**: if an email address was reassigned from one person to another, re-attributing stranded records by email alone would hand one person's economics to another. Identity recovery must be safe against this — it is a data-isolation boundary, not merely a convenience.

## Requirements *(mandatory)*

### Functional Requirements

#### Settings screen failure state (User Story 1)

- **FR-001**: The Settings screen MUST distinguish three states from one another and render each differently: settings loaded successfully, settings could not be loaded, and this account has never been configured.
- **FR-002**: The Settings screen MUST NOT populate any economics field with a built-in starting value and present it as though it were the user's saved data. Starting values may only be reached through an explicit, user-initiated fresh-start path.
- **FR-003**: When the settings lookup fails or returns no record for an account, the Settings screen MUST show a failure state with a plain-language explanation and a retry action, and MUST NOT display economics values.
- **FR-004**: While the Settings screen is in the failure state, saving MUST be unavailable.
- **FR-005**: Saving MUST become available only after either (a) a settings load succeeds, or (b) the user explicitly confirms they intend to configure the account from scratch.
- **FR-006**: The server MUST reject a save issued from the fresh-start path when a settings record for that user and account already exists, and MUST return the existing record rather than overwriting it. A fresh-start save is only valid when no record exists.
- **FR-007**: All new user-facing copy on the Settings screen MUST be in simple Modern Standard Arabic, consistent with the rest of the product, with numeric values rendered left-to-right inside the right-to-left layout.

#### Diagnosis (User Story 2)

- **FR-008**: The project MUST provide a read-only reconciliation check that, for a given user, lists every stored settings record next to the ad account it references and flags records whose referenced account does not exist.
- **FR-009**: The reconciliation check MUST report the number of settings records per user-and-account pair, so that duplicates are visible.
- **FR-010**: The reconciliation check MUST also surface settings records whose owning user identifier matches no existing user. Scoping the check to the affected person's *current* identifier alone is insufficient: if their identifier has drifted, that scoping returns an empty result, which is indistinguishable from a person who never configured anything. The check MUST be able to find records stranded under a dead identifier — for example, by resolving the person through a durable identifier such as their email address or their external CRM contact id.
- **FR-011**: The reconciliation check MUST be conclusive enough to discriminate between all three candidate causes — orphaned records (dangling ad account reference), user identifier drift (dangling user reference), and duplicate records — from a single run.
- **FR-012**: The reconciliation check MUST NOT modify any data.
- **FR-013**: `docs/part-b-investigation.md` MUST be updated with the check's findings: conclusions it supersedes are corrected, conclusions that still hold are retained, and the ruled-out hypotheses stay ruled out.

#### Durable linkage and repair (User Story 3)

- **FR-014**: A user's saved settings MUST remain retrievable for their ad account across the removal and re-sync of that ad account.
- **FR-015**: A person's saved settings MUST remain retrievable across a re-provisioning event that mints them a new internal user identifier. Re-provisioning MUST recognise a returning person by a durable identifier rather than minting a fresh identity that strands their existing data.
- **FR-016**: The system MUST prevent a settings record from continuing to reference an ad account that no longer exists, or an owning user that no longer exists.
- **FR-017**: Any repair of existing orphaned, stranded, or duplicated records MUST be previewable without writing, MUST be safe to run more than once, and MUST NOT delete a settings record whose correct owner cannot be determined with certainty — such records are reported for human review instead.

#### One record per account (User Story 4)

- **FR-018**: The system MUST guarantee at most one settings record per user-and-account pair.
- **FR-019**: Concurrent saves for the same user and account MUST result in exactly one stored record.
- **FR-020**: A settings lookup MUST NOT be able to return an arbitrary record from among several candidates.

#### Constraints

- **FR-021**: The system MUST NOT introduce any expiry, time-to-live, or automatic deletion mechanism for stored settings. Storage is unlimited by design; the defect is in the lookup path, not in deletion.
- **FR-022**: Every settings query MUST remain scoped by user, preserving hard data isolation between users. Any repair that re-attributes a stranded record to a recovered identity MUST prove the two identities are the same person before moving data, and MUST NOT become a path by which one person's data reaches another.

### Key Entities

- **Funnel settings record**: A user's funnel economics for one ad account — average order value, HTO price, HTO conversion rate, front-end ROAS, daily budget, archetype, and related qualitative fields. Belongs to exactly one user and exactly one ad account. Has no expiry. Must be uniquely addressable by (user, ad account).
- **Ad account**: An advertising account belonging to a user, with a stable external identifier assigned by the ad platform and an internal bookkeeping identifier. May be removed and re-synced. The demo account is a special case of this.
- **User**: The account holder. Identified internally by an identifier whose stability across re-provisioning is one of the three things under investigation.
- **Reconciliation check**: A read-only diagnostic that joins settings records against ad accounts for a user and reports orphans, duplicates, and clean results.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero settings records are overwritten with built-in starting values as a result of a failed or empty load. Verified by a test that forces the failure and asserts the stored record is unchanged.
- **SC-002**: 100% of failed settings loads produce a visible failure state; none fall through to an editable, savable form pre-filled with starting values.
- **SC-003**: The root cause is identified from a single diagnostic run, with the evidence written down, before any root-cause fix is written.
- **SC-004**: After the fix, a user's saved economics survive an account removal-and-re-sync cycle — verified by reproducing the cycle and reading the settings back.
- **SC-005**: Concurrent saves for one user and account produce exactly one stored record, verified under test.
- **SC-006**: Every settings record in production references an ad account that exists, and no user-and-account pair has more than one record. Verified by re-running the reconciliation check after the repair.
- **SC-007**: No stored settings record is deleted by any part of this work.
- **SC-008**: Users stop reporting that their funnel settings reverted to values they did not enter.

## Assumptions

- **The reports are real and the data still exists.** Prior investigation established that no code path deletes settings records and that no expiry exists. The work therefore targets the read path and the Settings screen, not the write or delete paths.
- **Two ruled-out hypotheses stay ruled out and will not be re-tested**: account syncing matches existing accounts by their stable platform identifier and updates them in place (it never creates a detached duplicate for an account that already exists); and the client has no "default to first/last account" behaviour (the account is always taken from an explicit address, never from a stored selection that could go stale).
- **A first-time setup experience may still offer suggested numbers as non-committal hints** (for example, as greyed placeholder text in an empty field), provided they are visibly not values, are never submitted unless the user types them, and never appear on the failure path.
- **Repairing already-damaged production records is in scope**, because the user's data still exists and recovering it is the point. Repair is preview-first, idempotent, non-destructive, and declines to guess when attribution is ambiguous.
- **Where duplicate records must be consolidated, the most recently updated record wins.** It is the closest available proxy for the user's latest intent.
- **Candidate cause 2 (user identifier drift) has a known, specific mechanism, and it narrows the diagnostic.** A preliminary read of the identity path found that user identity is a generated identifier, that email is genuinely unique, and that provisioning resolves a returning person *by email only* — so drift is impossible while the person's existing record survives under an unchanged email. It becomes possible when the person's email changes (or they re-purchase under a second address), when their user record is removed and re-provisioned, or across the historical retype of the user identifier, none of which cascade to the settings records. This is why FR-010 exists: a diagnostic scoped to the person's *current* identifier would report "no settings" for exactly the person whose settings drifted. The **fix** for this cause is still gated on the diagnostic confirming it; only the diagnostic's shape is settled in advance.
- **Existing data isolation, the deterministic engine, the five-verdict vocabulary, and the read-only-by-default posture are unaffected by this work** and must remain so.

## Out of Scope

- Any expiry, retention limit, or automatic cleanup of settings records (explicitly forbidden — see FR-021).
- Changes to the decision engine, its evaluation order, its rule codes, or its verdict vocabulary.
- Redesigning the Settings screen beyond the states required to prevent data loss.
- Changes to how settings values feed the engine's math.
