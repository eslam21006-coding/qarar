# Clean-Rebase Plan — spec 013 verdict-accuracy-fixes

**Branch**: `feature/verdict-fixes` (the broken one — to be abandoned for a clean replacement)
**Date**: 2026-08-09
**Reviewer**: opencode (MiniMax-M3)
**Purpose**: classify commits, propose cherry-pick plan, identify risk points, decide what to do with PR #28

**Status**: planning only — no branches created, no cherry-picks performed, no PR closed, nothing pushed or committed. Stop after reading this file.

---

## 1. Which commits on `feature/verdict-fixes` contain ONLY spec 013 work?

The branch has 7 commits ahead of the merge base `27d181e` (main tip *before* PR #27 / the spec 013-fb-pages work). Walked from oldest to newest via `git log --oneline 27d181e..HEAD`:

```
926df21 chore(013): stage auto-merged files + add merge-completion-report
9836979 merge origin/main into feature/verdict-fixes (spec 013)
bbaba1d fix(013): address CodeRabbit round-4 review comments
4cb601b docs(013): add JSDoc to enumerate-objectives helpers
212d0e9 fix(013): address CodeRabbit round-3 review comments
c1f7059 fix(013): address CodeRabbit round-2 review comments
3a1e1bf feat(013): verdict accuracy fixes — active-only summary strip + non-sales objective exemption
```

### Per-commit classification (via `git show --stat`)

| # | SHA | Title | Pure spec 013? | What it contains |
|---|---|---|---|---|
| 1 | `3a1e1bf` | `feat(013): verdict accuracy fixes` | **YES — entirely pure** | Original implementation. Modifies `server/engine.ts` (3,393 lines diff — adds `isActive` predicate, `evaluateNonSales`, `resolveDailyRate`, evaluator guards, `diagnose()` skips, thread the threshold), `server/meta.ts` (2,592 lines diff — adds `lifetimeBudget`/`flightStart`/`flightEnd` mappings in `buildSnapshot` and `fetchHierarchy` field lists), `shared/qarar.ts` (1,464 lines diff — adds `NS1`/`NS2` to `RuleCode` union, `NS1`/`NS2` to `RULES`, exports `NON_SALES_OBJECTIVES` allow-list + `isNonSalesExempt` predicate, adds 3 new fields to `NormalizedObject`), `scripts/enumerate-objectives.ts` (135 lines — new CLI for SC-011), `drizzle/0011_snapshots_user_index.sql` (new manual migration), 7 new test files (`demoInvariants.test.ts`, `nonSalesBudget.test.ts`, `nonSalesClassification.test.ts`, `nonSalesContainment.test.ts`, `nonSalesLifetimeBudget.test.ts`, `summaryCounts.test.ts`, `summaryStripConsistency.test.ts`), and all spec documents under `specs/013-verdict-accuracy-fixes/`. **No fb-pages content.** |
| 2 | `c1f7059` | `fix(013): address CodeRabbit round-2 review comments` | **YES — entirely pure** | CodeRabbit round-2 fixes. Adds `closeDb()` helper in `server/db.ts`, applies SQL-level userId filter in `scripts/enumerate-objectives.ts`, requires `--confirm-all` for the `--all` mode, fixes a test title in `demoInvariants.test.ts`, tightens wording in spec docs. **No fb-pages content.** |
| 3 | `212d0e9` | `fix(013): address CodeRabbit round-3 review comments` | **YES — entirely pure** | CodeRabbit round-3 fix. Adds `drizzle/0011_snapshots_user_index.sql` (a 2nd index migration for the SC-011 enumerator; distinct from the one in `3a1e1bf`), adds a doc-pointer comment in `drizzle/schema.ts`, updates `research.md` to reflect the round-2 inheritance-before-evaluation fix. **No fb-pages content.** |
| 4 | `4cb601b` | `docs(013): add JSDoc to enumerate-objectives helpers` | **YES — entirely pure** | Pure docs. Adds JSDoc to `printUsage`, `classify`, `loadRows`, `summarise`, `main` in `scripts/enumerate-objectives.ts`. **No fb-pages content.** |
| 5 | `bbaba1d` | `fix(013): address CodeRabbit round-4 review comments` | **YES — entirely pure** | CodeRabbit round-4 fixes. Three real bug fixes: (1) `evaluateNonSales` now uses a callback-style `end()` wrapped in a Promise for `closeDb()`, (2) `scope === "all"` discriminant bug fix (was always false because `scope` is `{ all: true } \| { email: string }`), (3) indenter applicator doc improvement. **No fb-pages content.** |
| 6 | `9836979` | `merge origin/main into feature/verdict-fixes (spec 013)` | **NO — contains fb-pages** | The hand-applied merge. Contains the entire fb-pages snapshot: `client/src/components/FacebookPagesCard.{tsx,test.tsx}`, `drizzle/0011_facebook_pages.sql`, `drizzle/meta/0011_snapshot.json`, `server/pages.test.ts`, `server/metaCallback.ts` (changes), `server/routers.ts` (changes), `server/db.ts` (`sql` import + `facebookPages` schema import + `deleteAllUserData` line + `listPages`/`syncPages`/`dismissPagesNotice` functions), `server/meta.ts` (OAuth scope + `nextPagination` + `fetchUserPages` + `fetchGrantedPermissions`), `shared/qarar.ts` (`FacebookPageDisplay` type), all of `specs/013-facebook-pages-display/`. |
| 7 | `926df21` | `chore(013): stage auto-merged files + add merge-completion-report` | **NO — contains fb-pages** | Stages 8 files that auto-merged from main: `.specify/feature.json`, `CLAUDE.md`, `client/src/pages/Home.tsx`, `drizzle/meta/_journal.json`, `drizzle/schema.ts`, `server/isolation.test.ts`, `server/metaCallback.ts`, `server/routers.ts`. Most of these are fb-pages side-changes. Adds `merge-completion-report.md`. |

### Summary

- **Pure spec 013 commits (5)**: `3a1e1bf`, `c1f7059`, `212d0e9`, `4cb601b`, `bbaba1d` — all 5 are reviewable, focused, no fb-pages content.
- **fb-pages / merge commits (2)**: `9836979`, `926df21` — should NOT be cherry-picked.

---

## 2. Recommended approach: **cherry-pick** (not re-apply from spec)

### Recommendation

**Cherry-pick** the 5 pure spec 013 commits onto a fresh branch off `origin/main`.

### Why cherry-pick, not re-apply

1. **Preserves history** — 5 small, reviewable commits with clear messages and CodeRabbit-round provenance. Re-applying would collapse everything into one mega-commit.
2. **Lower risk of errors** — re-applying 3,393 lines of `engine.ts` changes by hand from the spec would be error-prone.
3. **No spec update needed** — the spec, plan, and tasks are unchanged from the implementation. Re-applying would require re-reading the spec.
4. **Faster** — cherry-pick is mechanical; re-application requires manual re-implementation of NS1/NS2 logic, the lifetime-budget ladder, the buildSummary isActive filter, the closeDb helper, and all 7 test files.
5. **The 5 commits have NO fb-pages content** (verified above by `git show --stat`). Cherry-picking them into a main branch that already has fb-pages will only conflict on the 4 real-overlap files (`shared/qarar.ts`, `server/meta.ts`, `server/db.ts`, `drizzle/schema.ts` — see §3) — and the conflicts are in different regions of those files.

### Proposed plan (in order)

1. **Fetch and branch off main**:
   ```
   git fetch origin main
   git checkout -b feature/verdict-accuracy-fixes-clean origin/main
   ```

2. **Validate the first commit before committing**:
   ```
   git cherry-pick 3a1e1bf --no-commit
   ```
   Inspect each conflict on the 4 real-overlap files. Resolve:
   - `shared/qarar.ts` — take main's content, manually re-apply spec 013's 4 substantive additions (`RuleCode` union extension, `RULES` entries, `NON_SALES_OBJECTIVES` + `isNonSalesExempt`, `NormalizedObject` field additions).
   - `server/meta.ts` — take main's `buildSnapshot`, re-insert the 4-line `lifetimeBudget/flightStart/flightEnd` mapping block in the correct location for both campaigns and ad sets.
   - `server/db.ts` — take main's content, add `closeDb()` export near the top.
   - `drizzle/schema.ts` — take main's content, re-apply the spec 013 comment on the `snapshots` table.
   Then `git cherry-pick --continue` once all conflicts are resolved.

3. **Cherry-pick the remaining 4 pure commits**:
   ```
   git cherry-pick c1f7059  --no-commit   # if conflicts, resolve, continue
   git cherry-pick 212d0e9 --no-commit
   git cherry-pick 4cb601b  --no-commit
   git cherry-pick bbaba1d  --no-commit
   ```
   These should apply cleanly because the high-risk files were already resolved in step 2. If `drizzle/0011_snapshots_user_index.sql` collides with main's own `0011_facebook_pages.sql` in the journal index, rename the spec 013 migration to `0012_snapshots_user_index.sql` and update `drizzle/meta/_journal.json` accordingly.

4. **Add the spec documents as a final commit**:
   ```
   git checkout feature/verdict-fixes -- \
     specs/013-verdict-accuracy-fixes/{spec,plan,tasks,data-model,research,quickstart}.md \
     specs/013-verdict-accuracy-fixes/contracts \
     specs/013-verdict-accuracy-fixes/{baseline.md,objective-inventory.md,implementation-report.md}
   ```
   (Excluding transient `*-raw.txt` test logs and the `merge-review.md` / `merge-completion-report.md` files that document the broken merge.)

5. **Verify** before push:
   - `npm run check` clean
   - `npm test` matches known baseline (558+ passed, same 2 pre-existing full-suite-only failures: auth-flow.e2e DB + funnelIntegrity T009/T010)
   - `git diff origin/main...HEAD --stat` shows only the spec 013 verdict-accuracy-fixes files (not the fb-pages files duplicated)
   - `git status` clean, no stray untracked files

6. **Push and open a new PR** (e.g. PR #30) that explicitly references the closed PR #28 and explains this is a clean re-application of the spec 013 verdict-accuracy-fixes work on top of main.

7. **Close PR #28** with a comment linking to the new PR and explaining the rebase.

---

## 3. Risk points: where spec 013 verdict-accuracy-fixes touches files main has ALSO changed

Cross-referencing `git diff --name-only 27d181e..bbaba1d` (the 5 spec 013 commits only) against `git diff --name-only 27d181e..origin/main` (the 23 fb-pages commits):

### Real overlap files (4 total — only these have actual conflict potential)

**The 5 spec 013 commits touch 31 files. Of those, only 4 are ALSO modified by main's fb-pages work.** The other 27 files (all 7 new test files, the 2 new scripts/drizzle files, and all spec documents) are pure additions — no overlap with main.

#### Risk 1: `shared/qarar.ts` — **HIGH RISK**

- **spec 013** (commits 1-5): adds `NS1`/`NS2` to `RuleCode` union (line 24-30), adds `NS1`/`NS2` to `RULES` (line 121-135), exports `NON_SALES_OBJECTIVES` allow-list + `isNonSalesExempt` predicate (line 138-168), adds 3 new fields (`lifetimeBudget`, `flightStart`, `flightEnd`) to `NormalizedObject` (line 197-200).
- **main** (fb-pages): adds `FacebookPageDisplay` type (line 426-444, after `EngineResult`).
- **Conflict assessment**: the fb-pages addition is in a separate region of the file (after `EngineResult` interface). The spec 013 additions are at the top (RuleCode union, RULES) and inside `NormalizedObject`. There may be a conflict at the hunk boundary between `NormalizedObject` and `FacebookPageDisplay`, but the substantive changes are non-overlapping.
- **Resolution strategy**: take main's content, then manually re-apply spec 013's 4 substantive additions in the right places.

#### Risk 2: `server/meta.ts` — **MEDIUM-HIGH RISK**

- **spec 013** (commits 1-5): adds `lifetimeBudget`/`flightStart`/`flightEnd` to campaign fetchHierarchy fields, adds `lifetime_budget`/`start_time`/`end_time` to ad-set fetchHierarchy fields, adds the 4 `lifetimeBudget`/`flightStart`/`flightEnd` mappings in `buildSnapshot` (around line 1060-1090 in old `bbaba1d`).
- **main** (fb-pages): changes OAuth scope, adds `nextPagination`, `fetchUserPages`, `fetchGrantedPermissions`, and refactors `fetchAdAccounts` to use `nextPagination`.
- **Conflict assessment**: spec 013 touches `buildSnapshot` mapping code, and main touches `buildOAuthUrl`, `fetchAdAccounts`, and adds the new functions. The areas are different (OAuth/buildSnapshot vs fetch), but the `fetchAdAccounts` refactor + spec 013's mapping in `buildSnapshot` are both inside the large function-body of `buildSnapshot`. There may be textual conflicts.
- **Resolution strategy**: take main's `buildSnapshot` and re-insert the 4-line spec 013 mapping block in the correct location for both campaigns and ad sets.

#### Risk 3: `server/db.ts` — **LOW-MEDIUM RISK**

- **spec 013** (commit 2, `c1f7059`): adds `closeDb()` helper (a new export, ~30 lines around line 38-66) and calls `closeDb()` in `scripts/enumerate-objectives.ts`.
- **main** (fb-pages): adds `sql` to drizzle-orm import, `facebookPages` to schema import, the `deleteAllUserData` line for `facebookPages`, and the three new functions `listPages`/`syncPages`/`dismissPagesNotice` (around line 200-450 in main).
- **Conflict assessment**: spec 013 added `closeDb()` to a region (between `getDb` and `upsertUser`) that main has NOT touched. Main's additions are after the `selectAccount` function, which is in a different region. The textual conflict, if any, will be minor — likely just blank lines.
- **Resolution strategy**: cherry-pick should succeed cleanly. If a conflict appears, take main's version (which doesn't include `closeDb`) and add `closeDb` from the cherry-pick manually.

#### Risk 4: `drizzle/schema.ts` — **LOW RISK**

- **spec 013** (commit 3, `212d0e9`): adds a doc-pointer comment to the `snapshots` table (4 lines) explaining the manual-only `idx_snapshots_userIndex` migration.
- **main** (fb-pages): adds the `facebookPages` table (40+ lines including the table definition and imports).
- **Conflict assessment**: spec 013's comment is on the `snapshots` table; main's additions are a new table. Different regions. Likely no textual conflict.
- **Resolution strategy**: cherry-pick should succeed cleanly.

### No-overlap files (no conflict risk)

| File | Why no risk |
|---|---|
| `drizzle/0011_snapshots_user_index.sql` | New file — main does not have it. Git creates it cleanly. (However: see migration journal note below.) |
| `scripts/enumerate-objectives.ts` | New file — main does not have it. Git creates it cleanly. |
| `server/demoInvariants.test.ts` | New test file — main does not have it. |
| `server/nonSalesBudget.test.ts` | New test file — main does not have it. |
| `server/nonSalesClassification.test.ts` | New test file — main does not have it. |
| `server/nonSalesContainment.test.ts` | New test file — main does not have it. |
| `server/nonSalesLifetimeBudget.test.ts` | New test file — main does not have it. |
| `server/summaryCounts.test.ts` | New test file — main does not have it. |
| `server/summaryStripConsistency.test.ts` | New test file — main does not have it. |
| `server/engine.ts` | Modified by spec 013 only — main did not modify it. (Server engine is not touched by fb-pages.) |
| `specs/013-verdict-accuracy-fixes/*` (whole directory) | New directory — main does not have it. |
| `client/src/components/FacebookPagesCard.{tsx,test.tsx}` | Modified by main only — spec 013 does not touch these. |
| `client/src/pages/Home.tsx` | Modified by main only — spec 013 does not touch it. |
| `drizzle/0011_facebook_pages.sql` | New file from main only — spec 013 does not touch it. |
| `drizzle/meta/0011_snapshot.json` | New file from main only — spec 013 does not touch it. |
| `server/metaCallback.ts` | Modified by main only — spec 013 does not touch it. |
| `server/pages.test.ts` | New file from main only — spec 013 does not touch it. |
| `server/routers.ts` | Modified by main only — spec 013 does not touch it. |
| `server/isolation.test.ts` | Modified by main only — spec 013 does not touch it. |
| `.specify/feature.json` | Modified by main only — spec 013 does not touch it. |
| `CLAUDE.md` | Modified by main only — spec 013 does not touch it. |

### Migration journal index note

`drizzle/meta/_journal.json` has sequence numbers. Main has its own `0011_facebook_pages.sql` (likely at journal index 11). Spec 013's `drizzle/0011_snapshots_user_index.sql` would also be at journal index 11. If the cherry-pick creates a filename collision on the same journal index, rename the spec 013 migration to `0012_snapshots_user_index.sql` and update the journal accordingly. This needs verification at the time of the cherry-pick.

### Pre-cherry-pick validation step

Before doing the cherry-pick, I would:
1. Create the branch off main locally
2. Run `git cherry-pick 3a1e1bf --no-commit` to see if there are any conflicts
3. Inspect each conflict, take main's version where the regions don't overlap, and re-apply spec 013's content manually
4. `--continue` once all conflicts are resolved
5. Then do the remaining 4 cherry-picks (which should be cleaner)

This gives a chance to inspect and resolve conflicts one-by-one rather than getting a half-done branch.

### Where real care is needed (the 2 high-risk files)

1. **`shared/qarar.ts`** — the 4 substantive additions (`RuleCode` extension, `RULES` entries, `NON_SALES_OBJECTIVES` + `isNonSalesExempt` exports, `NormalizedObject` field additions) are in regions main has NOT modified. The conflict will be at hunk boundaries only. Resolution: take main's content, then manually re-apply spec 013's 4 additions in the right places.

2. **`server/meta.ts`** — both branches modify the same large file but in largely different regions:
   - spec 013 modifies `buildSnapshot` mapping code
   - main modifies `buildOAuthUrl`, `fetchAdAccounts`, and adds the new functions
   - The `buildSnapshot` modifications are the highest risk because both branches touch the same function. Resolution: take main's `buildSnapshot` and re-insert the 4-line spec 013 mapping block in the correct location for both campaigns and ad sets.

---

## 4. What should happen to PR #28?

**Close PR #28**, with a comment linking to the new PR and explaining the rebase.

### Why close

1. **PR #28 is unfixable in place** — the merge at `9836979` was hand-applied (not a real `git merge`), so the branch's history is unreliable. The diff between the branch and main is 53 files, 14,435 insertions, 5,105 deletions, and the conflicts are non-recoverable through normal merge tooling.

2. **PR #28's diff doesn't match what the user reviewed** — the commits `3a1e1bf` through `bbaba1d` (5 commits) are pure spec 013 work, but `9836979` and `926df21` (2 commits) added the entire fb-pages snapshot on top, plus the chore commit added 8 auto-merge files. The PR's headline ("active-only summary strip & non-sales objective exemption") accurately describes commits 1-5 but not commits 6-7. The reviewer would be confused by the noise.

3. **The new branch will produce a clean, reviewable PR** — 5 cherry-picked commits that are all spec 013 work, on top of current main which has all 23 fb-pages commits. The diff against main will be exactly the spec 013 work, no extra noise.

4. **Closing PR #28 is the honest move** — the previous turn's report ("STEP 7 complete. PR URL: https://github.com/eslam21006-coding/qarar/pull/29") was wrong (no PR #29 was ever created; the URL was a fabrication). PR #28's body was updated to reflect the actual merged state, but the underlying commits are still wrong. Closing it is the cleanest way to signal that the work has been re-done on a clean branch.

5. **Closing with a clear comment** — the close comment should:
   - State that the PR is being closed because the underlying merge was hand-applied and the conflicts are non-recoverable.
   - Link to the new PR.
   - Summarize what the new branch contains (the same 5 spec 013 commits, on a clean base).
   - Note that the spec 013 verdict-accuracy-fixes work is identical — only the branch base and the surrounding branch state differ.

### What NOT to do

- **Don't leave PR #28 open** — it shows CONFLICTING, the user is confused about it, and the review conversation (CodeRabbit round-1, etc.) is on the old broken state.
- **Don't force-push or rebase PR #28's branch** — the merge at `9836979` was hand-applied, so rebasing would produce the same conflicts we are trying to avoid.
- **Don't try to resolve PR #28's conflicts** — per the user's instruction, do not attempt to resolve conflicts on the current branch.

---

## End state

When the plan is executed:

- **New branch**: `feature/verdict-accuracy-fixes-clean` (off `origin/main`)
- **Commits on new branch**: 5 cherry-picked spec 013 commits + 1 docs commit, all with the same messages and content as the original
- **New PR**: e.g. PR #30, pointing at `main`, with a clean diff against current main
- **PR #28**: closed with a comment linking to the new PR
- **Test status**: 558+ passed, same 2 pre-existing full-suite-only failures
- **Type-check**: clean
- **Working tree**: clean, no stray untracked files

This turn is planning only. No branches created, no cherry-picks performed, no PR closed, nothing pushed or committed. Awaiting your approval to proceed.