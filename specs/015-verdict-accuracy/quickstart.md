# Quickstart: validating Verdict Accuracy

**Feature**: `015-verdict-accuracy` · **Plan**: [plan.md](./plan.md) · **Spec**: [spec.md](./spec.md)

How to prove this feature works. Shape definitions live in [data-model.md](./data-model.md);
exact behaviour lives in [contracts/](./contracts/). This file is the run guide only.

## Prerequisites

- Node toolchain installed, dependencies present (`npm install` if the tree is fresh).
- No database migration is required for this feature — `drizzle/schema.ts` is untouched, so
  `npm run db:push` is **not** part of this validation.
- For the live replay in §4, access to the Meta ad account used in the 15–17 Oct 2026 evidence.
  Everything else is validated from fixtures and needs no credentials.

## 1. Gates

```bash
npm run check    # tsc — must report zero errors
npm test         # vitest — full suite
```

Both must pass before the feature is considered done. The `conversionValue` type change is the
most likely source of compile errors, because `DailyMetrics extends WindowMetrics` propagates it
into every `daily7` / `daily30` reader — expect `npm run check` to find those call sites for you.

## 2. Unit-level validation

Run the engine suites directly while iterating:

```bash
npx vitest run server/engine.test.ts
npx vitest run server/summaryCounts.test.ts
npx vitest run server/summaryStripConsistency.test.ts
npx vitest run server/meta.test.ts
npx vitest run client/src/pages/Settings.test.tsx
```

Seven existing tests must be **rewritten**, not repaired — they assert the behaviour this feature
reverses. They are listed with line numbers and reasons in
[research.md §4.1](./research.md). Two of them
(`summaryStripConsistency.test.ts:280–318`, `summaryCounts.test.ts:113–139`) carry comments
stating that a paused object keeps its kill verdict *by design*; that premise is the bug.

Snapshot updates are **deliberate**. When `server/__snapshots__/engine.test.ts.snap` changes,
review the diff line by line against [research.md §4.2](./research.md) before accepting with
`npx vitest run -u`. Two specific expectations:

- The `T007 — deriveTargets regression lock` block (snapshot lines 1–86) must come back
  **byte-identical**. Target derivation is untouched; a diff there means something leaked.
- On the analysis in §4.2, **no `T008` entry should change**: the demo fixture is all-`ACTIVE`
  with symmetric result counts, `ad_rescue` clears the 500 floor on the window total, and
  `cmp_scale` already satisfies the scale guard. An unexplained `T008` diff means a rule moved
  that should not have.

## 3. Scenario checks

Each row is a behaviour a reviewer can verify. Contract references give the exact expected
strings.

