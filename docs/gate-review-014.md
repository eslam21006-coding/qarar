# Constitutional gate review — Spec 014, PR #30

**Gate**: final review before merge to `main`
**Constitution**: `.specify/memory/constitution.md` v1.0.0 (ratified 2026-06-13)
**Audited**: branch head **`35e21b9`**, not `e316b71`

> **Scope correction.** The request named `e316b71` as the post-fix head. It is not — it is
> two commits behind. `d0a9a77` (CodeRabbit remediation) and `35e21b9` (a JSDoc placement fix)
> landed after it, and `d0a9a77` changes engine behaviour: it makes the conversion **noun**
> archetype-aware. Auditing `e316b71` would have reviewed code that is not what merges, and
> would have reported the step-4 verb defect as live when it is fixed. This review audits
> `35e21b9`.

**Final verdict: MERGE** — with two non-blocking CONCERNs recorded below (G1, G2). No principle
fails. Every hard invariant holds against live source and live runs, verified independently of
the impl-log's claims.

---

## Verdict table

| # | Principle | Verdict | Evidence |
|---|-----------|---------|----------|
| I | Deterministic engine, fixed order | **PASS** | All 11 pipeline functions byte-identical to `main` (hash-compared); selector branches are table lookups and threshold comparisons only; scenario 18 + BREAK 5 pass |
| II | Rule codes verbatim, faded/tooltip only | **PASS** | `RULE_FAULT` never crosses to the client (grep, zero hits in `client/src`); `AD_FAULT_COPY` (`server/engine.ts:956-971`) restates reasoning, prints no code |
| III | Simple Arabic, LTR numerals | **CONCERN** | Copy is clean 6th-grade MSA with one exception (**G1**, `server/engine.ts:993`); the `.num` LTR mechanism is not applied to finding text (**G2**, `Dashboard.tsx:659-668`) |
| IV | Hard data isolation | **PASS** | Zero added lines touch `db.`, drizzle, `getDb`, or `userId` across the whole diff |
| V | Read-only by default | **PASS** | `server/meta.ts`, `server/db.ts`, `drizzle/` untouched; no added `fetch`/Graph field/write path |
| VI | Fixed verdict vocabulary | **PASS** | `Verdict` union byte-identical to `main`; `DiagnosisOutcome` appears only at `shared/qarar.ts:537` on `Finding`; `EngineRow.verdict` unchanged; no badge renders it |
| VII | The purpose is the offer/funnel | **PASS** | CTA is `DISCOVERY_CALL_URL` = the constitutional URL (`shared/qarar.ts:660`); reachable only from `RUNG_CONVERSION` or `FUNNEL_CONFIRMED` — proven exhaustively by BREAK 4 |

---

## Principle-by-principle evidence

### I — Deterministic engine, no AI, fixed evaluation order — **PASS**

**The order is not merely un-reordered; the functions are unchanged bytes.** I hash-compared
every stage against `main` rather than reading the diff:

```text
$ for fn in evaluateAd evaluateAdset gateVerdict circuitBreaker killRulesAdset \
      starvedAdMatrix decayMap fatigueSignals watchRules continueRules killK3; do
    diff <(git show main:server/engine.ts | sed -n "/^function $fn/,/^}/p") \
         <(sed -n "/^function $fn/,/^}/p" server/engine.ts | tr -d '\r')
  done
  IDENTICAL  evaluateAd          IDENTICAL  evaluateAdset      IDENTICAL  gateVerdict
  IDENTICAL  circuitBreaker      IDENTICAL  killRulesAdset     IDENTICAL  starvedAdMatrix
  IDENTICAL  decayMap            IDENTICAL  fatigueSignals     IDENTICAL  watchRules
  IDENTICAL  continueRules       IDENTICAL  killK3
```

`evaluateCampaign`, `evaluateNonSales`, `effectiveConversions`, `effectiveCpa` and
`preSeparationGate` are identical too. **Only `buildSummary` and `diagnose()` + its helpers
differ** — exactly the declared scope.

