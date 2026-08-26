# Self-review — Spec 014 (Diagnosis Evidence & Honest Fallbacks)

**Reviewer**: Claude (self-review of commits `ce80a88`, `33a6b0f`)
**Branch**: `014-diagnosis-evidence-fallbacks` · worktree `D:\Qarar-diagnosis-evidence`
**Date**: 2026-08-26

> ### ⚠️ Status: **PRE-REMEDIATION — archived**
>
> Every defect below (F1–F6) was **fixed** in the remediation pass of
> 2026-08-26. See *Self-review remediation pass* in
> [`docs/impl-log-014.md`](./impl-log-014.md) for what changed, the
> mutation check proving each fix is covered, and the final verification
> numbers. This document is kept as the record of what the audit found,
> not as the current release status.

**Verdict at the time of the audit**: **Ships, with four defects to fix first.** Items 1–8 below were each verified
against live source and live test runs; every claim carries its evidence. Three real
correctness defects and one vacuous test were found — none of them are caught by the
suite as written.

---

## Summary of findings

| # | Severity | Finding |
|---|----------|---------|
| **F1** | **HIGH** | `funnelConfirmedText` hardcodes archetype `"paid_lto"` when computing the step-4 conversion figure, while rung 5 evaluates on the real archetype. On appointment/webinar accounts the `FUNNEL_CONFIRMED` ladder prints a percentage derived by a different rule than the one that licensed the claim. |
| **F2** | **HIGH** | The C4 W5 guard's "funnel flag" half is dead code. `evaluateCampaign` already sets `ctaUrl` on every W5 `Fired`, so `diagnose`'s `fired.ctaUrl` check is structurally always true. Contract C4.3's *closed* state is never exercised — scenario 8 passes because W5 never fires, not because the guard closed. |
| **F3** | **MEDIUM** | The C4 guard reads the legacy `w3d.cpa`, but W5 itself fires on the archetype-aware `effectiveCpa`. An appointment/webinar campaign with a measured cost-per-lead fires W5 and is then denied its own evidence path. |
| **F4** | **MEDIUM** | Scenario 7 (the production `FUNNEL_CONFIRMED` route) does not carry the SC-004 three-figure assertion or the SC-004a assertion that the remediation pass moved onto it. Its only figure check is `/[0-9]+/`, which any digit satisfies. |
| **F5** | LOW | Two test titles contain a literal U+FFFD replacement character where 🔴 was intended (`server/engine.diagnosis.test.ts:541`, `:591`). |
| **F6** | LOW | `client/src/pages/Dashboard.swr.test.tsx:109` mocks `@/components/DiagnosisSection`, a module that does not exist. Pre-existing, not introduced by 014, but now misleading since `DiagnosisSection` became a named export of `Dashboard.tsx`. |

Items 1, 2, 3, 5, 6 of the review request **pass clean**. Items 4, 7, 8 pass with the notes below.

---

## 1. FR-015 — no comparison against `text_ar` in the selector or the summary predicate

**PASS.** Every `text_ar` occurrence inside `diagnose()` is a write. There is no read-side
comparison anywhere in `server/engine.ts`.

Selector body (`server/engine.ts:1135-1341`), grepped for text reads:

```text
$ sed -n '1135,1341p' server/engine.ts | grep -n 'text_ar|reason_ar|includes(|indexOf|=== "<arabic>"'
21:      text_ar: `سعر الظهور مرتفع على هذا الإعلان تحديدًا (...)`,
29:      text_ar: `ضغط الناس على الإعلان قليل (...)`,
37:      text_ar: `الناس تتفاعل مع الإعلان (...)`,
45:      text_ar: `${Math.round(...)}% فقط ممن ضغطوا وصلوا لصفحتك (...)`,
67:      text_ar: adClean
99:          text_ar: funnelConfirmedText(o, ev, baselines, "w5", cpa),
113:          text_ar: insufficientDataText(o),
122:          text_ar: AD_FAULT_COPY[code](),
130:          text_ar: noBlameAssignableText(o, ev, baselines),
143:          text_ar: funnelConfirmedText(o, ev, baselines, "clause4", null),
153:          text_ar: insufficientDataText(o),
```

All eleven are object-literal assignments. `buildSummary` (`:2063`-end) has exactly one hit,
also a write:

