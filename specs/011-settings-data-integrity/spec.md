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

## Clarifications

### Session 2026-07-13

- Q: The root-cause fix is gated on diagnostic evidence, but the diagnostic needs production data access. What ships if that evidence is slow or unavailable? → A: Ship the *preventive* structural guarantees (one settings record per user-and-account pair; no dangling ad-account or user references) regardless of the diagnostic's outcome — they are correct and safe whichever cause is confirmed. Gate only the *repair* of already-damaged production records on confirmed evidence, because that repair moves a person's data between identities and must never run on a guess.
- Q: Which durable identifier should re-provisioning use to recognise a returning person, and what happens on conflict? → A: Match on the external CRM contact id first, falling back to email. When the contact id matches an existing person whose email differs, update that person's email in place — same identity, new address — rather than minting a new one. Mint a new identity only when neither identifier matches. Every in-place email change on this path MUST be recorded in the audit trail (old email, new email, contact id, timestamp); the merge still completes automatically and does not block provisioning.
- Q: Should the system record when a settings lookup comes back empty, so this class of bug is detectable without a user report? → A: Both — a structured server-side log entry (for volume and alerting) and a durable audit record (for forensics after logs rotate), emitted whenever a lookup returns nothing for an ad account that exists. The durable record must be bounded so a genuine first-time user reloading the page does not accumulate records without limit.
- Q: Who may run the reconciliation check and the repair, and how are they exposed? → A: Both are offline maintenance operations for an operator who already has production database access — neither is reachable over the network, not even as an admin-only endpoint. The repair additionally defaults to preview-only: it writes nothing unless invoked with an explicit confirmation flag.
- Q: How is a settings record's link to its ad account made durable? → A: Keep the internal identifier as the join key, and additionally record the ad platform's own stable account identifier alongside it as a recovery key. The change is additive, no existing read path breaks, and an orphaned record becomes self-attributable rather than unrecoverable. Records predating this change carry no stable identifier and fall into the "report, don't guess" case.

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

**Why this priority**: This is the root-cause fix, and it splits in two. The **preventive** half — guaranteeing that a settings record can never reference an ad account or an owning user that does not exist, and that a returning person is recognised rather than re-minted — is correct and safe whichever candidate cause the diagnostic confirms, so it is **not** gated on evidence and ships alongside User Story 1. The **repair** half — re-attaching records that are already orphaned or stranded in production — moves a person's data between identities and is therefore gated on the diagnostic confirming what actually happened. P2 reflects that gating, not lower value: this is what stops the reports recurring.

**Independent Test**: Reproduce the confirmed failure mode in a controlled environment (e.g. remove and re-sync an ad account that has saved settings), then confirm the settings are still returned for that account afterwards.

**Acceptance Scenarios**:

