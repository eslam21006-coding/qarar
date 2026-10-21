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

The numeric filter fields (`FILTER_FIELDS` in `client/src/lib/filters.ts`: spend, impressions, cpa,
ctrLink, cpm) use the same labels as the columns above (self-review S4).

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
| غيّر ميزانية الحملة فقط عندما تكون كل المجموعات بالداخل ناجحة — وإلا أوقِف المجموعات الخاسرة، والميزانية تذهب وحدها إلى الرابحة | budget tooltip | C6 |
| لم يصل عدد النتائج من ميتا | results/CPA tooltip | single-source N5 |
| قيمة المبيعات لم تصل من ميتا لبعض الصفوف | footer ROAS tooltip | N5 |
| نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات | K5 reason | circuit-breaker-and-k5 B2 |
| راجعه بعد أن يحقق نتيجة ثانية | K5 action | B2 |
| من مجموعة {name}: {rule title} | derived campaign rule title (table row, top actions) | campaign-derivation C2a |
| من إحدى مجموعاتها: {rule title} | verdict history, derived 🟡 campaign entries | campaign-derivation C2b |
| في آخر 3 أيام: تكلفة النتيجة {cpa} والهدف {target} — التكلفة عالية، لكن الصرف لم يصل بعد إلى حد الإيقاف ({3×target}) | FR-036 reason, ad set above 1.5× target with 3-day spend < 3× target | spec FR-036 |
| لا تزد الميزانية. راقبها يومين أو ثلاثة — إن وصل صرفها إلى {3×target} والتكلفة ما زالت فوق {1.5×target} فأوقِفها | FR-036 action, same case | FR-036 |
| في آخر 3 أيام: تكلفة النتيجة {cpa} والهدف {target} — التكلفة عالية | FR-036 reason, any ad above 1.5× target, or an ad set at ≥ 3× spend | FR-036 |
| لا تزد الميزانية. إن بقيت التكلفة فوق {1.5×target} بعد يومين أو ثلاثة فأوقِف هذا الإعلان | FR-036 action, ad | FR-036 |
| لا تزد الميزانية. إن بقيت التكلفة فوق {1.5×target} بعد يومين أو ثلاثة فأوقِفها | FR-036 action, ad set at ≥ 3× spend | FR-036 |
| راقبه / راقبها يومين أو ثلاثة بدون أي تعديل | W1 action (1×–1.5×, watch rules and the FR-036 guard): ad / ad set | FR-030 level-aware W copy |
| لا تلمسه / لا تلمسها — أي تعديل الآن سيخرب تعلّم فيسبوك ويزيد التكلفة | W2 action: ad / ad set | FR-030 |
| صرف / صرفت {x} بدون أي نتيجة — لم يصل / لم تصل لحد الإيقاف بعد لكن يحتاج / تحتاج مراقبة | W1 zero-result reason: ad / ad set | FR-030 |
| راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ {2×target} سيُوقف تلقائيًا / راقبها — إن لم تحقق نتائج قبل أن يصل صرفها لـ {2×target} ستُوقف تلقائيًا | W1 zero-result action: ad / ad set | FR-030 |
| تنبيه اليوم — راجعها غدًا / خطر اليوم — أوقِفها فورًا (+ definitions in the feminine) | CB1 / CB2 rule titles (ad-set-only rules) | self-review M1 |
| أوقِفها الآن — وراجعها بنفسك قبل تشغيلها مرة أخرى / راجعها غدًا صباحًا قبل أن تصرف من جديد / انسخها لجمهور جديد مع الحفاظ على تفاعلاتها — أفضل من رفع الميزانية كثيرًا | CB2 / CB1 / S3 actions (ad-set-only rules) | T047 |
| إيقاف جديد: {count per level, e.g. حملة واحدة، مجموعتان، 3 إعلانات} / دخلت حالة الإيقاف منذ آخر تحديث: + one line per object «الحملة / المجموعة / الإعلان: {name}» | daily-refresh notification (title / body), noun by level, counts through `arabicCount` | self-review N10 |

W3, W4 and W6 copy has no word that refers to the row, so it is the same for ads and ad sets. Rule
titles in `RULES` other than CB1/CB2 stay ad-centric until feature 018 (self-review S1).

Review checklist for each (FR-030): simple MSA at a 6th-grade level; numbers through `arabicCount`
wherever a count meets a noun; Western digits rendered LTR (`.num` / `withLtrNumerals`); no rule
code in primary copy.

## L4. Tests

Header labels equal L1; banner text equals L2 exactly; `arabicCount` table test (0, 1, 2, 3, 10, 11,
100) for both noun forms.
