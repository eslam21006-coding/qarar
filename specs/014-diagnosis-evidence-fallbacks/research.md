# Phase 0 Research: Diagnosis Evidence & Honest Fallbacks

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-08-26

All findings below were read directly out of the working tree at
`server/engine.ts`, `shared/qarar.ts`, `client/src/pages/Dashboard.tsx` and
`server/__snapshots__/engine.test.ts.snap`. Nothing here is inferred from documentation.

---

## R1 — The volume gates, extracted (FR-002)

**Decision**: The gates are lifted verbatim into a single exported `DIAGNOSIS_GATES` constant in
`shared/qarar.ts`. **No value changes in this feature** (FR-014).

Read from `diagnose()` at `server/engine.ts:798-889`:

| Rung | What it judges | Volume gate (today) | Comparison baseline | Break threshold (today) |
|------|----------------|---------------------|---------------------|-------------------------|
| 1 | Ad cost-per-view (CPM) | `w.impressions > 500` | `baselines.cpmAvg14` — **required**, guarded by `baselines.cpmAvg14 &&` | `w.cpm > 1.3 × cpmAvg14` |
| 2 | Hook strength (link CTR) | `w.impressions >= 1000` | `baselines.ctrLinkMedian90` — **optional**, falls back to the literal `1.0` | `w.ctrLink < median` (or `< 1.0`) |
| 3 | Message / CTA mismatch | `w.impressions >= 1000` (same gate as rung 2) | same as rung 2 | rung 2 is failing **and** `w.ctrAll >= 2 × w.ctrLink && w.ctrAll > 1.5` |
| 4 | Landing-page arrival | `w.linkClicks >= 50` **and** `w.lpViews > 0` | none | `w.lpViews / w.linkClicks < 0.75` |
| 5 | Page conversion | `w.lpViews >= 100` | none (archetype-driven) | `cvr < 15` when `archetype === "free_lead"`, else `cvr < 2` |
| 6 | Post-conversion | — | — | terminal position, never independently evaluable (A2) |

Constant names, all `as const`:

```
DIAGNOSIS_GATES.CPM_MIN_IMPRESSIONS          = 500    // rung 1, strict >
DIAGNOSIS_GATES.CPM_RATIO                    = 1.3    // rung 1 break threshold
DIAGNOSIS_GATES.CTR_MIN_IMPRESSIONS          = 1000   // rungs 2 & 3, >=
DIAGNOSIS_GATES.CTR_FALLBACK_PCT             = 1.0    // rung 2 when median is null
DIAGNOSIS_GATES.MISMATCH_CTR_ALL_MULTIPLE    = 2      // rung 3
DIAGNOSIS_GATES.MISMATCH_CTR_ALL_FLOOR       = 1.5    // rung 3
DIAGNOSIS_GATES.LP_MIN_LINK_CLICKS           = 50     // rung 4, >=
DIAGNOSIS_GATES.LP_ARRIVAL_FLOOR             = 0.75   // rung 4 break threshold
DIAGNOSIS_GATES.CVR_MIN_LP_VIEWS             = 100    // rung 5, >=
DIAGNOSIS_GATES.CVR_FLOOR_FREE_LEAD_PCT      = 15     // rung 5, free_lead archetype
DIAGNOSIS_GATES.CVR_FLOOR_DEFAULT_PCT        = 2      // rung 5, all other archetypes
```

**Rationale**: FR-002 requires the thresholds be named and documented without being tuned. Extracting
them as data (rather than leaving magic numbers inline) is also what makes the evaluability record of
R2 expressible — the same constant decides "was this judgeable" and "did it break".

**Alternatives considered**: Leaving the numbers inline and tracking evaluability with parallel
booleans. Rejected — it duplicates each threshold at two call sites, which is exactly how a future
threshold tune silently desynchronises the gate from the break test.

### R1.1 — A consequence worth stating up front

Under Q3's answer, `FUNNEL_CONFIRMED` requires rungs 4 **and** 5 evaluable and clean. Composing their
gates, the innocence claim now requires **at least 50 link clicks and at least 100 landing-page
views** in the 3-day window. That is a meaningful bar, and it is the intended effect: it is precisely
the volume at which the four-step ladder of FR-007 can actually be printed from real figures.

---

## R2 — Evaluability semantics per rung (FR-001, FR-003, FR-003a)

**Decision**: Each of rungs 1–5 resolves to exactly one `RungState` — `unevaluable`, `clean`, or
`broken` — by the table below. Rung 6 is not a rung in the record (A2).

