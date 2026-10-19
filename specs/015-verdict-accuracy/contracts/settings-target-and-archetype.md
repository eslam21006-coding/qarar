# Contract: Settings — judging target and the funnel options

**Feature**: `015-verdict-accuracy` · Covers FR-017–FR-025 · Rulebook §2.1, §4.1, principle 9

## T1. The target shown is the target used (FR-017–FR-020)

**Server returns** the pair the engine judged with — both already exist on `DerivedTargets`
(`shared/qarar.ts:397–402`), set on every branch of `deriveTargets()` (line 745):

```text
unitTarget:       number | null
unitTargetSource: "effective_cpa" | "cpl_baseline" | "cpl_benchmark" | "cpl_funnel_math" | null
```

They must reach **both** the dashboard summary and Settings, and must be identical in the two
places (FR-020).

**Current defect**: `Settings.tsx` never asks the server. It derives targets locally with
`deriveTargets(inputs, null)` (line 254) and `deriveTargets(inputs, null, …)` (line 256) — **both
passing `null` baselines** — so the page shows funnel math while the engine judges on the account
baseline. Both call sites must change; fixing one leaves the bug.

**Display** (FR-018), labels per data-model.md §5:

```text
{unitTarget}                              ← the judging number
محسوب من متوسط حسابك في آخر 30 يومًا      ← when unitTargetSource = cpl_baseline
محسوب من أرقام الفانل                     ← when effective_cpa | cpl_funnel_math
محسوب من متوسط السوق المُدخل               ← when cpl_benchmark
```

**Divergence** (FR-019): when the local funnel-math figure differs from the engine's target by
more than 20%, show both and state which one the engine uses. The local computation is retained
**only** for this comparison.

**Invariants**

- Settings and the dashboard never display different targets for the same account.
- No second implementation of target derivation is introduced; `deriveTargets()` stays the single
  source (rulebook principle 9 / FR-034, whose verdict-reason-diagnosis scope this satisfies; the
  cost column is feature 016's T7).

## T2. Funnel options (FR-021–FR-024)

| # | Option label | `archetype` | `liveComponent` | Counts line |
|---|---|---|---|---|
| 1 | أبيع منتجًا أو خدمة بسعر منخفض مباشرة | `paid_lto` | `false` | نعدّ: المشتريات |
| 2 | أقدّم فعالية مدفوعة: ندوة أو تحدٍّ أو ورشة أو ماستر كلاس، ثم أبيع بعدها | `paid_lto` | `true` | نعدّ: المشتريات |
| 3 | أدعو الناس إلى فعالية **مجانية**: ندوة أو تحدٍّ أو ماستر كلاس، ثم أبيع بعدها | `webinar` | unchanged | نعدّ: التسجيلات |
| 4 | أحجز استشارة مجانية ثم أبيع بعدها | `appointment` | unchanged | نعدّ: التسجيلات |
| 5 | أجمع بيانات عملاء مجانًا ثم أبيع منتجًا غاليًا | `free_lead` | unchanged | نعدّ: التسجيلات |

**Current state** (`Settings.tsx:495–517`): option 1 exists but is worded
"أبيع منتجًا أو خدمة مباشرة، أو أقدم فعالية أو استشارة مدفوعة" — it already alludes to a paid
event, yet the word "ندوة" appears **only** in option 3. Splitting option 1 into options 1 and 2
and naming "ندوة" in option 2 is the fix.

**Requirements**

- Option 2 is new and is a **presentation mapping only** — no new engine archetype, no change to
  target math or result counting (FR-021).
- A stored row with `paid_lto` + `liveComponent === true` re-selects option 2 on load (FR-022).
- Every option carries its counts line (FR-023).
- "مجانية" is emphasised in option 3 so options 2 and 3 cannot be confused (FR-024).
- Option 5 stays legacy-only — rendered solely when it is the stored value, preserving the
  existing behaviour at `Settings.tsx:512–514`.
- `liveComponent` remains an independent field for the other archetypes; options 2 and 1 are the
  only places it is set by the archetype choice.

## T3. Save-time mismatch check (FR-025)

**Trigger**: on save, compare the chosen funnel type against the account's 30-day recorded events.

```text
chosen counts registrations AND purchases30 >= 3 × leads30   → ask
chosen counts purchases     AND leads30     >= 3 × purchases30 → ask
```

**Prompt**: "حملاتك تسجل مبيعات أكثر بكثير من التسجيلات — هل الفعالية مدفوعة؟" with a one-click
switch to the matching option.

**Reverse prompt** (purchases counted, leads dominate; owner-approved 2026-10-19): "حملاتك تسجل
تسجيلات أكثر بكثير من المبيعات — هل الفعالية مجانية؟" with a one-click switch to the free-event
option. Both totals zero ⇒ no prompt. The switch saves immediately only if the switched-to type's
required fields are filled; otherwise it only changes the selection.

**Data source**: `baselines.purchases30` / `baselines.leads30`, read from the cached snapshot. Both
are summed inside the existing baselines loop (`server/meta.ts:1371–1409`) — see data-model.md §2.

**Hard constraints**

- **No new Meta request.** The check reuses the single `last_30d, time_increment=1` response that
  already produces `cpaMedian30` / `cplMedian30` (Principle V, research.md R2).
- **Never blocks or delays the save.** No network call sits in the save path.
- No snapshot, or either total `null` ⇒ the check is skipped **silently** and the save proceeds.
  An absent history is unknown, not a mismatch (principle 10).
- **Advisory only**: declining the switch saves the user's original choice unchanged.

**Implementation note**: the main save button (`Settings.tsx:711`) currently calls `save.mutate`
immediately with no pre-save dialog. The closest reusable scaffold is the nested subcomponent's
`onSave` prop (props at 1043/1050, button at 1097); the `freshStartRefused` outcome handled in
`onSuccess` (321–329) is a post-save pattern, not a pre-save one. See research.md R10.