| # | Scenario | Expected | Contract |
|---|---|---|---|
| V1 | Registration-counting funnel; object with 0 registrations, 16 purchases, $809 spend | ⏳ `GATE`, mismatch reason, action pointing at Settings — **not** 🔴 K1 | [gate-order §G3](./contracts/gate-order.md) |
| V2 | Same funnel; object with 0 registrations and 0 purchases | 🔴 K1 unchanged | gate-order §G3 |
| V3 | Gated objects hold ≥ 50% of active spend | warning card at top of dashboard, links to Settings | [summary-counters §S6](./contracts/summary-counters.md) |
| V4 | Paused ad at 0% spend share | ⏳ with "موقوف" — not 🔴 K5 | [gate-order §G2](./contracts/gate-order.md) |
| V5 | Ad under review / rejected / with a billing issue | ⏳ with "قيد المراجعة" / "مرفوض" / "به مشكلة — راجعه في مدير الإعلانات" — never "موقوف" | gate-order §G2 |
| V6 | Ad in `IN_PROCESS` or `PREAPPROVED` | evaluated normally; verdict does not flicker | gate-order §G2 |
| V7 | Archived / deleted object | not rendered anywhere | gate-order §G2 |
| V8 | Any gated object | absent from "أين المشكلة تحديداً؟", top actions, and both counters | gate-order §G4 |
| V9 | Starved ad, 0 impressions | ⏳ K5, "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه" | [starvation §K2](./contracts/starvation-and-scale.md) |
| V10 | Starved ad, 800 impressions, CTR below median, 0 results, tired parent | 🔴 K5 unchanged | starvation §K3 |
| V11 | Starved ad, 300 impressions, CTR above median | ⏳ — **not** 🛟 | starvation §K3 |
| V12 | Ad below 10% on the 3-day total but ≥ 10% on one of the days | matrix does not fire | starvation §K2 |
| V13 | Account with 30-day median $300 and funnel math $45 | Settings shows $300 as the judging number + source line; both figures shown (>20% divergence) | [settings §T1](./contracts/settings-target-and-archetype.md) |
| V14 | Dashboard vs Settings | identical target and source | settings §T1 |
| V15 | Select the paid-event option, save, reload | stored `paid_lto` + `liveComponent=true`; the paid-event option is re-selected | settings §T2 |
| V16 | Chosen funnel counts registrations; account records ≥ 3× purchases | pre-save question with one-click switch; declining saves the original choice | settings §T3 |
| V17 | No snapshot present | save-time check skipped silently; save still succeeds with no delay | settings §T3 |
| V18 | Campaign: results > 0, no `action_values` | no "العائد 0.0x", no return-based rule | [unknown-vs-zero §U2](./contracts/unknown-vs-zero.md) |
| V19 | `actions` absent, link clicks > 0 | counts unknown, ⏳ naming the missing data, K1 stands down | unknown-vs-zero §U1 |
| V20 | `actions` absent, link clicks = 0 | genuine zero — K1/K3 evaluate normally | unknown-vs-zero §U1 |
| V21 | `actions` present, no purchase/lead entry | genuine zero — K1/K3 evaluate normally | unknown-vs-zero §U1 |
| V22 | Campaign, full-funnel return 3.2, cost 1.38× target | no "+20%"; "واصل بدون زيادة الميزانية" | [starvation §K4](./contracts/starvation-and-scale.md) |
| V23 | Campaign at or below target with healthy return | S2 "+20%" unchanged | starvation §K4 |
| V24 | Red ad inside a yellow ad set | `kill_ads = 1`, ad set not counted, bleed = the ad's spend | [summary-counters §S5](./contracts/summary-counters.md) |
| V25 | Red ad inside a red ad set | `kill_adsets = 1`, `kill_ads = 1`, bleed = ad-set spend only | summary-counters §S5 |
| V26 | Switch the table between campaign / ad-set / ad level | neither counter changes | summary-counters §S5 |
| V27 | Ad hitting the ad-level zero-result kill | action reads "أوقِف هذا الإعلان", not "أوقِف هذه المجموعة"; the three ad-set kill rules keep their own wording | spec FR-035 |
| V28 | Every fixture | no 🔴 row's reason claims no results while that row's `w3d.conversions > 0` | spec SC-009 |

## 4. Live-account replay (the acceptance baseline)

Re-run the account from the spec's evidence table over the 15–17 Oct 2026 window.

**Step 1 — settings left as they are** (funnel type still counts registrations):

All five campaigns show ⏳ with the settings-mismatch message. No row reads
"بدون أي نتيجة" or "0.0x". No paused or zero-impression ad appears in
"أين المشكلة تحديداً؟".

**Step 2 — switch to the paid-event option** (the correct setting for this paid webinar):

Purchases become the counted event. Specific Countries (b) reads 🟢; ES-WW is judged on its own
numbers; ABO 17 Oct is the campaign carrying a genuine loss signal.

> Per-geo judgment of ES-WW is **feature 017**, not this one. Here it simply must no longer be
> killed for having "no results", and must not be told to raise its budget while above target.

**Step 3 — counters agree**: the split counter matches the red ad-set and red ad rows, and the
daily bleed counts no spend twice.

## 5. Stale-snapshot caveat

Rows cached before deploy keep `conversionValue: 0` and carry no `resultsUnknown` flag, so a
genuinely-absent value can still read as "0.0x" on an un-refreshed account. The first refresh
after deploy writes the new shape; there is no back-fill. If V18 fails on a real account,
refresh it before investigating — see [unknown-vs-zero §U5](./contracts/unknown-vs-zero.md).

## 6. Definition of done

- `npm run check` clean; `npm test` green.
- Every V-scenario above verified.
- Every snapshot and test change accounted for in [research.md §4](./research.md), with a reason.
- Verdict set still exactly five; every rule code emitted verbatim (`shared/qarar.ts:24–31`).
- No new Meta request introduced anywhere — including the save path.