1. **Given** a user with saved settings for an ad account, **When** that ad account is removed and re-synced from the ad platform, **Then** opening Settings for that account still shows the user's saved economics.
2. **Given** settings records that are already orphaned in production, **When** the repair runs, **Then** each orphaned record is re-attached to the correct ad account for that user, and any record that cannot be attributed with certainty is left untouched and reported rather than guessed at.
3. **Given** a returning customer whose subscription is re-provisioned under a changed email address, **When** provisioning runs, **Then** it recognises them as the existing person by their external CRM contact id rather than minting a new identity, updates their email in place, and their previously saved economics are still found when they next open Settings.
4. **Given** the contact-id merge path updates an existing person's email, **When** the merge completes, **Then** an audit record captures the previous email, the new email, the contact id, and the time — and provisioning still completes without blocking on human review.
5. **Given** a person whose settings are already stranded under a superseded identifier, **When** the repair runs, **Then** their records are re-attributed to their live identity only after the two identities are proven to be the same person.
6. **Given** any repair or re-linking operation, **When** it runs, **Then** it can be previewed without writing. It never removes a record whose correct owner is uncertain, and the only removal it ever performs is a duplicate consolidation — where the losing row's full contents are written to the audit trail *before* removal, so no user data becomes unrecoverable (SC-007).

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
- **An orphaned record with no stable account identifier**: records written before the recovery key exists carry only a stale internal reference, so if the user has several accounts nothing distinguishes which one the record belonged to. The repair must leave these alone and report them, rather than attaching them to the wrong account. Records written after the change are self-attributable and do not have this problem.
- **Repair re-run**: running the repair a second time must be safe and must not change anything already repaired.
- **Two people, one email history**: if an email address was reassigned from one person to another, re-attributing stranded records by email alone would hand one person's economics to another. Identity recovery must be safe against this — it is a data-isolation boundary, not merely a convenience.
- **The merge target's new email already belongs to someone else**: re-provisioning resolves a returning person by contact id and wants to move them to a new email, but that email is already held by a *different* existing person. The in-place email change cannot proceed (email is unique). This must be refused and reported for human review rather than failing silently, merging two people, or crashing provisioning.
- **A person with no recorded contact id**: anyone provisioned before the contact-id match path existed can only be resolved by email. They must still be recognised via the email fallback, and must not be re-minted as a new identity.

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
- **FR-015**: A person's saved settings MUST remain retrievable across a re-provisioning event. Re-provisioning MUST recognise a returning person rather than minting a fresh identity that strands their existing data, resolving them in this order: (a) by their external CRM contact id, then (b) by email address. A new identity is minted only when neither resolves to an existing person.
- **FR-016**: When re-provisioning resolves a returning person by contact id and that person's stored email differs from the incoming one, the system MUST update the existing person's email in place — preserving their identity and therefore their settings — rather than creating a second identity. The provisioning request MUST still complete automatically and MUST NOT block on this.
- **FR-017**: Every in-place email change made on the contact-id merge path (FR-016) MUST be recorded in the audit trail, capturing at minimum the previous email, the new email, the external CRM contact id, and the time of the change. This is an identity change that completes without human review, so it MUST leave a durable record that a human can later reconstruct.
- **FR-018**: The system MUST **detect** a settings record whose ad account reference or owning user reference no longer resolves, and MUST **recover** it wherever the stable account identifier permits — re-attaching the record and returning it to the user. A lookup MUST NEVER respond to a dangling reference by silently returning nothing, which is the behaviour that produces the bug. Where recovery is not possible, the condition is surfaced as a failure state (FR-003) and recorded (FR-024, FR-025) rather than hidden. Detection-and-recovery is deliberately chosen over structural prevention (a foreign key) — see Assumptions.
- **FR-019**: Any repair of existing orphaned, stranded, or duplicated records MUST default to preview-only: invoked with no arguments it reports what it *would* change and writes nothing. Writing MUST require an explicit, deliberate confirmation flag. The repair MUST be safe to run more than once, and MUST NOT delete a settings record whose correct owner cannot be determined with certainty — such records are reported for human review instead.
- **FR-020**: The preventive requirements (FR-014 through FR-018, and FR-021 through FR-026) MUST NOT be gated on the diagnostic's outcome: they are correct whichever candidate cause is confirmed, and they ship alongside User Story 1. Only the **repair** of already-damaged production records (FR-019) is gated on the diagnostic confirming the damage it is meant to undo.

#### One record per account (User Story 4)

- **FR-021**: The system MUST guarantee at most one settings record per user-and-account pair.
- **FR-022**: Concurrent saves for the same user and account MUST result in exactly one stored record.
- **FR-023**: A settings lookup MUST NOT be able to return an arbitrary record from among several candidates.

#### Observability

- **FR-024**: Whenever a settings lookup returns no record for an ad account that *does* exist, the system MUST emit a structured server-side log entry identifying the user and the ad account. This is the exact condition that defines the bug, and it is currently silent — making it searchable and countable is what allows the next occurrence to be detected without a user report.
- **FR-025**: The same condition MUST also leave a durable audit record, so that forensics remain possible after logs rotate.
- **FR-026**: The durable record (FR-025) MUST be bounded, or a single user reloading the page would accumulate rows without limit. The bound is concrete and time-based: **a new record MUST NOT be written if one already exists for the same user-and-account pair within the preceding 24 hours.** Suppression is determined from the audit record's own creation time and the user-and-account pair carried in its payload — no additional state, and no "resolved" flag, is introduced. A genuinely never-configured account writes **no** record at all; it is not an anomaly.