```text
$ sed -n '2063,2400p' server/engine.ts | grep -n 'text_ar|reason_ar|includes(|indexOf'
156:        reason_ar:
```

Repo-wide read-side sweep:

```text
$ grep -n 'fired\.reason_ar|fired\.action|text_ar\s*===|text_ar\s*!==|text_ar\.includes|reason_ar\.includes|reason_ar\s*===|action\.includes' server/engine.ts
946: * `fired.reason_ar` verbatim and without printing the code itself      # a comment
1815:      action_ar: fired.action,                                          # a write
1940:      action_ar: fired.action,                                          # a write
```

The client is clean too — `client/src/pages/Dashboard.tsx` contains no `includes(`,
`indexOf(`, `startsWith(` or `text_ar ===`.

Every branch in `diagnose()` selects on `RULE_FAULT[fired.rule]`, `fired.rule === "W5"`,
`o.level`, `fired.ctaUrl` and the `RungEvaluation` — never on copy. `buildSummary` selects
on `f.outcome` and `RULE_FAULT[row.rule]`:

```ts
// server/engine.ts:2199-2209
const qualifyingOutcome = (outcome: DiagnosisOutcome): boolean =>
  outcome === "RUNG_CONVERSION" || outcome === "FUNNEL_CONFIRMED";
const adBlameExcluded = (row: EngineRow): boolean => {
  if (RULE_FAULT[row.rule] === "ad-fault") return true;
  return row.findings.some(f =>
    f.outcome === "RUNG_CPM"      || f.outcome === "RUNG_HOOK" ||
    f.outcome === "RUNG_MISMATCH" || f.outcome === "RUNG_ARRIVAL"
  );
};
```

**Caveat, not a failure:** `fired.ctaUrl` is used at `:1229` as a *proxy channel* for the
`funnel.htoUnderperforming` flag. That is not text-matching, so FR-015 holds literally — but
it is the same category of implicit coupling, and it is the mechanism that produces **F2**.

---

## 2. RULE_FAULT — 24 codes, K7 is `neither`, no default bucket

**PASS.** Full table, `shared/qarar.ts:469-503`:

```ts
export const RULE_FAULT: Record<RuleCode, RuleFaultClass> = {
  // ad-fault (5) — rulebook text names the creative / hook / ad unit.
  K1: "ad-fault",  K3: "ad-fault",  K4: "ad-fault",  F1: "ad-fault",  F2: "ad-fault",
  // funnel-fault (3)
  W3: "funnel-fault",  W4: "funnel-fault",  W5: "funnel-fault",
  // neither (16) — research §R3.3 / §R3.4. K7 explicitly classified
  // `neither` here (cost-ceiling comparison, not a funnel measurement).
  K2: "neither",  K5: "neither",  K6: "neither",  K7: "neither",
  CB1: "neither", CB2: "neither", W1: "neither",  W2: "neither",  W6: "neither",
  S1: "neither",  S2: "neither",  S3: "neither",  S4: "neither",
  NS1: "neither", NS2: "neither", GATE: "neither",
};
```

Mechanical count of entries:

```text
$ sed -n '/export const RULE_FAULT/,/^};/p' shared/qarar.ts | grep -cE '^\s+[A-Z]+[0-9]*: "'
24
```

5 + 3 + 16 = 24. **K7 is `neither`**, matching the author's 2026-08-26 resolution and
research §R3.3.

No fallback anywhere:

```text
$ grep -rn '\?\?\s*"neither"|\|\|\s*"neither"|RULE_FAULT\[[^]]*\]\s*\?\?' --include=*.ts --include=*.tsx .
(no output — exit 1)

$ grep -rn 'as RuleFaultClass|RuleFaultClass\b' --include=*.ts --include=*.tsx server client shared
server/engine.ts:35:  RuleFaultClass,
server/engine.ts:1212:    const faultClass: RuleFaultClass = RULE_FAULT[fired.rule];
shared/qarar.ts:446:export type RuleFaultClass = "ad-fault" | "funnel-fault" | "neither";
shared/qarar.ts:465: * Spec 014 / research §R3 — total `Record<RuleCode, RuleFaultClass>`
shared/qarar.ts:469:export const RULE_FAULT: Record<RuleCode, RuleFaultClass> = {
```

