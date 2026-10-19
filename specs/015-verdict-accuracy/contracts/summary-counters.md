# Contract: Summary counters and the mismatch card

**Feature**: `015-verdict-accuracy` · Covers FR-005, FR-030–FR-030d · Rulebook §5.0, §5.5

## S1. Payload additions (`buildSummary()`, `server/engine.ts:2119`)

| Field | Type | Meaning |
|---|---|---|
| `kill_adsets` | `number` | N — ad-set rows with verdict `kill` that pass the status gate |
| `kill_ads` | `number` | M — ad rows with verdict `kill` that pass the status gate |
| `settings_mismatch` | `boolean` | event-match-gated objects hold ≥ 50% of active spend |

`counts: Record<Verdict, number>` is left unchanged so unrelated readers keep working; feature 016
revisits it. The new fields are additive.

## S2. Counted population (FR-030)

- Counted: **ad sets and ads**.
- Never counted: **campaigns**. A campaign is a summary of its ad sets (rulebook §5.0), so
  counting one double-counts the same loss. The current implementation counts all three levels
  (`engine.ts:2141–2144`) and must stop counting campaign rows.
- Never counted: gated objects (FR-030c), via the existing `isActive` resolver
  (`engine.ts:2130–2136`).

## S3. Display (FR-030a)

```text
للإيقاف: {N} مجموعة · {M} إعلان
```

- A part whose count is `0` is hidden.
- Both parts zero ⇒ the whole counter reads as it does today for an all-clear account.
- Numerals render left-to-right (`.num`) inside the RTL layout (FR-033).
- Replaces the single `summary.counts.kill` render at `client/src/pages/Dashboard.tsx:242`.

**Known copy gap**: `{N} مجموعة` is correct for 1 and for 11+, not for 2 or 3–10. The shared
number–noun helper is task T14 in feature 018; until then the label ships as specified rather
than inventing a one-off rule (spec Assumptions).

## S4. Daily bleed (FR-030b)

Sum the spend of every red ad set, plus the spend of red ads **whose parent ad set is not red**.

**Already implemented.** `engine.ts:2152–2183` skips an ad when
`r.parentId && killAdsetIds.has(r.parentId)` (2171) and skips a campaign when a child was already
counted (2182), with all three loops `isActive`-gated. FR-030b therefore requires **tests, not new
logic** — the existing formula is otherwise unchanged.

## S5. Invariants (FR-030d)

- `kill_adsets` equals the number of red ad-set rows; `kill_ads` equals the number of red ad rows.
- Every red ad or ad set appearing in "أين المشكلة تحديداً؟" or in the top-actions list is
  included in N or M, and nothing else is.
- Switching the table between campaign, ad-set and ad level changes **neither** number.
- No spend is counted twice in `bleed_daily`.

### Required test pairs

| Fixture | Expected |
|---|---|
| red ad inside a yellow ad set | `kill_ads = 1`, that ad set not in `kill_adsets`, bleed = the ad's spend |
| red ad inside a red ad set | `kill_adsets = 1`, `kill_ads = 1`, bleed = the ad set's spend only |
| only red rows are gated objects | both counters `0`, panels empty |
| table level switched | counters identical across all three levels |

## S6. Settings-mismatch card (FR-005)

- `settings_mismatch` is `true` when objects tripping the event-match gate hold ≥ 50% of
  **active spend** = the window spend of status-gate-passing ad sets (spec Assumptions). Gated
  objects are excluded from both numerator and denominator.
- `true` ⇒ the dashboard renders a warning card at the top, linking to Settings.
- Below the threshold, individual rows are still gated; only the account-level card is withheld.
