# Contract: Diagnosis Engine Output

**Surface**: server-internal (`server/engine.ts`) consumed by the client via
`dashboard.get`. Deterministic, rule-coded, no AI (constitution I/VII).

## `diagnose(o, baselines, archetype) → Finding[]`

Replaces `diagnosisLadder(...) → string`. Evaluates **every** journey rung; pushes a
`Finding` for each broken one; marks the first pushed `primary: true`.

```ts
interface Finding {
  step: 1 | 2 | 3 | 4 | 5 | 6;   // 1 CPM · 2 link-CTR/hook · 3 click-to-page · 4 LP-view-rate · 5 page-CVR · 6 post-sale
  text_ar: string;
  primary: boolean;
  ctaUrl?: string;               // exactly "https://eslamsalah.com/team-discovery-call" on steps 5/6 & W5
  rule?: RuleCode;
}
```

**Guarantees**:
- `findings.length === 0` ⇒ no broken steps (e.g. healthy or paused object).
- `findings.length >= 1` ⇒ **exactly one** finding has `primary === true` (the first broken rung).
- Findings are ordered by `step` ascending.
- The account-wide CPM finding is **NOT** emitted here (moved to `AccountSummary.account_alert`).
- Any finding with `ctaUrl` set uses the exact discovery-call URL.
- Verdict/rule/reason/action for the object are **unchanged** vs. the pre-refactor engine.

## `EngineRow` change

`diagnosis: string | null` → `findings: Finding[]`. New `objective: string | null`.
`impressions_3d` surfaced as a selectable column.

## `AccountSummary` additions

```ts
account_alert: { kind: "cpm_market"; reason_ar: string; cpmNow: number; cpmAvg14: number; deltaPct: number } | null;
account_funnel_cta: { reason_ar: string; ctaUrl: string } | null;
cadence: { daysSinceLastAd: number | null; level: "ok" | "reminder" | "stall"; message_ar: string };
```

**Set/clear rules**:
| Field | Set when | Cleared (null) when |
|-------|----------|---------------------|
| `account_alert` | `cpmAvg14 && cpmNow && cpmNow > 1.3×cpmAvg14` | baseline missing or threshold not met |
| `account_funnel_cta` | any row step-5/6 finding OR campaign W5 fired | no offer/funnel pattern anywhere |
| `cadence.level` | `>14`→stall, `>7&&≤14`→reminder, `≤7`→ok, `null`→ok+unknown msg | n/a (always present) |

## Verification

- Account-CPM banner data appears once at summary level, never per row.
- A row failing CTR and page-CVR returns two findings (primary = CTR, secondary = CVR).
- A "good CTR + good LP views + weak CVR" ad yields a step-5 finding **with** `ctaUrl`.
- A campaign `htoUnderperforming=true` + good LTO CPA yields W5 and sets `account_funnel_cta`.
- Existing engine test suite green except tests asserting the old `diagnosis` string shape.