| Rung | `unevaluable` when | `clean` when | `broken` when |
|------|--------------------|--------------|---------------|
| 1 | `impressions <= 500` **or** `cpmAvg14` is null/0 | gate met, baseline present, `cpm <= 1.3 × cpmAvg14` | gate met, baseline present, `cpm > 1.3 × cpmAvg14` |
| 2 | `impressions < 1000` | gate met, `ctrLink >= threshold` | gate met, `ctrLink < threshold` and the rung-3 mismatch shape does **not** hold |
| 3 | `impressions < 1000` | gate met and rung 2 is clean, **or** gate met and rung 2 broke without the mismatch shape | gate met, `ctrLink < threshold`, `ctrAll >= 2 × ctrLink`, `ctrAll > 1.5` |
| 4 | `linkClicks < 50` **or** `lpViews === 0` | gate met, `lpViews / linkClicks >= 0.75` | gate met, `lpViews / linkClicks < 0.75` |
| 5 | `lpViews < 100` | gate met, `cvr >= floor` | gate met, `cvr < floor` |

**Rationale for the two hard cases the spec names:**

**R2.1 — Gate met, baseline absent → unevaluable, not clean (FR-003a).** Only rung 1 is affected.
Today `baselines.cpmAvg14 && …` short-circuits the whole condition, so a null 14-day CPM average
silently produces "no finding", which the old `findings.length === 0` fallback then read as
innocence. That is defect D1 in miniature. With the record, a null baseline yields `unevaluable`, so
it can neither support an innocence claim nor be mistaken for one.

Rung 2 is deliberately **not** affected: `ctrLinkMedian90` has an explicit literal fallback of `1.0`
in today's code, so the rung is judgeable even with no median. It stays evaluable, and the missing
median is instead reported at the *rendering* layer by FR-007a — the ladder says the account median
is unavailable for that comparison rather than pretending one exists.

**R2.2 — `lpViews === 0` with `linkClicks >= 50` → unevaluable (not clean, not broken).** The spec's
edge case says a zero arrival count "must not silently read as a healthy rung", and today it does
exactly that: `w.lpViews > 0` is part of the gate, so zero arrivals skip the rung entirely and
contribute to the old innocence fallback.

The tempting fix is to call it *broken* — 0% arrival is far below the 75% floor. **Rejected.** Zero
landing-page views against 50+ link clicks is indistinguishable, from inside the snapshot, between
"nobody reached the page" and "landing-page views are not being tracked on this account" (no pixel,
a `LANDING_PAGE_VIEW` event that was never installed, or an off-site destination Meta cannot
instrument). Declaring the page broken would make the product assert a mechanism it cannot observe —
the same class of error this feature exists to remove, pointed the other way. `unevaluable` is the
honest state: it withholds the innocence claim (because rung 4 must be clean for `FUNNEL_CONFIRMED`
under Q3) without inventing a page defect.

**Alternatives considered**: (a) mark it broken — rejected above; (b) keep today's silent skip —
rejected, it is the reported defect; (c) split into a fourth state `untracked` — rejected as
unnecessary: nothing downstream would treat it differently from `unevaluable`, and it would widen the
outcome matrix for no behavioural gain.

---

## R3 — The total rule fault classification (FR-008, FR-008a)