No cast, no `??`, no `||`. Totality is compiler-enforced by `Record<RuleCode, …>` and
runtime-checked by `engine.diagnosis.test.ts:708-715`. All four consuming sites
(`engine.ts:1193`, `:1212`, `:2202`, plus the test sites) index directly.

---

## 3. V10 — `ctaUrl` only on `FUNNEL_CONFIRMED` and `RUNG_CONVERSION`

**PASS, and stronger than the test proves.** There are exactly three sites in `diagnose()`
that put a `ctaUrl` on a `Finding`, and each is adjacent to its `outcome`:

```text
$ grep -n -B6 'ctaUrl:' server/engine.ts | grep 'outcome:|ctaUrl:'
1200-      outcome: "RUNG_CONVERSION",
1205:      ctaUrl: DISCOVERY_CALL_URL,
1232-          outcome: "FUNNEL_CONFIRMED",
1235:          ctaUrl: DISCOVERY_CALL_URL,
1276-          outcome: "FUNNEL_CONFIRMED",
1279:          ctaUrl: DISCOVERY_CALL_URL,
```

The other three `DISCOVERY_CALL_URL` hits are **not** on findings: `:1536` and `:1869` are on
the W5 `Fired` (the rule object), and `:2220` is the account-level summary card.

The assertion test, `server/engine.diagnosis.test.ts:724-736`:

```ts
describe("ctaUrl discipline — appears only on FUNNEL_CONFIRMED or RUNG_CONVERSION", () => {
  it("every fixture finding obeys V10", () => {
    const r = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as any);
    for (const row of r.rows) {
      for (const f of row.findings) {
        if (f.ctaUrl) {
          expect(["FUNNEL_CONFIRMED", "RUNG_CONVERSION"]).toContain(f.outcome);
        }
      }
    }
  });
});
```

**Note on rigour:** this asserts over the demo fixture only. It would not catch a fourth
`ctaUrl` site on an outcome the demo snapshot never reaches. The structural grep above is
the real guarantee; the test is a regression tripwire over one fixture. That is acceptable,
but the test's name overstates what it checks.

---

## 4. Scenario 18 (selector purity) in isolation

**PASS.** Raw output:

```text
$ npx vitest run server/engine.diagnosis.test.ts -t "Scenario 18" --reporter=verbose

 RUN  v2.1.9 D:/Qarar-diagnosis-evidence

 ✓ server/engine.diagnosis.test.ts > Scenario 18 — selector purity: outcome does not
   depend on Arabic copy > replacing fired.reason / fired.action with arbitrary strings
   does not change the outcome

 Test Files  1 passed (1)
      Tests  1 passed | 22 skipped (23)
   Start at  21:25:07
   Duration  1.31s
```

The test (`:625-701`) covers all four terminal outcomes and permutes with three
replacements — `""`, Latin text, and a string built from `BLAME_CLAIMS.join(" / ")` plus
`AD_HEALTH_CLAIMS.join(" / ")`. It asserts `outcome` and `ctaUrl` are unchanged, and that
`fired` was not mutated.

**Naming drift, worth recording:** T053 and the spec say "permute `fired.reason_ar`". The
`Fired` interface (`server/engine.ts:87-95`) has no `reason_ar` — the field is `reason`,
and `reason_ar` is the wire name on `EngineRow`. The test permutes `reason`/`action`, which
is the correct field. The spec wording is what is wrong, not the code.

---

## 5. Scenarios 5 and 6 labelled synthetic

**PASS — in both the name and the comment.**

```ts
// server/engine.diagnosis.test.ts:286-293
// ============================================================
// Scenario 5 — SYNTHETIC selector unit test. Fully clean rungs
// with a funnel-fault fired rule → FUNNEL_CONFIRMED on the
// clause-4 route (C2.2 clause 4). Reachable only because
// `diagnose()` takes `fired` as a parameter — see research §R3.3.
// ============================================================
describe("[synthetic selector] Scenario 5 — fully clean + funnel-fault → FUNNEL_CONFIRMED (clause 4)", () => {
```

```ts
// server/engine.diagnosis.test.ts:322-328
// Scenario 6 — SYNTHETIC selector unit test. Funnel-fault rule
// with rung 5 unevaluable → INSUFFICIENT_DATA on the clause-5
// fall-through (C2.2 clause 5 / FR-006b). Reachable only because
// `diagnose()` takes `fired` as a parameter — see research §R3.3.
// ============================================================
describe("[synthetic selector] Scenario 6 — funnel-fault + unevaluable rung 5 → INSUFFICIENT_DATA", () => {
```