#### Constraints

- **FR-027**: The system MUST NOT introduce any expiry, time-to-live, or automatic deletion mechanism for stored settings. Storage is unlimited by design; the defect is in the lookup path, not in deletion.
- **FR-028**: Every settings query MUST remain scoped by user, preserving hard data isolation between users. Any repair that re-attributes a stranded record to a recovered identity MUST prove the two identities are the same person before moving data, and MUST NOT become a path by which one person's data reaches another.

#### Operation and access

- **FR-029**: The reconciliation check and the repair MUST both be offline maintenance operations, runnable only by an operator who already holds production database access. Neither MUST be reachable over the network, and neither MUST be exposed as an application endpoint — not even an administrator-only one. The repair crosses an identity boundary, so keeping it off the network removes a class of privilege-escalation risk rather than mitigating it.
- **FR-030**: The repair's write path MUST be opt-in per invocation. A run that omits the confirmation flag MUST be incapable of writing, and MUST clearly report that it was a preview.

#### Account linkage (User Story 3)

- **FR-031**: A settings record MUST carry the ad platform's own stable account identifier in addition to the internal join key. The internal identifier remains the join key — no existing read path changes — while the stable identifier serves as the recovery key that makes a record self-attributable even if its internal reference goes stale. This is an additive change; it neither rewrites existing links nor removes them.
- **FR-032**: The repair MUST use the stable account identifier to re-attribute an orphaned record to the correct ad account. A record that predates FR-031 and therefore carries no stable identifier is exactly the "cannot be determined with certainty" case in FR-019: it is reported for human review, never guessed at.

### Key Entities

- **Funnel settings record**: A user's funnel economics for one ad account — average order value, HTO price, HTO conversion rate, front-end ROAS, daily budget, archetype, and related qualitative fields. Belongs to exactly one user and exactly one ad account. Has no expiry. Must be uniquely addressable by (user, ad account). Carries two references to its ad account: the internal join key it is read by, and the ad platform's stable account identifier, which is what allows it to be recovered if the internal key goes stale.
- **Ad account**: An advertising account belonging to a user, with a stable external identifier assigned by the ad platform and an internal bookkeeping identifier. May be removed and re-synced. The demo account is a special case of this.
- **User**: The account holder. Identified internally by an identifier whose stability across re-provisioning is one of the three things under investigation.
- **Reconciliation check**: A read-only, offline diagnostic that joins settings records against both ad accounts and users, reporting orphaned records (dangling account reference), stranded records (dangling user reference), duplicates, and clean results.
- **Audit trail**: The durable record of events that must survive log rotation — specifically, automatic identity merges and settings lookups that came back empty for an account that exists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero settings records are overwritten with built-in starting values as a result of a failed or empty load. Verified by a test that forces the failure and asserts the stored record is unchanged.
- **SC-002**: 100% of failed settings loads produce a visible failure state; none fall through to an editable, savable form pre-filled with starting values.
- **SC-003**: The root cause is identified from a single diagnostic run, with the evidence written down, before any *repair* of existing production records is run. (Preventive fixes do not wait on this — see FR-020.)
- **SC-004**: After the fix, a user's saved economics survive an account removal-and-re-sync cycle — verified by reproducing the cycle and reading the settings back.
- **SC-005**: Concurrent saves for one user and account produce exactly one stored record, verified under test.
- **SC-006**: Every settings record in production references an ad account that exists and an owning user that exists, and no user-and-account pair has more than one record. Verified by re-running the reconciliation check after the repair; any record it still reports is one the repair deliberately declined to guess at, and is listed for human review.
- **SC-007**: No user data becomes unrecoverable. Where duplicate records must be consolidated so that the one-record-per-account guarantee (FR-021) can be enforced, the losing duplicate's **full contents are written to the audit trail before it is removed** — so the values are always reconstructable. No record is ever removed without that capture, and no record is removed for any other reason.
- **SC-008**: The next occurrence of a settings lookup coming back empty for an existing account is detectable from the system's own records, without waiting for a user to report it. Verified by triggering the condition and finding it in both the log stream and the durable audit trail.
- **SC-009**: Every automatic identity merge is reconstructable after the fact from the audit trail alone — who was merged, from which email to which, and when.
- **SC-010**: Users stop reporting that their funnel settings reverted to values they did not enter.