```text
$ git diff main...HEAD -- server/engine.ts | grep -E '^[-+].*(gateVerdict|circuitBreaker|killRules|starvedAdMatrix|decayMap|fatigueSignals|watchRules|continueRules)'
NO diff lines touch any pipeline stage call
```

**Selector determinism.** Every branch in the terminal-outcome selector is a lookup or a
comparison, each traceable to a rung state or a rule code:

- `RULE_FAULT[fired.rule]` — a total `Record` lookup (`server/engine.ts:1240`)
- `fired.rule === "W5" && o.level === "campaign"` — literal equality (`:1247-1248`)
- `htoUnderperforming && cpa !== null` — a boolean parameter and a null check (`:1256`)
- `evaluable.size === 0`, `ev[4] === "clean" && ev[5] === "clean"` — set/enum comparisons

No heuristic, no scoring, no inference. **`RungEvaluation` is the only derived state**, and every
rung is a threshold against `DIAGNOSIS_GATES`.

**FR-015 purity, verified beyond scenario 18.** I ran a sweep over all 24 codes × 4 archetypes,
replacing `fired.reason`/`fired.action` with empty, Latin, and denylist-saturated strings:

```text
BREAK 5 > outcome never depends on Arabic copy, across every code and archetype  ✓
```

Outcomes and `ctaUrl` presence identical across every permutation.

### II — Rule codes verbatim, faded/tooltip only — **PASS**

The new classification is server-internal and never rendered:

```text
$ grep -rn 'RULE_FAULT|ad-fault|funnel-fault' client/src/
  RULE_FAULT never reaches the client
```

`AD_IS_THE_PROBLEM` restates reasoning through a code-keyed map without printing the code —
e.g. `K3 → "عدد كبير شاهد الإعلان وأقل من نصف في المئة ضغط عليه — بداية الإعلان لا توقف أحدًا، غيّر التصميم"`
(`server/engine.ts:962-963`). Rule codes still surface only through `VerdictBadge`
(`Dashboard.tsx:624`), unchanged.

*Note, not a finding:* the constitution's code list (II) omits `NS1`/`NS2`, which `RULE_FAULT`
must classify to stay total. That gap predates this feature (NS rules arrived with spec 013);
this PR does not widen it. Worth a constitution amendment separately.

### III — Simple Arabic, LTR numerals — **CONCERN** (G1, G2)

I read all **45** new Arabic strings this feature adds. The register is genuinely 6th-grade MSA,
and notably avoids the metric names: «سعر الظهور» for CPM, «نسبة الضغط» for CTR,
«زيارات للصفحة» for landing-page views. The `INSUFFICIENT_DATA` copy is a model of the principle:

> «شُوهد 800 مرة، ضُغط 12 مرة، ووصلت 0 زيارة للصفحة خلال آخر 3 أيام — ما زالت البيانات غير كافية للحكم على هذا الإعلان.»

**The deferred noun defect the request asked about is fixed, not deferred.** `d0a9a77` added
`conversionVerb(archetype, tense)` (`server/engine.ts:267-273`), and both the ladder's step 4
(`:1130`) and **both** rung-5 wordings (`:1230-1231`) read it. Verified live on all four
archetypes — see BREAK 1. The contract paragraph still describing it as an open follow-on was
stale and is corrected in this pass (C4.4a).

**G1 — CONCERN: one transliterated marketing term in new copy.** `server/engine.ts:993`:

```ts
{ label: "مرات الظهور للحكم على الهوك", ... }
```

«الهوك» is "hook" transliterated — performance-marketing jargon a 6th-grade reader will not
know. Principle III says "No jargon, no marketing-speak". This label is user-visible: it is
interpolated into the returned string as `يلزم تقريبًا ${stillNeed} ${best.label} إضافية`.