Both carry the `[synthetic selector]` prefix in the runner output and both cite research
§R3.3 with the reason. This satisfies the I4/I5 remediation exactly.

---

## 6. C6.1a condition 2 — the account card never renders from an ad-fault row

**PASS.** The predicate, `server/engine.ts:2201-2213`:

```ts
const adBlameExcluded = (row: EngineRow): boolean => {
  if (RULE_FAULT[row.rule] === "ad-fault") return true;      // condition 2
  return row.findings.some(f =>                               // condition 1
    f.outcome === "RUNG_CPM"      || f.outcome === "RUNG_HOOK" ||
    f.outcome === "RUNG_MISMATCH" || f.outcome === "RUNG_ARRIVAL"
  );
};
const accountRowQualifies = rows.some(
  r => !adBlameExcluded(r) && r.findings.some(f => qualifyingOutcome(f.outcome))
);
```

Condition 2 is present and evaluated **first**, which matters: the quickstart troubleshooting
note is right that condition 1 alone cannot catch a row whose rungs 1–4 were all unevaluable.

The test, `server/engine.diagnosis.test.ts:541-564`:

```ts
describe("Scenario 14 — ad-fault 🔴 row does NOT fund the account card", () => {
  it("the row's RUNG_CONVERSION stands, but the account card is null without a second qualifying row", () => {
    const snap = buildAdFaultRowWithRung5();
    const r = runEngine(snap, DEMO_FUNNEL as any);
    const adFaultRow = r.rows.find(
      row => RULE_FAULT[row.rule] === "ad-fault" &&
             row.findings.some(f => f.outcome === "RUNG_CONVERSION")
    );
    expect(adFaultRow, "an ad-fault row with RUNG_CONVERSION must exist").toBeDefined();
    expect(adFaultRow!.findings.some(f => f.outcome === "RUNG_CONVERSION")).toBe(true);
    expect(r.summary.account_funnel_cta).toBeNull();
  });

  it("adding a second, non-ad-fault row with a clean funnel signal returns the card", () => {
    const snap = buildAdFaultRowWithRung5(/* secondQualifyingRow */ true);
    const r = runEngine(snap, DEMO_FUNNEL as any);
    expect(r.summary.account_funnel_cta).not.toBeNull();
  });
});
```

The second case is the important one: it proves the exclusion is **per-row**, not
per-account, which is the distinction FR-010b turns on. Both pass.

---

## 7. Files touched

**No artifact in this repo is literally named a "hard-rules allow-list."** I searched
`specs/014-*/**.md`, `CLAUDE.md` and `.specify/memory/constitution.md` for
`allow-list|allowlist|allowed files|hard rule` and found nothing. The nearest binding
statement is `plan.md:23-24` and `:54-55`:

> The verdict pipeline is not touched. Every change is inside `diagnose()`, its three call
> sites, the `Finding` shape, the `buildSummary` funnel-CTA predicate, and the
> `DiagnosisSection` render path.
>
> **Scale/Scope**: One engine function and its three call sites, one shared type module,
> one summary predicate, one React section. Roughly 5 files touched; no migration, no new endpoint.

I reviewed against that declared scope. Actual files:

```text
$ git show --name-status ce80a88
M	client/src/pages/Dashboard.tsx
A	client/src/pages/DiagnosisSection.test.tsx
A	docs/impl-log-014.md
A	server/engine.diagnosis.test.ts
M	server/engine.ts
M	shared/qarar.ts
A	specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json

$ git show --name-status 33a6b0f
M	CLAUDE.md
```

| File | In declared scope? |
|------|--------------------|
| `server/engine.ts` | ✅ `diagnose()`, its three call sites, `buildSummary` predicate |
| `shared/qarar.ts` | ✅ the shared type module (`Finding`, `DiagnosisOutcome`, `RULE_FAULT`, `DIAGNOSIS_GATES`) |
| `client/src/pages/Dashboard.tsx` | ✅ the `DiagnosisSection` render path — it lives inside `Dashboard.tsx`, not a separate file |
| `server/engine.diagnosis.test.ts` | ✅ named in plan Testing: "New specs land in `server/engine.diagnosis.test.ts`" |
| `client/src/pages/DiagnosisSection.test.tsx` | ✅ new test, T003 |
| `specs/014-*/verdict-baseline.json` | ✅ new fixture, T001 |
| `docs/impl-log-014.md` | ⚠️ not anticipated by the plan; a log, harmless |
| `CLAUDE.md` | ⚠️ separate chore commit, not part of the feature |

