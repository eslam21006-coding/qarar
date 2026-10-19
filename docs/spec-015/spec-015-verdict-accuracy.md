# Spec 015 — Verdict Accuracy, Ad-Set Judgment & Geo Tiers

**Date:** 2026-10-18 · **Author:** Claude (with Eslam) · **Target:** the agent implementing the changes
**Source of truth:** `qarar-rulebook-v2.2.md` (project file — supersedes v2.1 where they differ). Every rule code stays verbatim. All user-facing copy: simple MSA, ≤6th grade, no jargon. Verdict set stays exactly 🔴 🟡 🟢 🛟 ⏳.
**Code baseline:** `eslam21006-coding/qarar@d7bd5b3` (main, 2026-08-27). Line anchors below refer to that commit — re-locate by function name if they have drifted.

---

## 0. What happened (evidence)

Live account, window 15–17 Oct 2026, compared against Ads Manager:

| Campaign | Ads Manager (spend / purchases / CPA) | Qarar verdict |
|---|---|---|
| ES - WW - 8 Oct | $809 / 16 / $50.59 | 🔴 K1 "صرفت $809 بدون أي نتيجة" |
| MO - CBO - 13 Oct | $369 / 8 / $46.18 | 🟡 W6 "العائد الكلي 0.0x" |
| Specific Countries (a) | $84.75 / 4 / $21.19 | ⏳ "صرف أقل من تكلفة عميل واحد" |
| Specific Countries (b) | $84.62 / 9 / $9.40 | ⏳ same |
| ABO - 17 Oct | $232 / 1 / $232 | ⏳ same |

Same rows show `Results = 16, 8, 4, 9, 1` and an empty CPA column in the 3d view. Ad-level "أين المشكلة؟" showed 🔴 on a paused ad, on an ad with 0 impressions, and 🔴 next to "البيانات غير كافية".

## 1. Verified root causes (read from code — not guesses)

### RC1 — Archetype counts leads; the campaigns record purchases
- `engine.ts:266 effectiveConversions()` returns `w3d.leadConversions` for `appointment` / `webinar`, else `w3d.conversions`.
- `meta.ts:386 parseInsightsRow()` — `conversions` = first hit of `[omni_purchase, purchase, offsite_conversion.fb_pixel_purchase, lead, offsite_conversion.fb_pixel_lead]`; `leadConversions` = lead types only.
- `DecisionTable.tsx aggFromWindow()` — **Results column = `w.conversions`** (purchases included). Engine for lead archetypes = `leadConversions` = 0.
- With paid_lto the engine would have seen 16 (same field as the Results column). It saw 0 ⇒ the account's funnel settings are `webinar` or `appointment`.
- Consequence: every campaign/ad set/ad reads as zero-result → K1, W6 "0.0x", K5 "weak".
- **Confirmed by the owner (18 Oct):** settings archetype = "ندوة" (`webinar`), but the event is a **paid** webinar and the campaigns optimize for Purchase. The `webinar` option label (`Settings.tsx:516`) says "فعالية مجانية", while a paid event belongs to `paid_lto` (`Settings.tsx:503`, "...أو أقدم فعالية أو استشارة مدفوعة") + `liveComponent = true`. The word "ندوة" appears only in the free option, so a paid-webinar owner naturally picks the wrong one. Any coach running a paid challenge/webinar hits the same trap.

### RC2 — The target shown ≠ the target used
- `shared/qarar.ts deriveTargets()` for `appointment`/`webinar`: `unitTarget = baselines.cplMedian30` **first**, then funnel math, then benchmark.
- `meta.ts:~1390` `cplMedian30` = median of daily (account spend ÷ account leads) over days with ≥1 lead. An account that rarely records leads produces a huge "CPL".
- `Settings.tsx:254-256` previews targets with `deriveTargets(inputs, null, …)` — **no baselines** ⇒ shows the funnel-math number (user sees $45).
- From the engine's own outputs, the judging target was between **$232 and $404** (ES-WW K1 fired: 809 ≥ 2T; MO-CBO did not: 369 < 2T; ABO gated: 232 < T).

### RC3 — Starved matrix (K5) runs before the paused check and judges ads with no data
- `engine.ts:1631 evaluateAd()` order: preSep → K3 → **starvedAdMatrix** → `gateVerdict` (paused check lives inside `gateVerdict`, `engine.ts:336`).
- `starvedAdMatrix()` (`engine.ts:536`): `spendSharePct < 10` from the 3d **total** (not per-day), `weak = ctrLink < median && conversions === 0`. A paused ad (share 0%) or a 0-impression ad (CTR 0) ⇒ `weak` ⇒ 🔴 K5. With RC1, `conversions === 0` is always true.
- The diagnosis for those ads correctly says "insufficient data" (`insufficientDataText`, `engine.ts:984`) → verdict and diagnosis contradict.