**Decision**: `RULE_FAULT: Record<RuleCode, RuleFaultClass>` in `shared/qarar.ts`, total over all 24
codes of the `RuleCode` union, with **no default bucket**. Each justification below is drawn from
that code's own `RULES[code].defAr` in `shared/qarar.ts:33-140` — no code is reclassified against its
rulebook definition (per the spec's Dependencies section).

### R3.1 — ad-fault (5 codes)

The code blames the creative, the hook, or the ad unit itself. These rows may never claim innocence.

| Code | Rulebook definition (abridged) | Why ad-fault |
|------|-------------------------------|--------------|
| **K1** | «صرف ضعف التكلفة المستهدفة … ولم يجلب أي نتيجة — هذا الإعلان لا يبيع أصلًا» | Names the ad directly: *this ad does not sell at all*. Cited as an ad-fault example in the spec's own defect D2. |
| **K3** | «عدد كبير … شاهد الإعلان وأقل من نصف في المئة ضغط عليه — بداية الإعلان لا توقف أحدًا. غيّر التصميم» | Dead hook. Instructs changing the creative. The canonical case in User Story 2. |
| **K4** | «أول يوم كان ممتازًا ثم هبط الأداء للنصف … لا تطارد نجاح اليوم الأول» | Condemns this ad's own collapsed trajectory and instructs stopping it. The blame lands on the ad unit, not on the offer. |
| **F1** | «ضغط الناس على الإعلان نزل … الجمهور ملّ التصميم، جهّز تصميمًا جديدًا» | Creative fatigue, explicitly. |
| **F2** | «سعر ظهور هذا الإعلان يرتفع … فيسبوك لم يعد يحب هذا التصميم» | Creative-quality signal, explicitly. |

### R3.2 — funnel-fault (3 codes)

The code affirmatively exonerates the ad and points at the page, the offer, or the post-sale step.
Only these codes can reach `FUNNEL_CONFIRMED`.

| Code | Rulebook definition (abridged) | Why funnel-fault |
|------|-------------------------------|------------------|
| **W3** | «الإعلان ممتاز — المشكلة في صفحتك … ولا تغيّر شيئًا في الإعلانات» | Exonerates the ad in its own title and forbids touching it. |
| **W4** | «ناس كثيرون يضغطون … لكن ربعهم أو أكثر لا يصل للصفحة — غالبًا الصفحة بطيئة في التحميل» | Points at page load, not at the ad. Its title is «افحص سرعة صفحتك» and its action routes entirely page-side — «افحص سرعة تحميل صفحتك أولًا؛ إن كانت سريعة فتأكد أن الصفحة تطابق وعد الإعلان». The second clause mentions the ad's promise but the remedy it prescribes is to the page, never to the creative. |
| **W5** | «الإعلانات تجلب عملاء بسعر جيد … الإعلان بريء، راجع المتابعة والرسائل بعد الشراء» | Exonerates the ad by name and points post-sale. See R3.4 for its evidence path. |

### R3.3 — The K7 classification, resolved to *neither*

FR-008 requires genuinely ambiguous codes to be resolved by clarification, not guessed. **K7 is the
single code in the vocabulary whose rulebook text supports two readings**, and this section is the
record of the reading taken. **Resolved by the author, 2026-08-26: *neither*.**

- *Reading A (rejected — funnel-fault)*: K7's own instruction is «راجع العرض كاملًا» — review the
  whole offer. Its arithmetic is unit economics: cost per lead has reached the ceiling past which the
  sale loses money even when it closes. Read that way, the code points past the creative at the
  offer's price and margin.
- *Reading B (adopted — neither)*: K7 fires on `cpa >= t.cplCeiling` (`server/engine.ts:319-327`) —
  a **unit-economics ceiling, not a funnel measurement**. Its action copy says
  «المشكلة أكبر من الإعلانات», but it does not identify *which* larger thing — funnel, pricing, or
  offer. Nothing in its arithmetic observes arrival or page conversion; it never touches a rung.

**Adopted: neither.** `NO_BLAME_ASSIGNABLE` restates the rule's own reasoning without claiming the
funnel was diagnosed, and that is exactly what the numbers support: the cost per lead has reached the
economic ceiling, and *where* the money is being lost is not something a ceiling comparison can say.

**Reading A is not merely weaker — it is self-contradictory.** Under Reading A, a K7 row whose rungs
4 and 5 are both clean reaches `FUNNEL_CONFIRMED` (contract C2.2 clause 4) and asserts that the
funnel is the problem — on the one row where the funnel was just measured *working*. The traffic
arrives, the page converts, and the only failing quantity is the price of a lead against its value.
So the safety argument once made for Reading A runs backwards: Q3's rung precondition does not filter
the bad case out, it is precisely the condition that produces it. Under *neither*, that row resolves
to `NO_BLAME_ASSIGNABLE`, which is the honest statement — the ad is not condemned, the funnel is
measurably converting, and the pricing/offer diagnosis is not something the engine can confirm from
these numbers.

**Consequence, recorded because it is load-bearing.** K7 was the only funnel-fault code whose firing
condition is independent of the rung ladder. The remaining three are each coupled to a rung, and the
coupling is exact:

| Code | Firing condition | Rung it necessarily breaks |
|------|------------------|----------------------------|
| **W3** | `ctrLink > ctrMedian && lpViews >= 100 && cvr < floor` (`server/engine.ts:617-637`) | Rung 5 — same `lpViews >= 100` gate, same archetype floor, same `effectiveConversions` numerator (`server/engine.ts:846-856`) |
| **W4** | `linkClicks >= 50 && lpViews > 0 && lpViews / linkClicks < 0.75` (`server/engine.ts:639-647`) | Rung 4 — byte-identical condition (`server/engine.ts:833-840`) |
| **W5** | campaign-level post-sale signal | none — reaches `FUNNEL_CONFIRMED` through C4's own evidence path, not through clause 4 |

Because a terminal outcome is appended **only** when `broken.size === 0` (C2.1), a W3 row always has
rung 5 broken and a W4 row always has rung 4 broken, so neither can ever satisfy clause 4. **After
this change, `FUNNEL_CONFIRMED` is reachable only through C4's guarded W5 campaign path.** That is a
strengthening, not a hole — the product's one innocence-claiming outcome now rests entirely on
explicit, guarded evidence — but two things follow and are flagged rather than absorbed silently:

1. **Clauses 4 and 5 of C2.2 stay in the selector** for totality over the three-way partition
   (FR-008a) and to keep the W3/W4 classification honest, but they carry no ad- or ad-set-level
   traffic. They are not dead code to be deleted; they are the branch that a future funnel-fault code
   decoupled from the ladder would land in.
2. **Quickstart §2.4 and §2.5 fixtures pair a fired W3/W4 with clean rungs 4 and 5**, a pairing
   `runEngine` cannot produce. They remain constructable as unit tests because `diagnose()` receives
   `fired` as a parameter rather than re-deriving it, but they exercise a synthetic state. See the
   note added at quickstart §2.4.

### R3.4 — neither (16 codes)

The code condemns on cost, on a spend/result circuit break, or on delivery mechanics, and implicates
neither the creative nor the offer. With no broken rung these produce `NO_BLAME_ASSIGNABLE`.

| Code | Why neither |
|------|-------------|
| **K2** | «خسارة مستمرة» — cost per customer far above target across 2–3 days. Cost, not cause. Named in Q1's context as a *neither* case. |
| **K5** | «فيسبوك يعطي هذا الإعلان أقل من 10% من المصروف» — a delivery/allocation condition; the decision even depends on sibling ads. Implicates nothing about this ad's content or the offer. |
| **K6** | «تكلفة العميل المحتمل أصبحت ضعف متوسطك المعتاد» — cost doubled against the account's own 30-day average. Cost, not cause. (D2 in the spec lists K6 among rules that "condemned by name"; `NO_BLAME_ASSIGNABLE` satisfies D2's concern, because it does not absolve the ad either.) |
| **K7** | «تكلفة العميل … وصلت لـ 70% من قيمته المتوقعة — حتى لو باع، أنت تخسر. راجع العرض كاملًا» — a unit-economics ceiling. It says the problem is bigger than the ads without saying which bigger thing. See R3.3 for the full resolution. |
| **CB1** | «صرف اليوم مبلغًا كبيرًا بلا أي نتيجة» — same-day circuit breaker. Named in Q1's context. |
| **CB2** | «صرف اليوم أكثر من ضعفين ونصف هدفك بلا أي نتيجة» — same-day circuit breaker. Named in Q1's context. |
| **W1** | «أعلى من هدفك بقليل (ليست كارثة)» — slightly over target. Named in Q1's context. |
| **W2** | «يوم سيئ واحد بعد أيام جيدة — طبيعي جدًا» — explicitly *not* a diagnosis. Named in Q1's context. |
| **W6** | «الحساب متعادل … عند حساب كل ما سيشتريه العميل لاحقًا فأنت لا تخسر» — an LTV break-even note; assigns no fault at all. |
| **S1, S2, S3, S4** | Scale codes. Emit `continue`, so per A7 they never reach the diagnosis. Classified for totality (FR-008a). |
| **NS1, NS2** | Non-sales exemption codes. Exempt objects are hard-skipped before the ladder runs (A4, Spec 013 FR-010a), so they never reach the diagnosis. Classified for totality (FR-008a). |
| **GATE** | «لا نحكم على إعلان قبل أن تكتمل بياناته» — emits `too_early`, never reaches the diagnosis per A7. Classified for totality, and its meaning is itself "we do not judge yet". |

