# Feature Specification: Facebook Pages Display

**Feature Branch**: `feature/pages-read-engagement-display`

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "Add a \"Your Facebook Pages\" section to the Meta connection screen. After a user completes Facebook OAuth and returns to the app, the app retrieves the list of Facebook Pages the user manages and displays them on the same screen as the ad account picker, above it. Each Page in the list shows its profile picture, its name, and its follower count. The list appears only when the user has an active Meta connection and at least one Page; when the user manages no Pages, the section is hidden entirely. The Page list refreshes when the user re-syncs their accounts, and is cleared along with all other user data when the user disconnects. This gives the advertiser visual confirmation, before they select an ad account, that Qarar has connected to the correct Meta account and can see the Pages their ads run from. All Page data is scoped per user and never shared across users. All user-facing copy is in simple Arabic. This is a read-only display — the app never posts to, modifies, or manages any Page."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirm the right Meta account is connected (Priority: P1)

An advertiser finishes connecting their Meta account and returns to the connection screen. Before they pick which ad account to monitor, they see a section titled "صفحاتك على فيسبوك" listing the Facebook Pages they manage — each with its profile picture, its name, and how many followers it has. Recognising their own Pages tells them immediately that Qarar is looking at the correct Meta account.

**Why this priority**: This is the entire value of the feature. Without it, an advertiser who manages several Meta accounts has no way to tell — before committing to an ad account — whether they authorised the right one. Everything else in this spec exists to keep this list correct over time.

**Independent Test**: Connect a Meta account that manages at least one Page, land on the connection screen, and verify the Pages section renders above the ad account picker with a picture, a name, and a follower count for each Page. Delivers full value on its own.

**Acceptance Scenarios**:

1. **Given** a user with an active Meta connection who manages three Pages, **When** they open the Meta connection screen, **Then** a Pages section appears above the ad account picker listing all three Pages, each showing profile picture, name, and follower count.
2. **Given** a user with an active Meta connection who manages no Pages, **When** they open the Meta connection screen, **Then** no Pages section appears anywhere on the screen — no heading, no empty-state box, no placeholder.
3. **Given** a user with no Meta connection, **When** they open the Meta connection screen, **Then** no Pages section appears.
4. **Given** a user viewing their Pages list, **When** they read the section, **Then** every word of copy is in simple Arabic and every numeric value (follower counts) reads left-to-right inside the right-to-left layout.
5. **Given** a Page whose profile picture cannot be displayed, **When** the list renders, **Then** that Page still appears with its name and follower count, and a neutral placeholder stands in for the picture.
6. **Given** a user whose active connection predates Page visibility, **When** they open the Meta connection screen, **Then** no Pages section appears and a one-time dismissible note in simple Arabic invites them to reconnect to see their Pages.
7. **Given** that user dismisses the note, **When** they return to the screen later, **Then** the note does not reappear and nothing else has changed.
8. **Given** that user reconnects instead, **When** they return to the screen, **Then** the note is gone permanently and their Pages are listed.

---

### User Story 2 - Keep the Page list current (Priority: P2)

An advertiser who has created a new Facebook Page, renamed one, or gained followers since connecting presses the existing "تحديث الحسابات" (re-sync) control. The Pages list updates alongside the ad account list, so what they see matches their current Meta account.

**Why this priority**: Without refresh the list silently goes stale, which turns a trust signal into a source of doubt. It is P2 because a first-connection user already gets the full confirmation value from Story 1.

**Independent Test**: With a connected account, change the Page set on Meta's side (add/remove a Page or change a name), press re-sync, and confirm the displayed list matches the new reality without reconnecting.

**Acceptance Scenarios**:

