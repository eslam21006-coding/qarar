# Contract: Unknown is not zero

**Feature**: `015-verdict-accuracy` · Covers FR-026–FR-028 · Rulebook principle 10

Extends `specs/012-appointment-webinar-archetypes/contracts/conversion-measurement.md` §5. That
contract's discriminator is **not** reused — see §U4.

## U1. Parser output (`server/meta.ts` `parseInsightsRow`, line 385)

| Meta payload | `conversionValue` | `resultsUnknown` |
|---|---|---|
| `action_values` absent | `null` | — |
| `action_values` present | its total, including a genuine `0` | — |
| `actions` absent **and** `inline_link_clicks > 0` | per the rows above | `true` |
| `actions` absent **and** `inline_link_clicks === 0` | per the rows above | `false` / absent |
| `actions` present, no purchase or lead entry | per the rows above | `false` / absent |

`inline_link_clicks` is already requested (`INSIGHTS_FIELDS`, `server/meta.ts:50`) and parsed as
`linkClicks` (line 393), declared at `shared/qarar.ts:195`. No new field is fetched.

**Required parser change**: `pickAction()` (`server/meta.ts:376–383`) returns `0` both from
`if (!actions) return 0` and from the exhausted loop, discarding the distinction before it
reaches `WindowMetrics`. The absence test must be made explicitly inside `parseInsightsRow`,
where `row.actions` is still in scope.

## U2. Rule behaviour

| Condition | Rules that stand down | Verdict |
|---|---|---|
| `resultsUnknown === true` | K1 (zero-result kill), K3 (click-through kill), and any rule reading a counted result as zero | ⏳ with a reason naming the missing data |
| `conversionValue === null` | none of the verdict rules — no rule reads it (see below); only the `roas_3d` display goes blank instead of "0.0x" | as before |
| `conversionValue === 0`, array present | none — a real zero | as before |
| `resultsUnknown` false/absent | none — a real zero | as before |

**Return rules (S2, W6) stand down on unknown COUNTS, not on unknown sales value** (owner-approved
2026-10-19, after pass 2). The campaign "return" read by S2, W6 and the W6 "0.0x" fallback — and
the ad-set W6 inside `watchRules` — is `fullRoas = conversions × t.fullBuyerValue / spend`: Meta's
result **count** times the funnel's **configured** buyer value. No verdict rule reads Meta's
`conversionValue`; its only readers are the two `roas_3d` display fields, which render blank when it
is `null`.

So the unknown figure a return rule can actually read is the count, and that is where it stands
down: when `w3d.resultsUnknown` is true, the data-gate position returns `RESULTS_UNKNOWN_FIRED` (⏳
`GATE`, "ميتا لم ترسل عدد النتائج لهذه الفترة رغم وجود نقرات — لا نحكم على رقم لم يصلنا") — in
`gateVerdict` for ad sets and ads, and right after the event-match gate in `evaluateCampaign` —
before S2, W6 or the "0.0x" fallback can be reached (FR-027).

**Why not stand down on `conversionValue === null`**: that reading would disarm S2/W6 on every
account whose campaigns send no `action_values` — most registration-counting accounts — on the
strength of a figure those rules never read. FR-028 targets rules *reading* an unknown figure;
`fullRoas` does not read the value. The "0.0x" seen in the live replay came from a count read as 0
under the wrong funnel type, which the event-match gate (gate-order.md §G3) fixes. T060a locks this:
nulling every `conversionValue` changes no verdict and produces no "0.0x".

## U3. Invariants

- No loss verdict — kill or watch — is ever issued on the basis of a figure Meta did not return.
- **In the other direction**: an object with a consistent genuine zero still receives its
  zero-result verdict. The fix must not disarm K1 (SC-006).
- `?? 0` on `conversionValue`, `leadConversions` or `purchaseConversions` is forbidden.
- The three payload shapes in §U1 each have a test (spec Clarifications, 2026-10-18).

## U4. Why a new field instead of `undefined`

`leadConversions?` and `purchaseConversions?` already reserve `undefined` for a different
meaning — "snapshot captured before the spec-012 lead/purchase separation; the unit is unknown"
— documented in `shared/qarar.ts` and formalised in spec 012's
`conversion-measurement.md` §5. Overloading it would conflate a pre-migration snapshot with a
live incomplete payload. Those two states need different copy, and only the former is a
historical artefact that self-clears. See research.md R1.

## U5. Snapshot compatibility

`snapshots.payload` is an untyped JSON column with no version marker, so rows cached before this
feature carry `conversionValue: 0` where the new code would write `null`, and carry no
`resultsUnknown` flag.

**Policy** (identical to spec 012 §5): the first refresh after deploy writes the new shape.
**No back-fill.** Until an account refreshes, a stale row whose value was genuinely absent still
reads as `0`, so W6 can still produce "0.0x" on that row. This is a bounded, documented gap.

**Type propagation**: `DailyMetrics extends WindowMetrics`, so both changes reach every
`daily7[]` and `daily30[]` entry as well as `w3d` and `today`. Every reader of `conversionValue`
— including the display-only date-range aggregation — must be audited for null handling.