**Six files of feature code + fixtures, against "roughly 5"** — within tolerance, and the
plan's `DiagnosisSection` "file" turned out to be a section of `Dashboard.tsx`.

**The guarded files are provably untouched:**

```text
$ git log --oneline ce80a88^..HEAD -- server/nonSalesContainment.test.ts \
    server/engine.test.ts server/__snapshots__/engine.test.ts.snap server/engine.bottleneck.test.ts
(empty)
```

This satisfies spec A4 / C9.3 (`nonSalesContainment.test.ts` green **and unmodified**) and
SC-005 (stored snapshot unchanged).

---

## 8. `npx vitest run`, `npm run check`, snapshot diff

### `npm run check` — clean

```text
> qarar@1.0.0 check
> tsc --noEmit

[exited with code 0]
```

**Zero errors. SC-006 satisfied.**

### Snapshot diff — content-identical

```text
$ git diff --numstat server/__snapshots__/engine.test.ts.snap
warning: in the working copy of 'server/__snapshots__/engine.test.ts.snap', LF will be replaced by CRLF the next time Git touches it
(no numstat rows)

$ git diff --word-diff=porcelain --ignore-cr-at-eol server/__snapshots__/engine.test.ts.snap
warning: in the working copy of 'server/__snapshots__/engine.test.ts.snap', LF will be replaced by CRLF the next time Git touches it
(no hunks)
```

`git status` reports the file as ` M`, but that is **purely a CRLF working-copy artifact** —
`--numstat` returns no rows and the word-diff is empty. Content is byte-identical to the
committed version. **SC-005 satisfied.** No re-recording occurred.

### `npx vitest run` — 620 passed, 1 pre-existing environmental failure

```text
 ⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed
 ❯ server/auth-flow.e2e.test.ts:22:13
     20|     db = await getDb();
     21|     if (!db) {
     22|       throw new Error("Database connection failed");
       |             ^
     23|     }
     24|   });

 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 54 passed (55)
      Tests  620 passed | 11 skipped (631)
   Start at  21:23:33
   Duration  16.86s

[exited with code 0]
```

**Stating this plainly: the suite is not fully green.** `server/auth-flow.e2e.test.ts` fails
in `beforeAll` because no database is reachable in this environment. It is **not** touched by
either 014 commit (absent from both `--name-status` listings) and does not import anything
from the diagnosis path, so it is environmental and pre-existing — but the quickstart's
definition-of-done item 1 says "`npm test` green", and it is not. That needs a database or an
explicit exclusion before the DoD can be honestly ticked. Note also that vitest exited `0`
despite the failed suite, so CI keyed on the exit code would not catch this.

The two 014 suites in isolation:

```text
$ npx vitest run server/engine.diagnosis.test.ts client/src/pages/DiagnosisSection.test.tsx

 ✓ server/engine.diagnosis.test.ts (23 tests) 81ms
 ✓ client/src/pages/DiagnosisSection.test.tsx (6 tests) 71ms

 Test Files  2 passed (2)
      Tests  29 passed (29)
   Duration  3.10s
```

All 18 required scenarios are present (`Scenario 1` … `Scenario 18`), plus the RULE_FAULT
totality check, the V10 ctaUrl-discipline check, and the C3.4a null-median check.

---

## The defects, in detail

### F1 (HIGH) — the funnel ladder computes step 4 with the wrong archetype

`server/engine.ts:1110-1115`, inside `funnelConfirmedText`:

```ts
// Step 4 — conversions as a share of landing-page views.
if (w.lpViews > 0) {
  const conv = effectiveConversionsLocal(o, "paid_lto") ?? 0;   // ← hardcoded
  const cvr = (conv / w.lpViews) * 100;
  lines.push(`${cvr.toFixed(1)}% من زوار الصفحة اشتروا`);
}
```

`funnelConfirmedText` never receives `archetype`. But rung 5 — the rung whose `clean` state
is what licenses `FUNNEL_CONFIRMED` in the first place — uses the real one
(`server/engine.ts:213`):