It is **newly introduced** here — `main` has one occurrence of «الهوك» (K3's verdict `reason` at
`:499`, protected byte-identical by FR-013); HEAD has two. And the feature's own K3 copy shows it
knows the plain form: «بداية الإعلان لا توقف أحدًا» (`:963`). Suggested: «مرات الظهور للحكم على
بداية الإعلان».

By contrast «الفانل» is **established product vocabulary**, not a new violation — 7 occurrences
in `main`, 7 at HEAD, and it is the term the Settings UI uses to the user's face
(`Settings.tsx:490` «نوع الفانل», `settingsFields.ts:119`). PASS on that one.

**G2 — CONCERN: the `.num` LTR mechanism is not applied to finding text.** The contract claims:

> **C5.2** — Every numeric value in every outcome renders left-to-right inside the RTL layout,
> via the existing `.num` mechanism **used by the current rung copy**.

The italicised premise is false. `FindingRow` renders `{finding.text_ar}` as a bare string with
no `.num`, no `dir`, no `<bdi>` — and `main`'s `FindingRow` does the same:

```tsx
// client/src/pages/Dashboard.tsx:659-668 (identical to main in this respect)
<p className={...}>
  {finding.primary && <span className="ml-1 text-primary">★</span>}
  {finding.text_ar}
</p>
```

The mechanism exists (`client/src/index.css:167`, `direction: ltr; unicode-bidi: isolate`) and is
applied elsewhere (`DecisionTable.tsx:1234`, `Settings.tsx:922`, `FacebookPagesCard`), so this is
an omission, not an absence of tooling.

**Why CONCERN and not FAIL**: it is not a regression — behaviour is identical to `main`, and the
Unicode Bidi Algorithm already renders bare European digits LTR inside an RTL paragraph unaided.
**Why it still matters**: C5.2 called this "load-bearing for `FUNNEL_CONFIRMED`", and this feature
makes that line by far the densest numeric string the product prints — five figures plus a
currency amount in one RTL sentence, with bidi-neutral characters (`(`, `)`, `%`, `$`, `—`) at the
boundaries, which is precisely where UBA edge cases appear. T018/T033 and quickstart §4.4 record
this as satisfied; the code does not do it. That mismatch is the finding.

### IV — Hard data isolation — **PASS**

```text
$ git diff main...HEAD -- server/engine.ts shared/qarar.ts client/src/pages/Dashboard.tsx \
    | grep -E '^\+.*(db\.|drizzle|select\(|insert\(|update\(|delete\(|userId|getDb)'
NO added line touches db, drizzle, or userId
```

`diagnose()` is a pure function of an already-materialised, already-scoped snapshot. It adds no
query, opens no connection, and introduces no path that could cross `userId`.
`server/isolation.test.ts` passes (12 tests).

### V — Read-only by default — **PASS**

```text
$ git diff main...HEAD --name-only | grep -E 'server/meta|server/db|drizzle/'
server/meta.ts, server/db.ts and drizzle/ are UNTOUCHED

$ git diff main...HEAD -- server/engine.ts | grep -E '^\+.*(fetch\(|graph\.facebook|fields=|axios|https?://)'
NO added line performs a fetch or names a Graph field
```

Every figure the ladder prints already existed on `WindowMetrics`/`Baselines` in the cached
snapshot. No schema change, no migration, no new endpoint, no Meta write.

### VI — Fixed verdict vocabulary — **PASS**

```text
$ diff <(git show main:shared/qarar.ts | sed -n '/export type Verdict/,/;/p') \
       <(sed -n '/export type Verdict/,/;/p' shared/qarar.ts)
  Verdict union IDENTICAL to main
```

`DiagnosisOutcome` occurs exactly once as a field, at `shared/qarar.ts:537` — `Finding.outcome`.
`EngineRow` carries `verdict: Verdict` and `rule: RuleCode` exactly as before; `DiagnosisOutcome`
is absent from it. No component renders an outcome as a badge — `VerdictBadge` takes
`{verdict, rule}` only. The nine outcomes are a diagnosis-internal identity, deliberately
introduced (FR-016) so the summary and UI stop matching on Arabic text; they are not a sixth
verdict and are not user-visible as a label.