**Totality check**: 5 ad-fault + 3 funnel-fault + 16 neither = **24 codes**, matching the
`RuleCode` union exactly (`K1..K7`, `CB1`, `CB2`, `F1`, `F2`, `W1..W6`, `S1..S4`, `NS1`, `NS2`,
`GATE`). A type-level exhaustiveness check (`Record<RuleCode, RuleFaultClass>`) makes an unclassified
code a compile error, so the table cannot silently default (FR-008a).

**Alternatives considered**: deriving the class at runtime from the reason string. Rejected outright
— it would make the diagnosis depend on Arabic copy, which is exactly what FR-016 forbids for the
downstream logic, and it would break the moment a reason is reworded.

---

## R4 — The duplicate-row investigation (FR-012a)

**Finding: two levels of the same object, not a duplication defect.**

The observed row `V22_Aug -_Caption 1 - عندك فكرة مشروع رائعة؟` appearing twice with identical
verdict and identical diagnosis text is explained without any bug:

1. **`rows` cannot contain a duplicate.** In `runEngine` (`server/engine.ts:~1420-1470`) each object
   is pushed exactly once, in three sequential loops — ads, then ad sets, then campaigns — with no
   shared accumulator and no re-entry. There is no code path that appends the same object twice.
2. **`DiagnosisSection` does not dedupe, and should not.** It filters
   `rows.filter(r => (r.verdict === "kill" || r.verdict === "watch") && r.findings.length > 0)`
   (`client/src/pages/Dashboard.tsx:583-585`). An ad set and its single child ad both flagged will
   both appear, legitimately.
