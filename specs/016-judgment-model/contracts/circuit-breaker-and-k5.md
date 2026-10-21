# Contract: Circuit breaker family and K5 evidence (R4, R5)

Covers FR-022–FR-027. Decisions: research.md D13, D14.

## B1. Circuit breaker (`server/engine.ts` `circuitBreaker`)

Signature: `circuitBreaker(o, target, archetype)`; the single call site in `evaluateAdset` passes
the archetype already in scope.

```
if o.level !== "adset"                              → null
c = countedResults(o.today, archetype)
if c === null                                       → null   (unknown, unchanged)
if c > 0                                            → null
if (otherFamilyResults(o.today, archetype) ?? 0) > 0 → null   (new: wrong family recorded)
spend ≥ 2.5 × target → CB2 (copy unchanged)
spend ≥ 1.5 × target → CB1 (copy unchanged)
```

Tests (FR-024):
1. `paid_lto`, today `{ conversions: 0, purchaseConversions: 0, leadConversions: 5, spend: 3×target }`
   → no CB1/CB2.
2. `webinar`, today `{ conversions: 0, leadConversions: 0, purchaseConversions: 0, spend: 3×target }`
   → CB2.
3. Existing T062 (unknown today → stand down) and `as_cb` CB2 stay green.

## B2. K5 matrix (`server/engine.ts` `starvedAdMatrix`)

```
counted = countedResults(ad.w3d, archetype) ?? 0
highEfficiency = (exposed && ctrLink > ctrMedian)
              || (counted >= 2 && adCpa !== null && adCpa <= t.unitTarget)

if highEfficiency → 🛟 K5 (copy unchanged)
NEW if !exposed && counted === 1 && adCpa !== null && adCpa <= t.unitTarget
     → ⏳ K5, reason "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات", action "راجعه بعد أن يحقق نتيجة ثانية"
if !exposed → ⏳ K5 (existing copy)
… remaining branches unchanged
```

Tests (FR-027):
1. Starved, 300 impressions, 1 counted result, CPA ≤ target → ⏳ K5 with the new reason and action
   (replaces T037's rescue assertion — deliberate update).
1a. Starved, 300 impressions, 1 counted result, CPA **above** target → not the new branch; the
   matrix proceeds as before (⏳ K5 "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه").
2. Same with 2 counted results → 🛟 K5.
3. CTR half at ≥ 500 impressions with 1 result still rescues (demo `ad_rescue` unchanged).
4. Sweep: zero 🛟 via the cost path with < 2 counted results (SC-006).