```ts
const conv = effectiveConversionsLocal(o, archetype);
```

and `effectiveConversionsLocal` (`:226-235`) returns a *different field* for two archetypes:

```ts
if (archetype === "appointment" || archetype === "webinar") {
  return o.w3d.leadConversions;
}
return o.w3d.conversions;
```

**Failure mode.** An appointment or webinar account whose rung 5 is `clean` on
`leadConversions` prints a ladder whose step 4 is computed from `conversions` (purchases).
If purchases are zero — routine for an appointment funnel where the purchase happens
off-platform, which is precisely why the lead/purchase split exists — the line reads
«0.0% من زوار الصفحة اشتروا» inside the one outcome that is allowed to say the funnel was
confirmed healthy. The output contradicts the evidence that produced it. This is the exact
class of dishonesty spec 014 was written to remove, reintroduced in the copy layer.

**Fix**: thread `archetype` into `funnelConfirmedText` and pass it through. `diagnose()`
already has it in scope at both call sites (`:1233`, `:1277`).

**Why the suite misses it**: every diagnosis fixture calls
`diagnose(o, baselines, "paid_lto", fired)` — the one archetype for which the hardcode
happens to be correct.

### F2 (HIGH) — the C4 guard's flag half is dead code, and its closed state is untested

`diagnose()` re-derives the funnel flag from `fired.ctaUrl` (`server/engine.ts:1223-1229`):

```ts
// The campaign-level funnel flag is read from
// `funnel.htoUnderperforming` at the call site; the engine
// sees it through `fired.ctaUrl` being set (today's W5 path
// attaches the CTA there). We re-derive from the W5 Fired
// contract: W5 sets `fired.ctaUrl` and the guard opens only
// when the call site passed `true` (see runEngine).
if (fired.ctaUrl && cpa !== null) {
```

**The comment's last clause is false.** `evaluateCampaign` sets `ctaUrl` on *every* W5 `Fired`
it returns, unconditionally (`server/engine.ts:1530-1537`):

```ts
return {
  verdict: "watch",
  rule: "W5",
  reason: `... الإعلان بريء`,
  action: "...",
  ctaUrl: DISCOVERY_CALL_URL,      // ← always set
};
```

So the conditional spread at the call site (`:1866-1871`) adds nothing that was not already
there:

```ts
const fired: Fired =
  rawFired.rule === "W5" && !!funnel.htoUnderperforming && c.w3d.cpa !== null
    ? { ...rawFired, ctaUrl: DISCOVERY_CALL_URL }     // rawFired already has it
    : rawFired;                                       // and so does this branch
```

The behaviour is *accidentally* correct, because W5's own firing condition already requires
`htoUnderperforming` (`:1524`). But the guard is not enforcing what it claims to enforce, and
a future change to W5's firing condition would silently open the evidence path.

**The test does not catch this.** Scenario 8's own comment gives the game away
(`server/engine.diagnosis.test.ts:389-390`):

> `// The W5 guard fails (no measured CPA) — W5 does NOT fire (FR-009b, C4.3).`

Both sub-cases construct fixtures where W5 never fires at all — flag-only sets
`conversions: 0`, defeating W5's `conversions > 0` clause; CPA-only sets the flag false,
defeating W5's first clause. Neither case ever reaches `diagnose()` with a W5 `Fired`, so the
**closed** state of the C4 guard has zero coverage in the suite. Contract C4.3 is asserted by
tests that pass for an unrelated reason.

**Fix**: pass the flag explicitly — add a parameter to `diagnose()` rather than smuggling it
through `ctaUrl` — and rewrite scenario 8 to construct a W5 `Fired` directly (as scenarios 5
and 6 do) so the guard is genuinely exercised in its closed state.

### F3 (MEDIUM) — the guard reads the wrong CPA

W5 fires on the archetype-aware selector (`server/engine.ts:1518-1526`), with an explicit
comment saying why:

```ts
// T025 — campaign cpa is read through the archetype-aware selector so
// appointment / webinar compare on cost-per-lead (the judgement unit),
// not on the legacy cost-per-purchase figure that `o.w3d.cpa` carries.
const campaignCpa = effectiveCpa(o, archetype);
if (htoUnderperforming && conversions > 0 && campaignCpa !== null && campaignCpa <= 1.5 * t.unitTarget) {
```