1. **Given** a connected user whose Pages have changed on Meta's side, **When** they trigger a re-sync, **Then** the displayed Pages list reflects the new set of Pages, names, pictures, and follower counts.
2. **Given** a connected user who managed one Page and no longer manages any, **When** they trigger a re-sync, **Then** the Pages section disappears entirely.
3. **Given** a connected user who managed no Pages and now manages one, **When** they trigger a re-sync, **Then** the Pages section appears with that Page.
4. **Given** a re-sync where the Pages information cannot be retrieved, **When** the sync completes, **Then** ad account syncing still succeeds, the previously stored Pages remain displayed unchanged, and the user is told in simple Arabic that the Pages list could not be updated.
5. **Given** a user is viewing the connection screen while a re-sync is running, **When** the sync is in progress, **Then** the Pages section does not flicker between empty and populated states.

---

### User Story 3 - Pages data disappears on disconnect (Priority: P3)

An advertiser who disconnects their Meta account ("افصل واحذف بياناتي") expects everything Qarar held about them to be gone — including the list of their Facebook Pages.

**Why this priority**: A privacy and data-hygiene guarantee that the product already promises in its disconnect confirmation copy. It is P3 only because it is invisible in the happy path, not because it is optional.

**Independent Test**: Connect, confirm Pages appear, disconnect, and verify no Page data for that user remains anywhere and the section is gone on return to the screen.

**Acceptance Scenarios**:

1. **Given** a connected user with stored Pages, **When** they disconnect, **Then** all of their stored Page records are deleted along with their other data.
2. **Given** a user who disconnected, **When** they return to the Meta connection screen, **Then** no Pages section appears.
3. **Given** a user who disconnected and later reconnects, **When** the connection completes, **Then** the Pages list is rebuilt from Meta and shows only Pages the reconnected account manages.

---

### Edge Cases

- **User manages many Pages (e.g. 50+)**: only the first 5 render, with "عرض الكل" revealing the rest (FR-008), so the ad account picker is never pushed off-screen.
- **User manages exactly 5 Pages**: all 5 render with no expand control (FR-008a).
- **A Page reports no follower count** (Meta withholds it or the value is unavailable): the Page still appears with picture and name, and the follower line is omitted for that Page rather than showing "0" or a blank number.
- **A Page has zero followers**: displays a genuine zero, distinct from "unavailable".
- **Connection expired / needs re-authorisation**: the connection is no longer active, so the Pages section is hidden; the existing re-authorisation prompt is the user's path forward.
- **User connected before this feature existed**: their connection lacks Page visibility, so no Pages section appears; instead they see the one-time dismissible reconnect note (FR-025). After reconnecting, their Pages appear normally.
- **User dismisses the reconnect note and never reconnects**: the note never returns, the Pages section never appears, and nothing else about their experience changes.
- **User declines the Pages permission during a fresh authorisation**: no error is shown and the Pages section stays hidden; they are treated the same as a pre-existing connection and see the dismissible reconnect note once (FR-025).
- **Very long Page names**: truncated visually without breaking the layout; the full name remains discoverable.
- **Two users connect the same Meta account**: each user's Page records are stored and read under their own account only.
- **Demo mode**: the demo account is not a real Meta connection, so no Pages section appears for it.

## Requirements *(mandatory)*

### Functional Requirements

**Display**

- **FR-001**: The system MUST display a "Your Facebook Pages" section on the Meta connection screen, positioned above the ad account picker.
- **FR-002**: The system MUST render the section only when the user has an active Meta connection AND at least one stored Page; in every other case the section MUST be absent from the screen entirely (no heading, no empty state).
- **FR-003**: Each listed Page MUST show its profile picture, its name, and its follower count. "Follower count" means the Page's followers as reported by Meta — never the legacy page-likes count, and never a fallback between the two.
- **FR-004**: When a Page's profile picture is unavailable or fails to load, the system MUST show a neutral placeholder in its place and still display the Page's name and follower count.
- **FR-005**: When a Page's follower count is unavailable, the system MUST omit the follower line for that Page rather than displaying a misleading zero or empty value.
- **FR-006**: The system MUST format follower counts as readable numbers that render left-to-right within the right-to-left layout.
- **FR-007**: The system MUST present the Pages list in a stable, predictable order that does not change between renders of the same data.
- **FR-008**: The system MUST display at most 5 Pages initially. When the user has more than 5, it MUST offer an "عرض الكل" control that reveals the remainder in place, so the ad account picker stays reachable without excessive scrolling.
- **FR-008a**: When the user has 5 or fewer Pages, no expand control MUST be shown.
- **FR-009**: All user-facing copy in this section MUST be simple Modern Standard Arabic readable at a 6th-grade level.