### RC4 — Ad identity is ambiguous
- Ad rows carry only `name`. The same creative runs in several ad sets (Ad 39 has ≥4 copies inside 6 ad sets, likely a 5th elsewhere). The diagnosis panel (`Dashboard.tsx:~575 DiagnosisSection`) shows name only, no thumbnail, no campaign › ad set, no link.
- Ads Manager view used for comparison was filtered to 6 ad sets, which hides copies elsewhere.

### RC5 — CPM rung compares an ad to the whole account
- `engine.ts:~158 evaluateRungs()` rung 1: `w.cpm > CPM_RATIO × baselines.cpmAvg14` (account-wide 14d average). Ads targeting GCC/US/EU always look "expensive" next to WW ads. Observed: Ad 39 copies range from $4.23 to $37.41 CPM — same creative.

### RC6 — Copy / display issues
- `DecisionTable.tsx:1072` banner says the verdict uses "آخر 3 أيام + اليوم". The engine uses `last_3d` (excludes today) — banner is wrong.
- `insufficientDataText()` produces "99 زيارات … إضافية" / "5 زيارة": broken number–noun agreement and word order.
- Column headers `Spend`, `Results`, `Link CTR`, `CPA` are English.
- CPA cell shows "—" for ⏳ rows even when results > 0 (R9 design) — conflicts with rulebook v2.2 §5.5 rule 4.

---

## 2. Tasks (in priority order)

### P0 — Stop false kills (ship first, small)

**T1 · Event-match gate (rulebook §4.1)** — `engine.ts`
- New helper `eventMatchGate(o, archetype)`, evaluated right after the status gate in `evaluateAd`, `evaluateAdset`, `evaluateCampaign`.
- Counted = `effectiveConversions(o, archetype)`; other = lead archetypes → `w3d.purchaseConversions`, purchase archetypes → `w3d.leadConversions`.
- `counted === 0 && other > 0` ⇒ `{ verdict: "too_early", rule: "GATE", reason: "إعدادات الفانل تعدّ نوعًا من النتائج لا تسجله هذه الحملة — هذه الحملة تسجل مبيعات/تسجيلات من النوع الآخر", action: "راجع نوع الفانل في الإعدادات" }` (pick the noun from the archetype).
- Account-level: if ≥ 50% of active spend sits in rows tripping this gate, set `summary.settings_mismatch = true` and render a top-of-dashboard warning card linking to Settings.
- **Tests:** webinar archetype + `{leadConversions:0, purchaseConversions:16, spend:809}` ⇒ ⏳ GATE (not K1). Same with `{0, 0}` ⇒ K1 unchanged.

**T2 · Status gate first (rulebook §4.2)** — `engine.ts`
- Move the `effectiveStatus !== "ACTIVE"` check out of `gateVerdict` into a `statusGate()` called **first** in all three evaluators (before preSep, K3, K5). Same output as today's paused branch.
- `DiagnosisSection` and top-actions must exclude non-ACTIVE rows.
- **Tests:** paused ad with 0% share ⇒ ⏳ (not K5). Ad in a paused ad set (`effective_status: ADSET_PAUSED`) ⇒ ⏳.

**T3 · K5 weakness floor (rulebook §5.0)** — `starvedAdMatrix()`
- Require starvation on **each** of the last 3 days (`daily7` slices) instead of the 3d total.
- `weak` requires `w3d.impressions >= 500`. Below that and not rescue-eligible ⇒ `{ verdict: "too_early", rule: "K5", reason: "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه", action: "اتركه — لا قرار الآن" }`.
- The same 500-impression floor applies to the **rescue** branch (`highEfficiency` via CTR). CTR on a few hundred impressions is noise; after the fix to paid_lto the live account showed 10 🛟 rescues, several on tiny samples. CPA-based rescue (`adCpa ≤ target`) still needs ≥ 1 counted conversion.
- **Tests:** starved ad with 0 impressions ⇒ ⏳ K5. Starved, 800 imp, CTR < median, 0 conv, tired parent ⇒ 🔴 K5 (unchanged). Starved, 300 imp, CTR above median, 0 conv ⇒ ⏳ (not 🛟).

**T4 · Shown target = used target (rulebook §4.1, principle 9)**
- Server returns the exact `unitTarget` + `unitTargetSource` the engine used (already in `DerivedTargets`) to the dashboard summary and Settings.
- `Settings.tsx`: when the server has baselines, show the engine's target, and below it the source in simple Arabic ("محسوب من متوسط حسابك في آخر 30 يومًا" / "محسوب من أرقام الفانل"). If the funnel-math preview differs from the engine target by > 20%, show both and say which one the engine uses.
- **Test:** webinar with `cplMedian30 = 300`, funnel math = 45 ⇒ Settings shows $300 as the judging number with source line.

