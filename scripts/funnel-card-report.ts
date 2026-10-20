/**
 * Spec 016 / T008 — prints, per fixture in `server/fixtures016.ts`, the
 * account funnel card and every campaign's verdict and rule, as JSON.
 *
 *   pnpm exec tsx scripts/funnel-card-report.ts > out.json
 *
 * Run on `main@a855599` to produce the baseline
 * (`specs/016-judgment-model/funnel-card-main.json`), and on this branch to
 * diff against it (FR-021a part 2).
 */
import { runEngine } from "../server/engine";
import { FIXTURES016 } from "../server/fixtures016";

const report: Record<string, unknown> = {};
for (const f of FIXTURES016) {
  const result = runEngine(f.build(), f.funnel);
  report[f.name] = {
    account_funnel_cta: result.summary.account_funnel_cta,
    campaigns: result.rows
      .filter(r => r.level === "campaign")
      .map(r => ({ id: r.id, verdict: r.verdict, rule: r.rule })),
  };
}
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