### VII — The purpose is the offer/funnel — **PASS, and materially strengthened**

The CTA still points at the constitutional URL:

```ts
// shared/qarar.ts:660
export const DISCOVERY_CALL_URL = "https://eslamsalah.com/team-discovery-call";
```

The outcome remains first-class: a row with a measured funnel leak says so and routes to the
call, and the account-level card is the home of the full-width button. What changed is that the
CTA is now **earned**. It is reachable from exactly two findings — `RUNG_CONVERSION` (a *measured*
broken conversion rung) and `FUNNEL_CONFIRMED` (the C4 W5 path with the flag and a measured
cost-per-customer) — and from nowhere else. It can no longer be inherited from the mere absence
of an ad-fault rule, which was the pre-change failure. Proven exhaustively in BREAK 4 below.

---

## Hard invariants — raw output

### Verdict pipeline byte-identical (FR-013) — **HOLDS**

Scenario 13 compares against `verdict-baseline.json`, which **this branch generated** — circular.
So I built an independent check: `main`'s engine and `HEAD`'s engine, same fixtures, side by side.

```text
$ git show main:server/engine.ts > server/__gate_main_engine.ts
$ npx vitest run server/__gate_fr013.test.ts

 ✓ server/__gate_fr013.test.ts (3 tests) 55ms
   ✓ verdict / rule / reason_ar / action_ar match for every row
   ✓ also matches on an htoUnderperforming account (the W5 path)
   ✓ and on every archetype                    [paid_lto, free_lead, appointment, webinar]

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

This is stronger than the snapshot: it compares the **live output of both engines** across all
four archetypes and with the funnel flag both ways. Zero divergence.

```text
$ git diff main --numstat -- server/__snapshots__/engine.test.ts.snap
[no rows]                                        ← empty, content-identical to main

$ npx vitest run server/engine.test.ts
 Test Files  1 passed (1)
      Tests  93 passed (93)
```

The harness was deleted after the run; `ls server/__gate*` → clean.

### The four self-review fixes actually hold — **HOLDS** (mutation-verified)

I re-ran the revert-and-confirm check independently rather than trusting the log. Each fix was
reverted in the live file and the suite re-run:

```text
############ MUTATION A — F1: archetype -> "paid_lto" in the ladder ############
 × Scenario 7b > appointment archetype: step 4 prints the LEAD-based percentage
 × BREAK 1 > printed conversion % equals the rung-5 numerator on all four archetypes

############ MUTATION B — F2: explicit flag -> fired.ctaUrl ############
 × Scenario 8 > control — the guard OPENS and reaches FUNNEL_CONFIRMED
 × Scenario 8 > the flag is read from the parameter, never from fired.ctaUrl
 × Scenario 8 > the CPA half reads effectiveCpa
 × BREAK 3 > a W5 Fired carrying ctaUrl does NOT open the path when the flag is false
 × BREAK 3 > the default is closed — omitting the flag never opens the path

############ MUTATION C — F3: effectiveCpa -> o.w3d.cpa (line 1255) ############
 × Scenario 8 > the CPA half reads effectiveCpa, so an appointment campaign
   is judged on cost-per-lead
      Tests  1 failed | 43 passed (44)

############ MUTATION D — noun: drop conversionVerb from the ladder ############
 × Scenario 7b > appointment archetype: step 4 prints the LEAD-based percentage
 × BREAK 1 > printed conversion % equals the rung-5 numerator on all four archetypes

############ RESTORED ############
 Test Files  4 passed (4)
      Tests  140 passed (140)

$ git diff --stat -- server/engine.ts
[no rows]                                        ← restored to committed HEAD exactly
```

**The tests are not vacuous.** Every fix has at least one test that fails without it.

### `RULE_FAULT` totality, K7 = neither — **HOLDS**

```text
BREAK5: {"ad-fault":["K1","K3","K4","F1","F2"],
         "funnel-fault":["W3","W4","W5"],
         "neither":["K2","K5","K6","K7","CB1","CB2","W1","W2","W6",
                    "S1","S2","S3","S4","GATE","NS1","NS2"]}
