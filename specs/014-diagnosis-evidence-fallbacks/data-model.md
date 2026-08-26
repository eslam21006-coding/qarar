# Data Model: Diagnosis Evidence & Honest Fallbacks

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

No database schema changes. Everything here is an in-memory or on-the-wire type in `shared/qarar.ts`,
plus one internal record inside `server/engine.ts` that never crosses the wire.

---

## 1. `RungId` — which step of the ladder

```
type RungId = 1 | 2 | 3 | 4 | 5;
```

| Value | Rung | Measures |
|-------|------|----------|
| 1 | cost-per-view | ad CPM against the account's 14-day average |
| 2 | hook | link CTR against the account's 90-day median |
| 3 | message / CTA mismatch | all-CTR far above link CTR |
| 4 | landing-page arrival | landing-page views as a share of link clicks |
| 5 | page conversion | conversions as a share of landing-page views |

Rung 6 is deliberately **absent**. It is the terminal position, not a judgeable step (spec A2), and
after this feature it is occupied by a terminal outcome rather than by a rung.

**Relationship to `Finding.step`**: `Finding.step` keeps its existing `1|2|3|4|5|6` type on the wire
so no consumer breaks. `RungId` is the narrower domain used by the evaluation record.

---

## 2. `RungState` — the three-way state of one rung

```
type RungState = "unevaluable" | "clean" | "broken";
```

| State | Meaning |
|-------|---------|
| `unevaluable` | The volume gate was not met, or a **required** comparison baseline was absent. Nothing is known. |
| `clean` | The rung was judged against real data and came back healthy. This is evidence. |
| `broken` | The rung was judged against real data and is failing. This produces a finding. |

**Validation rules**

- **V1** — Exactly one state per rung per object. There is no "unset".
- **V2** — `unevaluable` is never counted as `clean`. This is defect D1 stated as an invariant, and
  it is the single rule the whole feature rests on.
- **V3** — A rung whose gate is met but whose required baseline is missing is `unevaluable`
  (FR-003a). Per research §R2.1 this affects **rung 1 only**; rung 2 has a literal `1.0` fallback and
  therefore stays evaluable without a median.
- **V4** — Rung 4 with `lpViews === 0` and `linkClicks >= 50` is `unevaluable`, not `broken` and not
  `clean` (research §R2.2).
- **V5** — Rungs 2 and 3 share one gate (`impressions >= 1000`) and are therefore always
  co-evaluable: they are `unevaluable` together or judged together, never split.

---

## 3. `RungEvaluation` — the per-object record

```
type RungEvaluation = Record<RungId, RungState>;
```

Internal to `server/engine.ts`. Built once at the top of `diagnose()`, before any finding is pushed,
and consulted by the outcome selector. **Not** added to `EngineRow` — it is derivable from the
snapshot and putting it on the wire would grow the payload for no consumer.

Derived sets used by the contract:

| Set | Definition |
|-----|------------|
| `evaluable` | rungs whose state is `clean` or `broken` |
| `broken` | rungs whose state is `broken` |
| `clean` | rungs whose state is `clean` — the evidence FR-007 renders (FR-003) |

**Validation rules**

- **V6** — `evaluable.size === 0` is the trigger for `INSUFFICIENT_DATA` (FR-004), counting rungs
  1–5 only (spec A2).
- **V7** — `broken.size > 0` means **no** terminal outcome is appended at all; the broken rungs are
  the diagnosis (spec A1). This preserves today's behaviour for that case.

---

## 4. `DiagnosisOutcome` — the terminal classification and the finding identity

```
type DiagnosisOutcome =
  | "INSUFFICIENT_DATA"
  | "AD_IS_THE_PROBLEM"
  | "NO_BLAME_ASSIGNABLE"
  | "FUNNEL_CONFIRMED"
  | "RUNG_CPM"        // rung 1 finding
  | "RUNG_HOOK"       // rung 2 finding
  | "RUNG_MISMATCH"   // rung 3 finding
  | "RUNG_ARRIVAL"    // rung 4 finding
  | "RUNG_CONVERSION"; // rung 5 finding
```

This single union satisfies FR-016: **every** finding carries a machine-readable identity, whether it
came from a broken rung or from a terminal outcome. Summary logic (FR-010) and presentation logic
(FR-011) read this field and never match on Arabic text.