3. **Meta commonly gives an ad set and its only ad the same name.** A one-ad ad set created through
   the Ads Manager duplication flow inherits the ad's name verbatim, which is what this name looks
   like (a creative caption, not an audience label).
4. **Identical text is fully explained by the defect under repair.** Both rows hit the old step-6
   fallback, whose string is a constant — so identical text is the *expected* output of the bug, not
   additional evidence of duplication.

**Decision**: no duplication fix is required. FR-012's level label (حملة / مجموعة / إعلان next to the
name) is the correct and sufficient remedy, and after this feature the two rows will also carry
different numbers, so SC-001 distinctness resolves the rest.

**Residual**: points 1–2 are proven from the code; point 3 is the most likely reading of the observed
name and is not provable from the repository. Implementation carries one verification task: render
the fixture and confirm the two rows differ by `level`. If they instead show the same `level` **and**
the same `id`, this conclusion is wrong and a genuine duplication defect exists — the task says so
explicitly so it cannot be quietly skipped.

---

## R5 — SC-005 / A3: the stored snapshot needs no edit

**Verified, not assumed.** `server/__snapshots__/engine.test.ts.snap` (389 lines) contains:

- `0` occurrences of the old fallback substring «ليست بالإعلانات»
- `0` occurrences of `text_ar` — i.e. the snapshot records no finding text at all

The stored snapshot locks target derivation, not findings, exactly as A3 predicted. **SC-005 holds
with no snapshot edit**, and any snapshot churn appearing during implementation is a signal that
something outside the diagnosis moved and must be investigated rather than re-recorded.

---

## R6 — Presentation defects located (FR-011, FR-012)

Both row-presentation defects are in `client/src/pages/Dashboard.tsx` and are narrow:

- **FR-011** — `FindingRow` (line ~637) renders a full `<Button asChild size="sm">` for *every*
  finding carrying `ctaUrl`. With five flagged rows each carrying the old step-6 fallback, that is
  five full-width booking buttons. It becomes a single subtle inline text link, and the account-level
  `<Button>` at line ~604 is the only button that survives.
- **FR-012** — the row header (line ~625) renders `{r.name}` with a `VerdictBadge` and no level. The
  level is already on the row as `r.level: ObjectLevel`; it only needs a label map to
  حملة / مجموعة / إعلان.

Neither requires new data, and neither touches the engine.

---

## Summary of decisions

| ID | Decision |
|----|----------|
| R1 | Gates extracted verbatim into `DIAGNOSIS_GATES`; no value changes |
| R2.1 | Null `cpmAvg14` makes rung 1 unevaluable, not clean; rung 2 keeps its `1.0` fallback and stays evaluable |
| R2.2 | `lpViews === 0` with a cleared click gate is **unevaluable**, not broken — the snapshot cannot distinguish "nobody arrived" from "arrival untracked" |
| R3 | 24-code total classification: 5 ad-fault, 3 funnel-fault, 16 neither; compile-enforced totality |
| R3.3 | **K7 → neither**, resolved by the author 2026-08-26: a cost-ceiling comparison never measures a rung, so the row resolves to `NO_BLAME_ASSIGNABLE`. Consequence tracked in §R3.3 and contract C2.6 |
| R4 | Duplicate row is two levels of one object; FR-012's level label is the fix; one verification task carried |
| R5 | Stored snapshot verified free of finding text — SC-005 needs no edit |
| R6 | FR-011 and FR-012 are two localised changes in `Dashboard.tsx` |
