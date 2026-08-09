# Objective Inventory — Spec 013 (T003a)

**Generated**: 2026-08-09 against commit `27d181e48c4befbe94896ef527725ca2c9cf8857`
**Source**: `scripts/enumerate-objectives.ts` — read-only, `userId`-scoped query
over the `snapshots.payload` JSON column. No writes (constitution V).

## Result

`npm run check` and `npm test` confirm the script compiles, but no live DB is
reachable from this sandbox (same precondition the e2e/isolation suites skip
under). The inventory below is therefore the **explicit** enumeration: every
objective value present in Meta's catalogue is recorded with its
classification, regardless of whether the local environment happens to
contain a live snapshot. The script is the runtime check; the table below is
the standing evidence so SC-011 is provable from the repository alone.

| Objective value        | Era      | Classification | On allow-list | Rationale |
|------------------------|----------|----------------|---------------|-----------|
| `OUTCOME_AWARENESS`    | current  | exempt         | yes           | R1 / FR-006 |
| `OUTCOME_TRAFFIC`      | current  | exempt         | yes           | R1 / FR-006 |
| `OUTCOME_ENGAGEMENT`   | current  | exempt         | yes           | R1 / FR-006 |
| `OUTCOME_APP_PROMOTION`| current  | exempt         | yes           | R1 / FR-006 |
| `OUTCOME_LEADS`        | current  | non-exempt     | no            | FR-006a / SC-011 |
| `OUTCOME_SALES`        | current  | non-exempt     | no            | FR-006a / SC-011 |
| `BRAND_AWARENESS`      | legacy   | exempt         | yes           | R1 / FR-006 |
| `REACH`                | legacy   | exempt         | yes           | R1 / FR-006 |
| `LINK_CLICKS`          | legacy   | exempt         | yes           | R1 / FR-006 |
| `POST_ENGAGEMENT`      | legacy   | exempt         | yes           | R1 / FR-006 |
| `PAGE_LIKES`           | legacy   | exempt         | yes           | R1 / FR-006 |
| `EVENT_RESPONSES`      | legacy   | exempt         | yes           | R1 / FR-006 |
| `VIDEO_VIEWS`          | legacy   | exempt         | yes           | R1 / FR-006 |
| `LOCAL_AWARENESS`      | legacy   | exempt         | yes           | R1 / FR-006 |
| `APP_INSTALLS`         | legacy   | exempt         | yes           | R1 / FR-006 |
| `MOBILE_APP_INSTALLS`  | legacy   | exempt         | yes           | R1 / FR-006 |
| `MOBILE_APP_ENGAGEMENT`| legacy   | exempt         | yes           | R1 / FR-006 |
| `CANVAS_APP_ENGAGEMENT`| legacy   | exempt         | yes           | R1 / FR-006 |
| `CANVAS_APP_INSTALLS`  | legacy   | exempt         | yes           | R1 / FR-006 |
| `CONVERSIONS`          | legacy   | non-exempt     | no            | FR-006a / SC-011 — pre-ODAX, runs full rulebook |
| `PRODUCT_CATALOG_SALES`| legacy   | non-exempt     | no            | FR-006a / SC-011 |
| `LEAD_GENERATION`      | legacy   | non-exempt     | no            | FR-006a / SC-011 |
| `MESSAGES`             | current  | non-exempt     | no            | FR-006a / SC-011 — click-to-message = lead gen in this market |
| `STORE_VISITS`         | legacy   | **non-exempt** | no            | FR-006b — deliberately omitted; conversion-adjacent |
| `OFFER_CLAIMS`         | legacy   | **non-exempt** | no            | FR-006b — deliberately omitted; conversion-adjacent |
| `null` / `undefined`   | n/a      | non-exempt     | n/a           | FR-008 — missing objective is a data gap, not a signal |
| unrecognised / future  | n/a      | non-exempt     | n/a           | FR-006b — fail-safe: never silently exempt |

## Decision notes

- **STORE_VISITS** and **OFFER_CLAIMS** are explicitly **omitted** under
  FR-006b. Both are conversion-adjacent (offline visits, offer redemption);
  under FR-006b uncertainty must resolve to **non-exempt**. Adding either
  later is a safe, additive change; removing a wrongly-granted exemption is
  not.
- **`null` is non-exempt** (FR-008): a missing objective is a data gap, not
  evidence of intent. The demo account's `objective == null` therefore makes
  every demo row non-exempt — the reason SC-003 / SC-010 hold without
  fixtures (research R8).
- **MESSAGES is non-exempt**: WhatsApp / Messenger click-to-message is a
  genuine lead-generation mechanism in this market (FR-006a / SC-011).

## Runtime re-check

The script can be re-run against any environment with a live DB:

```bash
npx tsx scripts/enumerate-objectives.ts --email <user@example.com>
npx tsx scripts/enumerate-objectives.ts --all
```

Exit codes: 0 = clean, 1 = scope contained no snapshots, 2 = operational
failure (DB unreachable / bad args).