| Member | Kind | May claim innocence | Carries discovery-call link |
|--------|------|---------------------|-----------------------------|
| `INSUFFICIENT_DATA` | terminal | **No** | **No** |
| `AD_IS_THE_PROBLEM` | terminal | **No** | **No** |
| `NO_BLAME_ASSIGNABLE` | terminal | **No** | **No** |
| `FUNNEL_CONFIRMED` | terminal | **Yes** — the only one | **Yes** — the only terminal one |
| `RUNG_CPM` / `RUNG_HOOK` / `RUNG_MISMATCH` / `RUNG_ARRIVAL` | rung | No | No |
| `RUNG_CONVERSION` | rung | Conditionally — see §7 | **Yes** |

**Validation rules**

- **V8** — At most one *terminal* member appears in a row's findings. The four terminal members are
  mutually exclusive by construction (contract §C2).
- **V9** — A terminal member appears only when `broken.size === 0` (V7).
- **V10** — `ctaUrl` is present **only** on a finding whose outcome is `FUNNEL_CONFIRMED` or
  `RUNG_CONVERSION`. Any other combination is a contract violation and is asserted in test.

---

## 5. `RuleFaultClass` and `RULE_FAULT` — the total classification

```
type RuleFaultClass = "ad-fault" | "funnel-fault" | "neither";

const RULE_FAULT: Record<RuleCode, RuleFaultClass> = { /* 24 entries — research §R3 */ };
```

`Record<RuleCode, RuleFaultClass>` is what makes the mapping **total** (FR-008a): omitting a code is
a TypeScript error, so the table can never silently default. There is no fallback branch and no
`?? "neither"` anywhere in the consuming code.

**Validation rules**

- **V11** — Every member of the `RuleCode` union has exactly one class. Asserted at compile time by
  the `Record` type and again at runtime by a test that iterates the `RULES` keys.
- **V12** — The classification is never rendered to the user (Constitution II). It selects copy; it
  is not copy.

The 24 assignments and their per-code justifications live in [research.md §R3](./research.md).

---

## 6. `Finding` — the shape change

**Today** (`shared/qarar.ts:424`):

```
interface Finding {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  text_ar: string;
  primary: boolean;
  ctaUrl?: string;
}
```

**After**:

```
interface Finding {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  outcome: DiagnosisOutcome;   // NEW — required (FR-016)
  text_ar: string;
  primary: boolean;
  ctaUrl?: string;
}
```

**Why `outcome` is required, not optional**: making it optional would let a construction site be
missed and default to "no identity", which the summary would then have to guess at — reintroducing
Arabic-text matching by the back door. Required means `npm run check` names every construction site
that has not been updated. There are five in `server/engine.ts` today (rungs 1–5) plus the step-6
fallback being replaced and the campaign W5 block.

**Compatibility**: `step` is retained and keeps its current values, so any consumer reading `step`
continues to work. `step` and `outcome` agree by construction: `RUNG_CPM → 1`, `RUNG_HOOK → 2`,
`RUNG_MISMATCH → 3`, `RUNG_ARRIVAL → 4`, `RUNG_CONVERSION → 5`, and all four terminal outcomes → `6`.

**Validation rules**

- **V13** — `step` and `outcome` are consistent per the mapping above. Asserted in test.
- **V14** — `primary` is true for exactly the first finding in the array, unchanged from today.
- **V15** — `findings` is `[]` for a non-sales exempt object, unchanged from Spec 013 (FR-009,
  spec A4). Exempt objects never reach `diagnose()` at all.

---

## 7. Rung 5 and its two wordings (FR-017, FR-017a, FR-017b)

Rung 5 emits `RUNG_CONVERSION` in both of its wordings; the outcome identity does not change with the
copy. What changes is which copy is selected:

| Condition | Wording |
|-----------|---------|
| Fired rule is `ad-fault` (FR-017) | **neutral** — reports the weak conversion, absolves nothing |
| Any of rungs 1–4 is not `clean` (FR-017a) — i.e. broken **or** unevaluable | **neutral** |
| Fired rule is not ad-fault **and** rungs 1–4 are all `clean` | **innocence** — «⚠️ الإعلان بريء، لا تعدّله» |

This is the D1 correction applied one rung lower: today the innocence wording is selected by
`findings.length === 0`, which is true when rungs 1–4 were never *measured*. The new condition
requires them to be `clean`, which means measured and healthy.