```

5 + 3 + 16 = **24**, enumerated from `Object.keys(RULES)` so a new code cannot be silently
omitted. `K7` is `neither`. No `??`/`||` fallback anywhere:

```text
$ grep -rn '\?\?\s*"neither"|\|\|\s*"neither"' --include=*.ts --include=*.tsx .
(no output — exit 1)
```

Totality is compiler-enforced by `Record<RuleCode, RuleFaultClass>` and runtime-checked.

### ctaUrl discipline (V10) — **HOLDS**, exhaustively

Not a fixture spot-check — a full sweep of 24 codes × 4 archetypes × 3 levels × 8 metric shapes ×
flag on/off × `fired.ctaUrl` present/absent:

```text
BREAK4: 12672 findings inspected, 2708 carried a ctaUrl;
        {"INSUFFICIENT_DATA":1576, "AD_IS_THE_PROBLEM":900, "RUNG_CPM":1152,
         "RUNG_HOOK":1152, "RUNG_MISMATCH":1152, "RUNG_ARRIVAL":1152,
         "RUNG_CONVERSION":2592, "NO_BLAME_ASSIGNABLE":2880, "FUNNEL_CONFIRMED":116}
 ✓ no finding outside FUNNEL_CONFIRMED / RUNG_CONVERSION ever carries ctaUrl
 ✓ no terminal outcome other than FUNNEL_CONFIRMED ever carries ctaUrl
```

Every one of the 2,708 CTA-bearing findings was `FUNNEL_CONFIRMED` or `RUNG_CONVERSION`. All nine
outcomes were produced, so the sweep genuinely exercised every branch — **1,576
`INSUFFICIENT_DATA` and 2,880 `NO_BLAME_ASSIGNABLE` findings, none with a CTA.**

### Exempt hard-skip unchanged — **HOLDS**

```text
$ git diff main...HEAD --stat -- server/nonSalesContainment.test.ts
[no rows]                                        ← unmodified

$ npx vitest run server/nonSalesContainment.test.ts
      Tests  12 passed (12)