But both halves of the C4 guard read the legacy field:

```text
server/engine.ts:1222      const cpa = o.w3d.cpa;
server/engine.ts:1869      c.w3d.cpa !== null
```

**Failure mode.** An appointment campaign with `htoUnderperforming = true` and a measured
cost-per-lead fires W5 — and is then denied its own evidence path because `w3d.cpa`
(cost-per-purchase) is null. It falls through to C2.2, where W5 is funnel-fault, so it lands
on clause 4 or 5 and almost certainly resolves to `INSUFFICIENT_DATA`. The row's verdict copy
meanwhile still asserts «الإعلان بريء … المشكلة في العرض», so the row says the ad is innocent
and the offer is the problem while its finding says there is not enough data. Contract C4.2
says only "a measured campaign CPA" without naming which — this is a spec ambiguity the
implementation resolved against the T025 precedent.

**Fix**: use `effectiveCpa(o, archetype)` at both sites, and pin the unit in C4.2.

### F4 (MEDIUM) — scenario 7 lost the assertions the remediation moved onto it

The pre-implementation remediation pass moved SC-004's three-figure assertion off the
synthetic fixture (T027 / scenario 5) and onto T029 / scenario 7, and added SC-004a there.
Neither landed. Scenario 7's entire figure check is
(`server/engine.diagnosis.test.ts:373`):

```ts
// C4.4 — the cost-per-customer figure appears in the text.
expect(f.text_ar).toMatch(/[0-9]+(\.[0-9]+)?/);
```

Any digit anywhere satisfies this — including the impressions count, which is always present.
It does not check that the cost-per-customer figure specifically appears, does not count three
distinct figures (SC-004), and does not assert that no step the campaign *could* have measured
is rendered unknown (SC-004a). By contrast the synthetic scenario 5 still splits on `" — "`
and inspects the ladder parts (`:316`), so the weaker assertion sits on the production route
and the stronger one on the synthetic route — the inverse of what the remediation decided.

**Fix**: port scenario 5's ladder-part assertions onto scenario 7, assert the
cost-per-customer figure appears verbatim, and assert the arrival and conversion steps are
printed (the `buildW5Snapshot` fixture sets `lpViews: 2000`, so both are measurable). Note
that C4.4 correctly and deliberately states the median step unavailable on the W5 route
(`server/engine.ts:1086-1092`) — that one exception should be asserted as present, not absent.

### F5 (LOW) — replacement characters in two test titles

Bytes `EF BF BD` (U+FFFD) sit where 🔴 was intended:

```text
$ python -c "<read the file as utf-8, print lines matching 'Scenario 14 '>"
538 '// Scenario 14 \ufffd Ad-fault row excluded from the account card'
```

Affects `server/engine.diagnosis.test.ts:538`, `:541`, `:588`, `:591`. Comments and
`describe` titles only — no behaviour. Worth a clean-up pass so the runner output is legible.

### F6 (LOW) — a mock pointing at a module that does not exist

```text
client/src/pages/Dashboard.swr.test.tsx:109: vi.mock("@/components/DiagnosisSection", () => ({
client/src/pages/Dashboard.swr.test.tsx:110:   DiagnosisSection: () => null,
```

`DiagnosisSection` lives in `client/src/pages/Dashboard.tsx`. This mock predates 014 and is
inert, but 014 made `DiagnosisSection` a named export, so the mock now reads as though it
were doing something. Either delete it or point it at the real module.

---

## Recommendation

**Fix F1, F2 and F3 before merge.** F1 makes the `FUNNEL_CONFIRMED` ladder print a figure that
can contradict the evidence licensing it — that is the feature's core promise. F2 leaves the
contract's own guard unenforced and its negative case untested. F3 denies the production
`FUNNEL_CONFIRMED` route to exactly the archetypes T025 was written to protect.

**Fix F4 in the same pass**, since F1 and F3 are both invisible to the suite today precisely
because scenario 7 asserts so little; strengthening it is how these stay fixed.

F5 and F6 are cosmetic and can ride along or wait.

Everything the review asked to *verify* — FR-015 purity, RULE_FAULT totality with K7 as
`neither`, V10 ctaUrl discipline, scenario 18, the synthetic labelling, C6.1a condition 2,
the file scope, `npm run check`, and the untouched snapshot — **holds**. The defects are in
territory the checks did not cover.
