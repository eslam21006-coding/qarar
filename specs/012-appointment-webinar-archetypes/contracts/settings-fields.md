# Contract: Settings fields — appointment & webinar

Extends `specs/008-settings-simplification/contracts/settings-fields.md`.

## 1. Archetype dropdown (`Settings.tsx:394-398`)

`direct_call` ("العميل يحجز مكالمة مباشرة") is removed. Two options replace it, matching the existing
first-person phrasing of the other two:

| Value | Arabic label |
|---|---|
| `paid_lto` | أبيع منتجًا رخيصًا أولًا ثم أعرض منتجًا غاليًا *(unchanged)* |
| `free_lead` | أجمع بيانات عملاء مجانًا ثم أبيع منتجًا غاليًا *(unchanged)* |
| `appointment` | **أحجز مكالمات مع العملاء ثم أبيع في المكالمة** |
| `webinar` | **أدعو الناس إلى ندوة مجانية ثم أبيع بعدها** |

`FIELD_COPY.archetype.hint` (`settingsFields.ts:31-34`) lists the options inline and must be updated
to match, or it will still advertise the retired option.

## 2. New rate fields

Labels follow the existing "من كل 100 …" pattern already used by `htoConversionRate`
(`settingsFields.ts:51`). Placeholders render via the `placeholder` prop — greyed hint text inside the
empty box, **never** a form value (FR-010), the same discipline spec 011 established for `PLACEHOLDERS`
(`Settings.tsx:51-62`).

| Field | Archetype | Label | Placeholder |
|---|---|---|---|
| `bookRate` | appointment | من كل 100 عميل محتمل، كم واحدًا يحجز مكالمة؟ (%) | `3-10%` |
| `showRate` | appointment | من كل 100 حجز، كم واحدًا يحضر المكالمة؟ (%) | `~70%` |
| `closeRate` | appointment | من كل 100 مكالمة، كم واحدة تنتهي ببيع؟ (%) | `20-25%` |
| `showUpRate` | webinar | من كل 100 مسجّل في الندوة، كم واحدًا يحضر؟ (%) | `15-30%` |
| `closeRate` | webinar | من كل 100 حاضر، كم واحدًا يشتري؟ (%) | `1-8%` |

`closeRate` is **one column with two labels** (FR-007) — the label and placeholder are selected by
archetype. Placeholders use Western digits, consistent with the existing `PLACEHOLDERS` values and
Principle III's LTR-numeral rule.

## 3. Visibility matrix (`isFieldVisible`, `settingsFields.ts:69-75`)

| Field | `paid_lto` | `free_lead` | `appointment` | `webinar` | Ref |
|---|---|---|---|---|---|
| `archetype`, `inputCurrency`, `dailyBudget` | ✓ | ✓ | ✓ | ✓ | — |
| `htoPrice` | ✓ | ✓ | ✓ | ✓ | funnel math needs it |
| `aov` | ✓ | ✓ | ✗ | ✗ | FR-028 |
| `frontEndRoas` | ✓ | ✓ | ✗ | ✗ | FR-028 |
| `htoConversionRate` | ✓ | ✓ | ✗ | ✗ | FR-028 |
| `marketCplBenchmark` | ✗ | ✓ | ✓ | ✓ | FR-020 |
| `bookRate`, `showRate` | ✗ | ✗ | ✓ | ✗ | FR-005 |
| `showUpRate` | ✗ | ✗ | ✗ | ✓ | FR-006 |
| `closeRate` | ✗ | ✗ | ✓ | ✓ | FR-007 |
| `htoUnderperforming` | ✓ | ✓ | ✓ | ✓ | FR-028c |

Today this function special-cases exactly one field; it becomes a genuine per-archetype matrix.

**Hiding is non-destructive** (FR-028a) — hidden fields keep their stored values and are omitted from
the math, never cleared.

## 4. W5 wording (FR-028d)

`htoUnderperforming` stays visible and its rule stays active, but its current label assumes a first
sale these funnels do not have:

| Archetype | Label |
|---|---|
| `paid_lto`, `free_lead` | البيع الأول جيد، لكن المنتج الغالي لا يُباع؟ *(unchanged)* |
| `appointment` | **الناس تحجز وتحضر لكن لا تشتري؟** |
| `webinar` | **الناس تحضر الندوة لكن لا تشتري؟** |

## 5. Derived-target preview (`Settings.tsx:540-620`)

For `appointment` / `webinar`:

| Element | Behaviour |
|---|---|
| `effectiveCPA` primary block (540-558) | **hidden** — FR-028b |
| `capped` warning (565-573) | **hidden** — FR-028b |
| "كيف حسبنا هذا الرقم؟" breakdown (584-620) | **hidden** — FR-028b; it explains `rawTargetCPA` / `fullBuyerValue` / `maxCPA`, all product-purchase figures |
| Judging-target row | **shown** whenever `unitTarget !== null` — FR-027 |
| Funnel-math ceiling row | shown **only** when `cplCeiling !== null` **and** `cplCeiling !== unitTarget` — FR-027a |
| Over-ceiling message | shown when `unitTarget > cplCeiling` — FR-027b — worded as an offer-level problem |
| Discovery-call route | rendered **with** the over-ceiling message — FR-027c; use `DISCOVERY_CALL_URL` (`server/engine.ts:664`, `https://eslamsalah.com/team-discovery-call`) and the same CTA treatment the app already applies to the W5 funnel signal |
| No-target line | replaces the rows when `unitTarget === null` — FR-019a |

The existing `free_lead` row (575-583) is the display pattern to reuse, including its dual-currency
`targetsInInput` / `targetsInAccount` handling. The `marketCplBenchmark` field is now visible for
these archetypes (§3), so the third-tier target it feeds is reachable and can appear in the
judging-target row like any other source.

**Two rows never show the same number** (SC-014): when funnel math is the source, `cplCeiling ===
unitTarget` and only the primary row renders.

## 6. Absent-target rendering (FR-019b/c/d)

`money()` returns **`∞`** for a null/undefined/non-finite input (`client/src/lib/format.ts:25`) —
unlike `num()` and `pct()`, which return `—`. No target surface may reach that default.

| Surface | Behaviour |
|---|---|
| `Dashboard.tsx:255` target tile | tile **stays**; value becomes a short Arabic phrase — proposed **"لم يتحدد بعد"** (FR-019b) |
| `Dashboard.tsx:276` → `DecisionTable` | absent target propagated as absent, not defaulted |
| `DecisionTable.tsx:675, 684, 723, 731` | handle absence explicitly |
| `cpaColorClass(cpa, target)` (`format.ts:39`) | cells left **uncoloured** — no good/bad shading without a target (SC-022) |
| Settings preview | FR-019a line |

`money()` itself is **not** changed — that would alter rendering on `free_lead` and `paid_lto`
surfaces this feature must not touch.

## 7. Validation (FR-009)

Rates accept `> 0` through `100` inclusive. `0`, negatives, and `> 100` are rejected at entry with a
simple-Arabic message and never saved.

This differs deliberately from `htoConversionRate`'s `z.number().min(0).max(100)`
(`routers.ts:68`): the new rates use `.gt(0)`. The asymmetry is required by FR-009 — accepting `0` and
treating it as "unanswered" would silently discard a typed answer — and must not be normalised away.