## Assumptions

- **The reports are real and the data still exists.** Prior investigation established that no code path deletes settings records and that no expiry exists. The work therefore targets the read path and the Settings screen, not the write or delete paths.
- **Two ruled-out hypotheses stay ruled out and will not be re-tested**: account syncing matches existing accounts by their stable platform identifier and updates them in place (it never creates a detached duplicate for an account that already exists); and the client has no "default to first/last account" behaviour (the account is always taken from an explicit address, never from a stored selection that could go stale).
- **A first-time setup experience may still offer suggested numbers as non-committal hints** (for example, as greyed placeholder text in an empty field), provided they are visibly not values, are never submitted unless the user types them, and never appear on the failure path.
- **Repairing already-damaged production records is in scope**, because the user's data still exists and recovering it is the point. Repair is preview-first, idempotent, and declines to guess when attribution is ambiguous. Its only removal is the duplicate consolidation described in SC-007, which is audit-captured first; it removes nothing else.
- **Where duplicate records must be consolidated, the most recently updated record wins.** It is the closest available proxy for the user's latest intent. Consolidation is the only operation in this feature that removes a row, and it does so only after writing the losing row's full contents to the audit trail (SC-007). It exists because the one-record-per-account guarantee cannot be enforced structurally while duplicates remain.
- **Dangling references are detected and recovered, not structurally prevented — a foreign key was considered and rejected.** Three reasons. (1) A foreign key prevents *new* dangling references but cannot recover the records that are *already* dangling — and those are precisely the ones users are complaining about, so it would not fix the reported bug. (2) No table in this product's own schema uses a database-level foreign key; every one of them enforces its user and account references in application code by established convention. Introducing the first one, on the table at the centre of a live data-loss incident, is a larger change than the fix. (3) The production database is a distributed engine whose foreign-key behaviour differs from the single-node database the schema was written against, and it already requires hand-rewriting of generated migration SQL. Recording the ad platform's stable account identifier on the record (FR-031) achieves more than a foreign key would: it makes an orphaned record *self-attributable*, so the lookup repairs it instead of merely being prevented from creating it.
- **Candidate cause 2 (user identifier drift) has a known, specific mechanism, and it narrows the diagnostic.** A preliminary read of the identity path found that user identity is a generated identifier, that email is genuinely unique, and that provisioning resolves a returning person *by email only* — so drift is impossible while the person's existing record survives under an unchanged email. It becomes possible when the person's email changes (or they re-purchase under a second address), when their user record is removed and re-provisioned, or across the historical retype of the user identifier, none of which cascade to the settings records. This is why FR-010 exists: a diagnostic scoped to the person's *current* identifier would report "no settings" for exactly the person whose settings drifted. The **preventive** fix for this cause (recognising a returning person by contact id — FR-015, FR-016) is not gated on the diagnostic; only the **repair** of people already stranded is.
- **Existing data isolation, the deterministic engine, the five-verdict vocabulary, and the read-only-by-default posture are unaffected by this work** and must remain so.

## Out of Scope

- Any expiry, retention limit, or automatic cleanup of settings records (explicitly forbidden — see FR-027).
- Changes to the decision engine, its evaluation order, its rule codes, or its verdict vocabulary.
- Redesigning the Settings screen beyond the states required to prevent data loss.
- Changes to how settings values feed the engine's math.
