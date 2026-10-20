# Contract: Table copy (R6) and new-string review

Covers FR-028–FR-030. Decision: research.md D15.

## L1. Column labels (`ALL_COLUMNS`, `DecisionTable.tsx:243–261`)

Each entry gains `hint` (rendered as the header's `title`) holding the metric abbreviation. Labels
from the brief are fixed; the rest are translated in the same style.

| key | label (was) | label | hint |
|---|---|---|---|
| spend | Spend | الصرف | Spend |
| results | Results | النتائج | Results |
| cpa | CPA | تكلفة النتيجة | CPA |
| roas | ROAS | العائد على الإعلان | ROAS |
| ctrLink | Link CTR | نسبة الضغط على الرابط | Link CTR |
| ctrAll | CTR (All) | نسبة الضغط الكلية | CTR (All) |
| cpm | CPM | تكلفة ألف ظهور | CPM |
| cpc | CPC | تكلفة الضغطة | CPC |
| hookRate | Hook Rate | نسبة جذب أول 3 ثوانٍ | Hook Rate |
| holdRate | Hold Rate | نسبة إكمال المشاهدة | Hold Rate |
| lpRate | LP View % | نسبة الوصول للصفحة | LP View % |
| spendShare | % Spend | نصيبه من الصرف | % Spend |
| frequency | Frequency | مرات الظهور للشخص | Frequency |
| impressions | مشاهدات | مشاهدات (unchanged) | Impressions |

3d CPA header override (`:1154`): "تكلفة العميل (٣ أيام)" → **"تكلفة النتيجة (3 أيام)"**, with
the numeral LTR. The column picker shows the same labels.

## L2. Window banner (`DecisionTable.tsx:1096–1101`)

Still rendered when `range !== "3d"`. Text, exactly:

> ℹ️ الحكم محسوب دائمًا على آخر 3 أيام كاملة (بدون اليوم)، ولا يتأثر بالفترة المختارة.

The loading and lazy-error lines in the same block are unchanged.

## L3. New strings in this feature

| String | Where | Contract |
|---|---|---|
| أوقِف {…} وأبقِ {…} / أبقِ {…} | campaign action | campaign-derivation C3 |
| أوقِف الحملة — كل مجموعاتها تخسر | campaign action | C3 |
| اترك البيانات تتجمع | campaign action, R3 action | C3, consistency-guard G2 (existing string) |
| فيها … يستحق/يستحقان/تستحق الإنقاذ | campaign action | C3 |
| مجموعات هذه الحملة — ناجحة: … | campaign reason | C4 |
| لا توجد مجموعة نشطة داخل هذه الحملة | campaign reason | C4 |
| العائد الكلي للفانل: {x}x + tooltip | campaign row | C5 |
| زد الميزانية فقط عندما تكون كل المجموعات بالداخل ناجحة | budget tooltip | C6 |
| لم يصل عدد النتائج من ميتا | results/CPA tooltip | single-source N5 |
| قيمة المبيعات لم تصل من ميتا لبعض الصفوف | footer ROAS tooltip | N5 |
| نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات | K5 reason | circuit-breaker-and-k5 B2 |
| راجعه بعد أن يحقق نتيجة ثانية | K5 action | B2 |
| من مجموعة {name}: {rule title} | derived campaign rule title (table row, top actions) | campaign-derivation C2a |
| من إحدى مجموعاتها: {rule title} | verdict history, derived 🟡 campaign entries | campaign-derivation C2b |

Review checklist for each (FR-030): simple MSA at a 6th-grade level; numbers through `arabicCount`
wherever a count meets a noun; Western digits rendered LTR (`.num` / `withLtrNumerals`); no rule
code in primary copy.

## L4. Tests

Header labels equal L1; banner text equals L2 exactly; `arabicCount` table test (0, 1, 2, 3, 10, 11,
100) for both noun forms.
