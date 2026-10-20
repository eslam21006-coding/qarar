# Contract: Verdict/diagnosis consistency guard (R3)

Covers FR-019–FR-021a. Decision: research.md D7. FR-019 is answered: **015 did not implement it**
(research.md §1.2 item 5).

## G1. Placement

In `runEngine`, inside the ad loop and the ad-set loop, immediately after `diagnose()` and before
`toRow`. Never in the campaign loop. Because ads and ad sets are evaluated before campaigns, the
derivation (campaign-derivation.md C2) reads guarded verdicts.

## G2. Rule

```
if fired.verdict === "kill"
   and fired.rule ∉ { "K3", "CB1", "CB2" }
   and findings.some(f => f.outcome === "INSUFFICIENT_DATA")
then fired := {
  verdict: "too_early",
  rule:    "GATE",
  reason:  first INSUFFICIENT_DATA finding's text_ar,
  action:  "اترك البيانات تتجمع",
}
```

Findings stay on the row. `watch`, `continue` and `rescue` are never changed (owner decision Q1: B).

## G3. Campaign rows

Derived campaigns: row `findings: []`, never guarded. Their combined diagnosis
(campaign-derivation.md C7a) feeds only the funnel card and does not trigger the guard.
Campaigns exiting at steps 1–4 or W5: diagnosed exactly as today.

## G4. Tests

1. 🔴 K1 ad set with an INSUFFICIENT_DATA finding → ⏳ GATE, reason = finding text.
2. 🔴 K3 ad, 🔴 CB1/CB2 ad set with an INSUFFICIENT_DATA finding → unchanged (one test each).
3. 🟡, 🟢, 🛟 rows with an INSUFFICIENT_DATA finding → verdict, rule, reason, action unchanged.
4. Every-fixture sweep: zero rows with `kill` + INSUFFICIENT_DATA outside K3/CB1/CB2 (SC-005).
5. FR-021a tests live in campaign-derivation.md C8 (5–7).