**Retrieval and freshness**

- **FR-010**: After a user completes Facebook authorisation and returns to the app, the system MUST retrieve and store the list of Pages that user manages.
- **FR-011**: The system MUST refresh the stored Pages list whenever the user triggers the existing account re-sync action.
- **FR-012**: The screen MUST read Pages from stored data rather than contacting Meta on each page view. Meta is contacted for Pages in exactly two situations: completing Facebook authorisation, and an explicit user-triggered re-sync. No scheduled or background job refreshes Pages.
- **FR-013**: A re-sync MUST replace the user's stored Pages with the current set — Pages the user no longer manages MUST disappear, newly managed Pages MUST appear, and changed names, pictures, and follower counts MUST be updated.
- **FR-014**: If retrieving Pages fails during a re-sync, the system MUST NOT fail the ad account sync, MUST leave previously stored Pages intact, and MUST inform the user in simple Arabic that the Pages list could not be updated.
- **FR-015**: If a connection does not include Page visibility, the system MUST NOT show an error and MUST hide the Pages section; that connection is instead handled by the reconnect note in FR-024–FR-029. A connection that *does* include Page visibility but returns no Pages is simply a user with no Pages (FR-029).

**Data lifecycle and isolation**

- **FR-016**: Every stored Page record MUST be owned by exactly one user, and every read of Page data MUST be scoped to the requesting user. No user may ever see another user's Pages.
- **FR-017**: Disconnecting the Meta account MUST delete all of that user's stored Page records as part of the same data deletion that clears their other data.
- **FR-018**: Deleting a user account MUST delete that user's stored Page records.
- **FR-019**: Reconnecting after a disconnect MUST rebuild the Pages list from the newly connected account, with no records surviving from the previous connection.

**Boundaries**

- **FR-020**: The system MUST NOT post to, modify, manage, or take any action on any Facebook Page. This feature is read-only display only.
- **FR-021**: The system MUST NOT request any capability beyond what is needed to read the list of Pages the user manages and their name, picture, and follower count.
- **FR-022**: The Pages section MUST NOT block, delay, or gate the ad account picker — a user who ignores the Pages list can still select an ad account exactly as before.
- **FR-023**: The system MUST NOT persist the per-Page access token that Meta returns with each Page. It MUST be discarded once the Page's displayable details have been read, and MUST never be written to storage, logs, or any user-facing response.

**Existing connections**

- **FR-024**: The system MUST record which permissions each Meta connection was granted, and MUST be able to tell a connection that includes Page visibility apart from one that does not.
- **FR-025**: When a user has an active connection that does not include Page visibility — whether because it was created before the permission was requested, or because the user declined the permission — the system MUST show a one-time, dismissible note in simple Arabic on the Meta connection screen explaining that reconnecting will show their Pages, with the existing connect action as the path forward.
- **FR-026**: Once dismissed, the note MUST NOT reappear for that user. It MUST also disappear permanently once their connection includes Page visibility, whether or not it was dismissed.
- **FR-027**: The note MUST NOT be shown to users with no connection, to users whose connection already includes Page visibility, or to demo-mode users.
- **FR-028**: The note MUST NOT block or gate any existing action — a user who ignores or dismisses it keeps working exactly as before, including selecting an ad account and opening their dashboard.
- **FR-029**: A connection that includes Page visibility but returns no Pages MUST show neither the Pages section nor the note — this user manages no Pages and needs no prompt.

### Key Entities