```

The skip stays at the call site, not inside `diagnose()`; exempt objects still get `findings: []`.

### File scope — **HOLDS**

| File | In scope? |
|------|-----------|
| `server/engine.ts` | ✅ `diagnose()` + helpers + `buildSummary` predicate; every verdict function byte-identical |
| `shared/qarar.ts` | ✅ types only — `DiagnosisOutcome`, `RuleFaultClass`, `RULE_FAULT`, `DIAGNOSIS_GATES`, `Finding.outcome` |
| `client/src/pages/Dashboard.tsx` | ✅ the `DiagnosisSection` render path |
| `client/src/pages/DiagnosisSection.test.tsx`, `server/engine.diagnosis.test.ts` | ✅ new tests |
| `client/src/pages/Dashboard.swr.test.tsx` | ✅ removal of a dead mock |
| `.specify/feature.json`, `CLAUDE.md` | ⚠️ Spec Kit bookkeeping, not feature code — benign |
| `specs/…`, `docs/…` | ✅ documentation |

Nothing outside the allow-list. `server/meta.ts`, `server/db.ts`, `drizzle/`, and every other
engine test are untouched.

---

## Break attempts — results

I tried to break four things. All four held.

| Attempt | Method | Result |
|---------|--------|--------|
| **FUNNEL_CONFIRMED printing a figure that contradicts its evidence (F1 class)** | For each archetype, built a fixture where purchases (2.0%) and leads (25.0%) **disagree**, then asserted the printed % equals the rung-5 numerator and the other value never appears | **HELD** on `appointment`, `webinar`, `paid_lto`. `free_lead`'s 15% floor broke rung 5 on that grid, so I added BREAK 1b with a fixture clearing it — `free_lead` correctly prints `25.0%` from `conversions`, not `2.0%` from `leadConversions`. **All four archetypes confirmed closed**, figure *and* noun |
| **Ad-fault row funding the account card (C6.1a cond. 2)** | All 5 ad-fault codes × 4 archetypes with a broken rung 5; plus a `runEngine` sweep asserting that whenever the card is set, some non-excluded row funds it | **HELD.** The row keeps its `RUNG_CONVERSION` finding and its CTA (C8.3) but never carries an ad-health claim, and never funds the card alone |
| **Funnel flag still inferable (F2 class)** | Passed a W5 `Fired` **carrying `ctaUrl`** with the flag `false`; omitted the parameter entirely; tried W3/W4 with the flag set; tried ad- and adset-level W5 | **HELD.** All close to `INSUFFICIENT_DATA`. The default is `false`, so it fails closed. The path requires `fired.rule === "W5" && o.level === "campaign"` **and** the explicit flag **and** a non-null `effectiveCpa` |
| **INSUFFICIENT_DATA / NO_BLAME_ASSIGNABLE carrying a ctaUrl** | The 12,672-finding sweep above, including `fired.ctaUrl` pre-set to the discovery URL to try to leak it through | **HELD.** Zero occurrences across 4,456 such findings |

Two further attempts, not requested but worth recording: a non-W5 funnel-fault code (`W3`/`W4`)
cannot reach the C4 path even with the flag set, and an **ad- or adset-level** W5 cannot either —
the guard is campaign-scoped as C4 requires.

---

## Defects found in this pass

| ID | Severity | File:line | Defect |
|----|----------|-----------|--------|
| **G1** | CONCERN | `server/engine.ts:993` | «الهوك» — transliterated marketing jargon in new user-visible copy, against Principle III. Newly introduced (main: 1 occurrence, all in FR-013-protected verdict copy; HEAD: 2). Suggested: «مرات الظهور للحكم على بداية الإعلان» |
| **G2** | CONCERN | `client/src/pages/Dashboard.tsx:659-668` | Finding text is rendered without the `.num` LTR mechanism, so C5.2 / T018 / T033 are recorded as satisfied when the code does not do it. Not a regression (main is identical), but this feature makes that line the densest numeric string the product prints |
| **G3** | fixed in this pass | `contracts/diagnosis-outcomes.md` C4.4a | The contract still declared the step-4 noun an open follow-on after `d0a9a77` fixed it — a normative document asserting a defect the code no longer has. Corrected |

Neither G1 nor G2 touches a verdict, leaks data, or produces a dishonest claim. Both are copy-layer
issues that can ship and be fixed in a follow-up; neither is grounds to hold the merge.

---

## Final verification

```text
$ npm run check
> tsc --noEmit
(zero errors)

$ npx vitest run
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 54 passed (55)
      Tests  628 passed | 11 skipped (639)

$ git diff main --numstat -- server/__snapshots__/engine.test.ts.snap
[no rows]
```

The one failing suite is `server/auth-flow.e2e.test.ts`, which throws `Database connection failed`
in `beforeAll` because no database is reachable in this environment. It is untouched by this PR and
imports nothing from the diagnosis path. Separately, `server/isolation.test.ts` intermittently hits
`ER_LOCK_DEADLOCK` on `facebookPages` inserts under concurrent load and passes when run alone —
also unrelated.

**Worth flagging to the team independently of this gate**: vitest exits `0` even with a failed
suite, so CI keyed on the exit code will not catch either failure.

---

# MERGE

Nothing here blocks. The verdict pipeline is provably untouched — verified by running both engines
side by side, not by trusting a self-generated baseline. The four self-review fixes are
mutation-verified, not merely green. All four break attempts held, including a 12,672-finding sweep
of CTA discipline that produced every one of the nine outcomes. G1 and G2 are copy-layer concerns
worth a follow-up ticket, not a hold.
