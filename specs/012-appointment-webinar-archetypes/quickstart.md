# Quickstart: Validating Appointment & Webinar Archetypes

How to prove the feature works. Implementation belongs in `tasks.md`; this is the run/verify guide.

## Prerequisites

```bash
npm install
npm run check     # tsc — must pass with zero errors
npm test          # vitest
```

`.env` needs `DATABASE_URL` for anything touching the database. Engine and target tests need none —
`deriveTargets` is pure and server suites mock `./db` wholesale.

---

## 1. Migration (must pass before anything else)

Per plan §Migration sequencing — the order is a correctness constraint.

```bash
npx tsx scripts/verify-archetype-migration.ts     # step 1 — pre-flight
```

**Expected**: `direct_call` count is `0` and the script exits `0`.

**If non-zero: stop.** Do not run the enum change. Each row needs an operator decision first; the
migration cannot be partially applied and the rows become unreadable the moment the enum narrows
(FR-003, research R7).

```bash
npm run db:push                                   # steps 2-3 — columns, then enum
npx tsx scripts/verify-archetype-migration.ts     # step 4 — re-verify
```

**Expected**: four rate columns exist and are nullable with no default; the enum offers exactly
`paid_lto`, `free_lead`, `appointment`, `webinar`.

---

## 2. Target math

```bash
npx vitest run server/engine.test.ts
```

Vectors are tabulated in [contracts/derive-targets.md §8](./contracts/derive-targets.md). The ones
that must not be skipped:

| Check | Expectation | Ref |
|---|---|---|
| Appointment 6 / 70 / 22, hto 2000 | `unitTarget` **9.24** ±0.01, source `cpl_funnel_math` | SC-001 |
| Webinar 25 / 5, hto 2000 | `unitTarget` **12.50** | US2 AS1 |
| Lower **any** one rate, others fixed | target falls, never rises — all five rates | SC-002 |
| All rates 100 | target = `htoPrice / 2` = 1000 | edge case |
| Nothing available | `unitTarget === null` **and** `unitTargetSource === null` | FR-019 |
| Any missing-input combination | source is never `"effective_cpa"` | FR-018, SC-004 |

**Regression lock (the one to write first)**: snapshot `free_lead` and `paid_lto` outputs across the
existing fixture matrix *before* touching `deriveTargets`, then assert bit-identity after (SC-005,
SC-010). Everything else in this feature is additive; this is the assertion that proves it.

---

## 3. Conversion measurement

```bash
npx vitest run server/meta.test.ts server/engine.test.ts
```

| Check | Expectation | Ref |
|---|---|---|
| Row with 200 leads + 2 purchases, appointment | cost per result = `spend / 200` | SC-023 |
| Same row, `paid_lto` | `conversions` unchanged from today | SC-025 |
| Same row, appointment | `cvr` uses 200 → not flagged weak | SC-024 |
| `leadConversions === undefined` | not measurable; **not** treated as `0` | FR-035 |
| `leadConversions === 0` | zero results; ordinary zero-result rules | FR-034 |
| Baselines | `cplMedian30` populated; **no additional Graph request** | FR-033, R4 |

Assert the request count explicitly — "no new API call" is a Principle V commitment, not an
optimisation, and it silently regresses the moment someone adds a convenience fetch.

---

## 4. Honest no-target state

```bash
npx vitest run server/engine.test.ts client/src/pages/Settings.test.tsx
```

| Check | Expectation | Ref |
|---|---|---|
| Appointment, no baseline / rates / benchmark | every object `too_early`, rule `GATE` | SC-011 |
| Same | zero kill / watch / continue / rescue verdicts | US4 AS2 |
| Same | no account-level blocking card | US4 AS4 |
| Fill the rates | state clears everywhere, no re-save needed | US4 AS5 |

**Do not skip**: assert that **no surface renders `∞`** (SC-021). This is the `money()` default
(`format.ts:25`) and it is silent — nothing throws, the page renders. A grep-style assertion over the
rendered output is appropriate here.

---

## 5. Settings UI

```bash
npx vitest run client/src/lib/settingsFields.test.ts client/src/pages/Settings.test.tsx
```

Client component tests need `// @vitest-environment jsdom` — the global environment is `node`.

| Check | Expectation | Ref |
|---|---|---|
| Dropdown | four options; `direct_call` gone | FR-001, FR-002 |
| Appointment form | `aov` / `frontEndRoas` / `htoConversionRate` hidden; `htoPrice` shown | FR-028 |
| Switch away and back | previously entered values intact | SC-008 |
| Empty rate boxes | placeholders `3-10%`, `~70%`, `20-25%` / `15-30%`, `1-8%` | FR-010 |
| Placeholders | never submitted as values | FR-010 |
| Enter `0`, `-5`, `120` | rejected, simple-Arabic message, nothing saved | FR-009 |
| Baseline 20 + ceiling 9.24 | **two** rows + over-ceiling message | SC-013 |
| Funnel-math source | **one** row (target === ceiling) | SC-014 |

`settingsFields.test.ts:105-110` asserts the retired option's visibility and **must be deliberately
replaced, not deleted quietly** (FR-026d).

---

## 6. Thresholds — only after §3 passes

```bash
npx vitest run server/engine.test.ts
```

| Check | Expectation | Ref |
|---|---|---|
| Appointment page at 8% cvr | flagged weak (15% floor, not 2%) | SC-009 |
| K7 threshold | equals the ceiling shown in settings, to the cent | SC-015 |
| Incomplete rates | zero structural-loss kills (absent ≠ zero) | SC-016 |
| `free_lead` | still 0.7 × lead value | SC-017 |
| Stale `aov` from a previous archetype | influences **no** verdict | SC-018, SC-020 |

**Order matters**: running these before §3 passes will show the 15% floor firing almost everywhere.
That is the coupling described in plan §Complexity Tracking, not a bug in the threshold work.

---

## 7. Full gate

```bash
npm run check
npm test
npx vitest run server/isolation.test.ts
```

All three must be green. Isolation coverage extends to the new columns (Principle IV).

---

## Manual smoke

```bash
npm run dev
```

1. Settings → pick **أحجز مكالمات مع العملاء ثم أبيع في المكالمة**.
2. Confirm the three rate boxes show their ranges as grey hints, and that AOV / return-multiple /
   high-ticket-conversion inputs are gone.
3. Enter `6`, `70`, `22`, high-ticket price `2000`. Expect **9.24** in the max-cost-per-lead row.
4. Clear the close rate. The row should fall back or disappear — **never** show `∞`.
5. Dashboard: with no target, the tile reads "لم يتحدد بعد" and cost cells are uncoloured.
6. Switch to `paid_lto` and back. Every previously entered value is still there.