**FR-017b** — the wording choice does **not** affect the finding's standing. `RUNG_CONVERSION` keeps
its `ctaUrl` and keeps counting as confirmed funnel evidence for the account card in both wordings,
because the conversion figure that produced it was genuinely measured. Suppressing the *claim* does
not suppress the *finding*.

---

## 8. Account funnel signal (FR-010, FR-010a, FR-010b, FR-011, FR-011a)

`Summary.account_funnel_cta` keeps its existing wire shape
(`{ reason_ar: string; ctaUrl: string } | null`). Only its predicate changes, from Arabic/step
matching to outcome matching:

**The predicate is defined once, in [contract §C6.1 and §C6.1a](./contracts/diagnosis-outcomes.md).**
This section does not restate it — an earlier duplicate copy lived here and would have drifted the
moment either side was edited (analysis finding D1). In outline: a row qualifies on a
`RUNG_CONVERSION` or `FUNNEL_CONFIRMED` finding, subject to the C6.1a ad-blame exclusion; the card is
`null` otherwise (FR-010a), and rows whose only finding is `INSUFFICIENT_DATA` or
`NO_BLAME_ASSIGNABLE` contribute nothing. For the exact conditions, read C6.1/C6.1a — they are
normative, this paragraph is not.

The card's copy obligation is [C6.4](./contracts/diagnosis-outcomes.md), and the substring set that
operationally defines "no ad-health claim" is `AD_HEALTH_CLAIMS` in contract §C10.1.

**Validation rules**

- **V16** — An account whose flagged rows are all `INSUFFICIENT_DATA` or `NO_BLAME_ASSIGNABLE`
  produces `account_funnel_cta === null` (SC-008).
- **V19** — `account_funnel_cta.reason_ar` contains none of the `AD_HEALTH_CLAIMS` strings
  (FR-011a, contract §C6.4, §C10.1). The card's qualifying conditions prove a funnel leak, not that the
  ads are fine — a qualifying row's rungs 1–4 may all have been unevaluable. It is deliberately *not*
  held to the wider `BLAME_CLAIMS` set: the card must stay free to name the offer or the funnel.
- **V18** — No row whose fired rule is ad-fault contributes to `account_funnel_cta`, even when its
  page-conversion rung broke (FR-010b, C6.1a). Suppressing the row's *contribution* is separate from
  §7's suppression of its *wording*: the finding still stands on the row with its `ctaUrl`.
- **V17** — The full-width booking `<Button>` renders **only** from `account_funnel_cta`. Row-level
  findings carrying `ctaUrl` render at most one subtle inline text link each (FR-011, SC-007).

---

## 9. Entity relationships

```
NormalizedObject ──┐
                   ├──> diagnose(o, baselines, archetype, fired) ──> Finding[]
RuleResult (fired)─┘         │
                             ├─ builds RungEvaluation (§3)  ── V1..V5
                             ├─ broken rungs      ──> rung Findings (RUNG_*)
                             └─ if no rung broke:
                                   RULE_FAULT[fired.rule] (§5)
                                   + RungEvaluation
                                   ──> exactly one terminal Finding (§4)

Finding[] ──> EngineRow.findings ──> buildSummary ──> account_funnel_cta (§8)
                                 └─> DiagnosisSection / FindingRow (§8 V17)
```

The only new input to `diagnose()` is `fired: RuleResult` (FR-009). All three call sites in
`runEngine` — ad (`server/engine.ts:~1429`), ad set (`~1439`), campaign (`~1450`) — already have
`fired` in scope, so no plumbing is needed above them.

---

## 10. What is explicitly NOT changing

| Item | Status |
|------|--------|
| Database schema | No change; no migration; `npm run db:push` not run |
| `EngineRow.verdict` / `rule` / `reason_ar` / `action_ar` | Byte-identical (FR-013, SC-009) |
| The five-verdict vocabulary | Untouched (Constitution VI) |
| The volume-gate **values** | Extracted to constants, values unchanged (FR-002, FR-014) |
| The non-sales exemption hard-skip | Unchanged; exempt objects still get `[]` (FR-009, A4) |
| `Summary.account_funnel_cta` wire shape | Unchanged; only its predicate changes |
| `Finding.step` | Retained with its current values for consumer compatibility |
| Meta API fields requested | None added (Constitution V) |