**T4b · Make the archetype choice impossible to get wrong** — `Settings.tsx:~495-520`
- **Owner decision (18 Oct): add a dedicated "paid event" option** to the archetype select. It is a UI option only — no new engine archetype:

  | Option (label) | Stored as |
  |---|---|
  | أبيع منتجًا أو خدمة بسعر منخفض مباشرة | `paid_lto`, `liveComponent = false` |
  | **أقدّم فعالية مدفوعة: ندوة أو تحدٍّ أو ورشة أو ماستر كلاس، ثم أبيع بعدها** *(جديد)* | `paid_lto`, `liveComponent = true` |
  | أدعو الناس إلى فعالية **مجانية**: ندوة أو تحدٍّ أو ماستر كلاس، ثم أبيع بعدها | `webinar` |
  | (existing appointment / free_lead options) | unchanged |

- Loading: a saved row with `paid_lto` + `liveComponent = true` selects the paid-event option.
- Under each option, one short line naming what Qarar counts: "نعدّ: المشتريات" / "نعدّ: التسجيلات".
- The word "مجانية" is bold in the free option so the two event options can't be confused.
- No engine changes: the paid-event option uses the existing `paid_lto` target math and purchase counting.
- Save-time check: read the account's last-30d `actions`. If the chosen archetype counts leads but purchases are ≥ 3× leads (or the reverse), show before saving: "حملاتك تسجل مبيعات أكثر بكثير من التسجيلات — هل الفعالية مدفوعة؟" with a one-click switch.
- **Tests:** choosing the paid-event option ⇒ stored `archetype = paid_lto`, `liveComponent = true`; reloading that row re-selects the paid-event option.

**T5 · Null ≠ 0 (principle 10)**
- `parseInsightsRow`: keep numeric zero only when Meta returned the `actions`/`action_values` array; if the array is absent, mark `conversionValue` as `null` (type change: `conversionValue: number | null`).
- Any rule reading value/ROAS skips on null (campaign W6 "0.0x" must not fire on null).
- **Test:** campaign with conversions > 0 and no `action_values` ⇒ no "العائد 0.0x" text.

### P1 — Judgment model (rulebook §5.0)

**T6 · Ad set is the judgment unit; campaign verdict derived**
- Replace `evaluateCampaign()` rule logic with a derivation from its child ad-set rows (table in rulebook §5.0): any 🟢 child ⇒ never "أوقف الحملة"; all judged children 🔴 ⇒ 🔴; none past gates ⇒ ⏳; else 🟡 with the list of red ad sets. Keep NS1/NS2 exempt branch first. Keep campaign ROAS as a displayed number, not a verdict source. Rule code for the derived verdict: reuse the code of the dominant child rule; the action names the ad sets to pause.
- ±20% buttons: ABO → on ad set rows; CBO → on campaign row, enabled only when all active child ad sets are 🟢.
- **Tests:** CBO with one 🟢 and two 🔴 ad sets ⇒ campaign action says pause the two by name, verdict ≠ 🔴.

**T7 · Single source for Results & CPA (rulebook §5.5)**
- 3d view: Results column and CPA column both come from the engine row (`conversions_3d`, `cpa_3d`) — counted with the same selector as the verdict. Other ranges: same selector applied to the range aggregate.
- Show CPA whenever results > 0, for every verdict (drop the R9 "— for ⏳" behavior).
- Invariant test: for every row in every fixture, `results > 0 ⇒ cpa !== null` and `reason_ar` never contains "بدون أي نتيجة" when `results > 0`.

**T7b · Campaign scale advice must respect S2**
- Observed after the archetype fix: ES-WW ($50.6 CPA vs $36.7 target = 1.38×) and MO-CBO (1.26×) got 🟢 "زد الميزانية 20%" because `evaluateCampaign` (`engine.ts:~1580`) returns S2 on full-funnel ROAS ≥ 2.0 alone. Until T6 lands, the S2 "+20%" action requires the campaign CPA ≤ unit target; otherwise the action is "واصل بدون زيادة الميزانية" and the verdict follows W1 territory.
- **Test:** campaign with fullRoas 3.2 and CPA 1.38× target ⇒ no "+20%" in `action_ar`.

**T7c · Summary counts match the panels**
- Observed: the summary strip shows "للإيقاف 0" and "نزيف يومي $0" while "أين المشكلة؟" lists five 🔴 ads (all paused / not delivering — RC3). After T2 these rows disappear; add an invariant test that the 🔴 count in `summary` equals the number of 🔴 rows rendered anywhere.

**T8 · Verdict/diagnosis consistency (rulebook §5.5)**
- If `diagnose()` emits `INSUFFICIENT_DATA` and the fired rule is not K3/CB1/CB2, the row verdict must be ⏳. Add as a post-check in `runEngine` with a unit test; log (dev only) when it triggers so the root rule can be fixed.

