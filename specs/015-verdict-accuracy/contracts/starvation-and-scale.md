# Contract: Starvation floor (K5) and the scale guard (S2)

**Feature**: `015-verdict-accuracy` · Covers FR-011–FR-016, FR-029 · Rulebook §5.0, §5.4

## K1. Current behaviour (`starvedAdMatrix`, `server/engine.ts:536`)

| Element | Current |
|---|---|
| Starvation trigger (544) | `spendSharePct < 10 && ageDays > 2` |
| `spendSharePct` source | `server/meta.ts:1292–1303` — **3-day total** share, `a.w3d.spend / total * 100` |
| Rescue (550–552) | `ctrLink > ctrMedian \|\| (adCpa !== null && adCpa <= t.unitTarget)` |
| `weak` (587–589) | `ctrLink < ctrMedian && (effectiveConversions(…) ?? 0) === 0` |
| Impressions floor | **none anywhere in the function** |
| Verdicts returned | `rescue`, `continue`, `kill` ×2, `watch` — all rule `K5` |

`ctrMedian = baselines.ctrLinkMedian90 ?? 1.0`.

## K2. Required changes

### FR-011 — starvation must hold on each of the last 3 days

Replace the 3-day-total test with a per-day test: the ad's share of its parent ad set's spend
must be below 10% on **each** of the last three days individually.

Per-day data is already present — `NormalizedObject.daily7: DailyMetrics[]`
(`shared/qarar.ts:255`) is required and `DailyMetrics extends WindowMetrics`, so the share for
day *d* is `ad.daily7[d].spend / parent.daily7[d].spend`. No new fetch.

The existing `spendSharePct` field stays for its other readers.

**Missing slices**: fewer than three usable days ⇒ starvation cannot be established ⇒ the matrix
does not fire (principle 10 — unknown, not zero).

### FR-012, FR-013 — a 500-impression floor on weakness

**The floor is measured on the 3-day window total — `w3d.impressions` — not per day.** FR-012
says "in the window", and the window is `w3d` throughout the engine. This matters concretely: the
demo fixture's `ad_rescue` has `w3d.impressions = 1100` but daily impressions of 380/370/350, each
below 500. On the window reading it keeps 🛟 `K5` and the regression snapshot is unchanged; on a
per-day reading it would flip. Do not read this floor per-day.

(The per-day requirement in FR-011 applies to the *spend share*, not to impressions. The two
clauses are measured over different granularities by design.)

`weak` additionally requires `w3d.impressions >= 500`. Below the floor, and not rescue-eligible:

```text
verdict: "too_early"
rule:    "K5"
reason:  "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه"
action:  "اتركه — لا قرار الآن"
```

An ad with zero impressions is never judged weak (FR-013) — it is the limiting case of the floor.

### FR-014, FR-015 — the rescue branch is split

The current single `||` lets a tiny-sample CTR blip alone produce 🛟, which is the
ten-rescues symptom. Split the two halves:

| Rescue half | New requirement |
|---|---|
| CTR-based (`ctrLink > ctrMedian`) | also requires `w3d.impressions >= 500` (FR-014) |
| CPA-based (`adCpa <= t.unitTarget`) | also requires at least one **counted** conversion (FR-015) |

"Counted" means per `effectiveConversions(ad, archetype)`, after the event-match gate.

**FR-015 is already satisfied.** `effectiveCpa()` (`server/engine.ts:~298–305`) returns `null`
whenever `effectiveConversions === 0`, and the CPA half already tests `adCpa !== null`. This
clause needs a **confirming test, not an implementation change** — provided no path bypasses
`effectiveCpa`. FR-014 is the half that actually changes.

### FR-016 — zero results are read only after the event-match gate

`weak`'s `conversions === 0` term is only meaningful once the event-match gate has passed, so a
counting mismatch can never present as weak efficiency. Guaranteed by gate order
([gate-order.md](./gate-order.md) §G1): the event-match gate is step 4, the matrix is step 6.

Additionally, `w3d.resultsUnknown === true` ⇒ the matrix does not treat results as zero
([unknown-vs-zero.md](./unknown-vs-zero.md) §U2).

## K3. Decision table after the change

| Starved on each of 3 days | Impressions | CTR vs median | Counted conv | Verdict |
|---|---|---|---|---|
| no | — | — | — | matrix does not fire |
| yes | 0 | — | — | ⏳ K5 (no exposure) |
| yes | < 500 | above | 0 | ⏳ K5 — **not** 🛟 |
| yes | < 500 | below | 0 | ⏳ K5 — **not** 🔴 |
| yes | ≥ 500 | above | any | 🛟 K5 rescue |
| yes | any | any | ≥ 1 and CPA ≤ target | 🛟 K5 rescue |
| yes | ≥ 500 | below | 0, parent missing target | 🔴 K5 (unchanged) |
| yes | ≥ 500 | below | 0, parent hitting target | existing `continue` branch (unchanged) |

## K4. Scale guard (FR-029)

**Current** (`server/engine.ts:1581`):

```ts
if (hasFullRoas && fullRoas >= 2.0) { … action: "…فزد الميزانية 20% فقط كل يومين أو ثلاثة" }
```

The condition tests full-funnel ROAS **alone** — there is no CPA comparison anywhere in it. This
is why campaigns at 1.38× and 1.26× their target were told to raise budget.

**Required**: the S2 "+20%" action additionally requires the campaign's cost per result to be at
or below its unit target. Otherwise:

```text
action: "واصل بدون زيادة الميزانية"
verdict: follows the watch rules
```

**Verdict when above target** (spec Assumptions): for 1×–1.5× target the rulebook's W1 band
applies; above 1.5× with a full-funnel return at or above the safety floor, W6
("كمّل بحذر — الحكم النهائي للفانل") applies, since the rulebook defines W6 for exactly that case.
Either way no "+20%" is emitted. This is interim — feature 016 (T6) replaces campaign rule logic
with a derivation from the ad sets.

**Invariants**

- No campaign whose cost per result exceeds its target receives "+20%" advice (SC-007).
- A campaign at or below target with a healthy full-funnel return keeps today's S2 action
  unchanged.
- Rule codes stay verbatim; S2, W1 and W6 are existing codes (FR-032).