- **Facebook Page**: A Page the connected user manages. Attributes: the Page's identifier as known to Meta, display name, profile picture reference, follower count, and the time the record was last refreshed. Explicitly excluded: the per-Page access token Meta returns (FR-023). Belongs to exactly one Qarar user, and is unique per (user, Page identifier) — the same Page reachable by two users is stored once per user. Multiple Pages may belong to one user; a user may have none.
- **Meta Connection** *(existing)*: The user's authorised link to their Meta account. Its active/expired state determines whether the Pages section is eligible to render, and its removal triggers deletion of that user's Pages.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After completing Facebook authorisation, an advertiser who manages at least one Page sees their Pages listed on the connection screen without taking any additional action.
- **SC-002**: 100% of listed Pages display a name and either a profile picture or its placeholder; no listed Page renders as a blank or broken row.
- **SC-003**: An advertiser can confirm whether Qarar is connected to the correct Meta account within 10 seconds of landing on the connection screen, without opening Facebook or any other tool.
- **SC-004**: The Pages section renders from stored data with no additional wait beyond the rest of the connection screen — the ad account picker remains usable within the same load.
- **SC-005**: A user whose connection includes Page visibility but who manages no Pages sees a screen visually identical to today's connection screen — zero added elements, including no reconnect note.
- **SC-006**: After a re-sync, the displayed Pages match the user's current Pages on Meta with zero stale entries.
- **SC-007**: In cross-user testing, zero Page records are ever returned to a user other than their owner.
- **SC-008**: After disconnect, zero Page records remain for that user.
- **SC-009**: A failed Pages retrieval never prevents an advertiser from selecting an ad account or opening their dashboard.
- **SC-010**: Every user with a connection predating Page visibility sees the reconnect note exactly once until they act on or dismiss it; users who already have Page visibility, and users with no connection, never see it.
- **SC-011**: A user who follows the note and reconnects sees their Pages listed immediately on returning to the connection screen, with no further action.
- **SC-012**: Zero per-Page access tokens exist anywhere in stored data, logs, or API responses — verifiable by inspection after a sync.

## Clarifications

### Session 2026-08-02

- Q: Users who already connected their Meta account before this feature shipped did not grant Qarar visibility into their Pages. How should they get their Pages list? → A: Detect the older grant from the permissions recorded on their connection, and show them a one-time dismissible note in simple Arabic inviting them to reconnect and see their Pages.
- Q: Meta returns a per-Page access token alongside each Page's details. Should it be stored? → A: No. Discard it on arrival and never persist it — the feature is display-only and has no use for a credential capable of acting as the Page.
- Q: "Follower count" — the Page's followers, or the legacy page-likes count? → A: Followers only, with no fallback to likes. If followers is unavailable for a Page, omit the line for that Page.
- Q: How many Pages show before the list is truncated? → A: 5, then an "عرض الكل" control reveals the rest.
- Q: What triggers a Pages refresh? → A: Exactly two — completing Facebook authorisation, and the user's explicit re-sync. No scheduled or background refresh; the existing daily refresh is not extended to Pages.

## Assumptions

- **"Pages the user manages"** means every Page the connected user has a role on and that Meta returns for that user, without filtering by role level (admin, editor, analyst, etc.).
- **Ordering**: Pages are listed by follower count from highest to lowest, so the advertiser's most recognisable Page appears first. Ties fall back to name. Pages whose follower count is unavailable (FR-005) sort last, ordered by name among themselves — they never displace a Page with a known count.
- **Profile pictures** are displayed from the image reference Meta provides; these references can expire, which is why FR-004 requires a placeholder fallback.
- **Refresh cadence**: Pages refresh only on authorisation completion and user-triggered re-sync (FR-012). The existing daily refresh job is deliberately left untouched — it refreshes performance snapshots for known accounts, and adding a Pages call would cost a Graph round-trip per user per day for data users consult mainly at connection time.
- **Demo mode is unaffected** — the demo account is synthetic and has no Pages, so the section never appears for it.
- **This feature adds no new screens or navigation.** It is a section on the existing Meta connection screen.
- **Existing disconnect and account-deletion flows are extended**, not replaced, to cover Page records.
- **Follower counts are point-in-time values** captured at the last sync; the feature makes no claim that they are live, and no history or trend of follower counts is stored or shown.