### P2 — Geo tiers (rulebook §2.5, G1)

**T9 · Data plumbing**
- `meta.ts:546` ad-set fields: add `targeting{geo_locations,excluded_geo_locations}`.
- For ad sets classified **mixed**, fetch `/{adset_id}/insights?date_preset=last_3d&breakdowns=country&fields=spend,actions` (only mixed ones — keep call count low; batch where possible).
- `NormalizedObject`: `geoClass: "qualified" | "cheap" | "mixed" | null`, `countryBreakdown?: Array<{country, spend, purchases}> | null` (null = unknown, per principle 10).

**T10 · Settings**
- `funnelSettings`: `qualifiedCountries` (JSON array of ISO codes; default = GCC 6 + US, CA, GB, EU-27, CH, NO, IS, AU, IL), `cheapTargetPct` (default 30). Migration is manual on production (see technical gotchas) — ship the SQL + note.
- Settings UI: editable country list (chips) + percentage input, simple Arabic labels.

**T11 · Engine**
- `tierTarget(o, t)` per rulebook §2.5: qualified ⇒ `unitTarget`; cheap ⇒ `unitTarget × pct`; mixed ⇒ `allowedSpend / purchases` from the breakdown; mixed with zero purchases ⇒ use the tier holding > 50% of spend; breakdown missing ⇒ ⏳ GATE "تقسيم الدول لم يصل من ميتا بعد".
- Every rule that reads `t.unitTarget` for an ad set (gates, CB1/CB2, K1/K2, W1, S1…) reads `tierTarget` instead. Ads inherit their ad set's tier target.
- **G1** (new rule code, add to `RuleCode` + `RULES` catalog): mixed ad set with cheap-country spend share ≥ 20% ⇒ finding `G1` with `X%` filled; does not change the verdict; surfaces in top actions. Copy in rulebook §5.2.
- **Tests:** the worked example in rulebook §2.5 (16 sales, 4 qualified / 12 cheap, $809) ⇒ effective target $21.4, verdict 🔴 K2 territory; all-qualified ad set $9.40 CPA vs $45 ⇒ 🟢.

### P3 — Identity, CPM, copy

**T12 · Ad identity everywhere**
- `meta.ts:556` ad fields: add `creative{effective_object_story_id}` (Post ID).
- Diagnosis panel, scaling list ("إعلانات جاهزة للتوسيع"), top actions: show thumbnail (`thumbnailUrl` already on the row), `campaign › ad set` line, and the existing Ads Manager deep link for that ad id.
- Table at ad level: group rows sharing a Post ID under a parent row with summed metrics; children keep their own verdicts.

**T13 · CPM rung within the ad set (rulebook Part 8)**
- `evaluateRungs()` rung 1: baseline = median CPM of siblings in the same ad set with ≥ 500 impressions; fallback = ads in ad sets with the same `geoClass`; none ⇒ rung not evaluable. Remove the account-average comparison. Never mark rung 1 broken when the ad's CPA ≤ its tier target.
- Fatigue signal 3 (F2) uses the same sibling baseline.

**T14 · Copy fixes**
- `DecisionTable.tsx:1072`: "الحكم محسوب دائمًا على آخر 3 أيام كاملة (بدون اليوم)، ولا يتأثر بالفترة المختارة."
- Arabic number–noun helper `countNoun(n, singular, plural)` (1 → مفرد، 2 → مثنى، 3–10 → جمع، 11+ → مفرد) used by `insufficientDataText` and all engine copy; rewrite to "نحتاج تقريبًا {n} {noun} إضافية".
- Column labels: الصرف، النتائج، نسبة الضغط على الرابط، تكلفة النتيجة.

---

## 3. Constitution & rulebook housekeeping
- `.specify/memory/constitution.md` §I evaluation order → replace with the order in rulebook v2.2 §5.5 (status gate and event-match gate first). This is an intentional, owner-approved change.
- Commit `qarar-rulebook-v2.2.md` into the repo next to the code references, and update the header comments in `engine.ts` / `shared/qarar.ts` from v2.1 to v2.2.

## 4. Acceptance (re-run on the same live account)
1. With the funnel archetype left as `webinar`: purchase campaigns show ⏳ with the settings-mismatch message — no 🔴/🟡 "بدون نتيجة"/"0.0x".
2. After switching to `paid_lto` + live component (the correct setting for this paid webinar): Specific Countries (b) 🟢, ES-WW judged per its geo mix, ABO 17 Oct the only campaign with a loss signal.
3. No paused or 0-impression ad appears in "أين المشكلة؟".
4. Every ad card shows thumbnail + campaign › ad set + link.
5. `npm test` and `npm run check` pass; new tests listed above included.
