import { describe, expect, it } from "vitest";
import { countedResults, type AccountSnapshotPayload, type EngineRow } from "../../../shared/qarar";
import { runEngine } from "../../../server/engine";
import { FIXTURES016 } from "../../../server/fixtures016";
import { sumChildDailyByDate } from "../../../server/seriesChildrenSum";
import { cpaCell, resultsCell } from "../lib/cellFormat";
import { aggregate, type SeriesObj } from "./DecisionTable";

// Spec 016 / T027 (FR-018, SC-002, SC-003; contract single-source-numbers.md
// §N6) — the numbers the table shows are the numbers the verdict used, for
// every fixture and every range.

/** The dashboard's series, built the way `dashboard.get` builds it. */
function seriesOf(snap: AccountSnapshotPayload): Map<string, SeriesObj> {
  const m = new Map<string, SeriesObj>();
  for (const o of snap.objects) {
    const own = o.daily30 && o.daily30.length > 0 ? o.daily30 : o.daily7 && o.daily7.length > 0 ? o.daily7 : null;
    const children = snap.objects.filter(c =>
      o.level === "campaign" ? c.level === "adset" && c.campaignId === o.id : c.parentId === o.id
    );
    m.set(o.id, {
      id: o.id,
      level: o.level,
      parentId: o.parentId,
      status: o.status,
      effectiveStatus: o.effectiveStatus ?? null,
      thumbnailUrl: o.thumbnailUrl ?? null,
      today: o.today,
      w3d: o.w3d,
      daily30: own ?? sumChildDailyByDate(children),
    });
  }
  return m;
}

const RANGES = ["3d", "today", "7d", "14d", "30d", "custom"] as const;
const NO_RESULT = "بدون أي نتيجة";

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

for (const fx of FIXTURES016) {
  describe(`invariants — ${fx.name}`, () => {
    const snap = fx.build();
    const result = runEngine(snap, fx.funnel);
    const series = seriesOf(snap);
    const asOf = snap.asOfDate;
    const from = shiftDate(asOf, -10);
    const to = shiftDate(asOf, -1);
    const shown = (r: EngineRow, range: (typeof RANGES)[number]) => {
      const a = aggregate(series.get(r.id), range, from, to, asOf, undefined, result.archetype);
      // The table reads the engine row in 3d (FR-018).
      return range === "3d"
        ? { results: r.conversions_3d, cpa: r.cpa_3d }
        : { results: a?.results ?? null, cpa: a?.cpa ?? null };
    };

    it("N6.1 — results > 0 ⇒ a cost is shown, in every range", () => {
      for (const r of result.rows) {
        for (const range of RANGES) {
          const { results, cpa } = shown(r, range);
          if (results !== null && results > 0) {
            expect(cpa, `${r.id} ${range}`).not.toBeNull();
            const cell = cpaCell({ verdict: r.verdict, results, cpa, target: result.targets.unitTarget });
            expect(["—", "؟"], `${r.id} ${range}`).not.toContain(cell.value);
          }
        }
      }
    });

    it("N6.2 — 3d results and cost equal the engine row's", () => {
      for (const r of result.rows) {
        const a = aggregate(series.get(r.id), "3d", from, to, asOf, undefined, result.archetype)!;
        expect(a.results, r.id).toBe(r.conversions_3d);
        expect(a.cpa === null ? null : Math.round(a.cpa * 100) / 100, r.id).toBe(r.cpa_3d);
      }
    });

    it("N6.3 — no reason says 'بدون أي نتيجة' when the results of the window it names are > 0", () => {
      for (const r of result.rows) {
        if (!r.reason_ar.includes(NO_RESULT)) continue;
        // A reason that names today ("اليوم:", the circuit breaker) speaks
        // about today's results; every other reason speaks about the 3-day
        // window shown by default.
        const results = r.reason_ar.startsWith("اليوم:") ? shown(r, "today").results : r.conversions_3d;
        expect(results ?? 0, r.id).toBe(0);
      }
    });

    it("N6.4 — an unknown count never renders as 0", () => {
      for (const o of snap.objects) {
        const r = result.rows.find(x => x.id === o.id)!;
        if (countedResults(o.w3d, result.archetype) === null) {
          expect(r.conversions_3d, o.id).toBeNull();
          expect(resultsCell(r.conversions_3d).value, o.id).toBe("؟");
        }
        for (const range of RANGES) {
          const { results } = shown(r, range);
          if (results === null) expect(resultsCell(results).value, `${o.id} ${range}`).toBe("؟");
        }
      }
    });
  });
}
