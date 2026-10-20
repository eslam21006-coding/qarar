/**
 * Spec 016 / T008 — the shared fixture set for the funnel-card change log
 * (FR-021a part 2) and the table invariants (FR-018, T027).
 *
 * Built only from the demo builder and literals, so the same file runs
 * unchanged against `main@a855599` (that is how the main baseline in
 * `specs/016-judgment-model/funnel-card-main.json` is produced).
 */
import type { AccountSnapshotPayload, FunnelInputs, NormalizedObject } from "../shared/qarar";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";

export interface Fixture016 {
  name: string;
  build: () => AccountSnapshotPayload;
  funnel: FunnelInputs;
}

type Archetype = FunnelInputs["archetype"];

function funnelOf(archetype: Archetype, hto: boolean): FunnelInputs {
  return { ...(DEMO_FUNNEL as FunnelInputs), archetype, htoUnderperforming: hto };
}

function edit(snap: AccountSnapshotPayload, id: string, fn: (o: NormalizedObject) => void) {
  const o = snap.objects.find(x => x.id === id);
  if (!o) throw new Error(`fixtures016: no object ${id}`);
  fn(o);
}

/**
 * Meta sent no result count for the 3-day window of one CBO ad set and its
 * ad (no actions array, clicks present): the count is unknown, not zero.
 */
function buildUnknownCount(): AccountSnapshotPayload {
  const snap = buildDemoSnapshot();
  for (const id of ["as_w3", "ad_w3"]) {
    edit(snap, id, o => {
      o.w3d = {
        ...o.w3d,
        conversions: 0,
        leadConversions: 0,
        purchaseConversions: 0,
        conversionValue: null,
        cpa: null,
        resultsUnknown: true,
      };
    });
  }
  return snap;
}

/**
 * The counted family and the other family disagree. One ABO ad set (and its
 * ads) records leads but no purchases over 3 days; another records leads but
 * no purchases today, with spend 3× the $43 demo target (the R4 case).
 */
function buildSplitFamily(): AccountSnapshotPayload {
  const snap = buildDemoSnapshot();
  for (const id of ["as_good", "ad_flash", "ad_rescue", "ad_s1"]) {
    edit(snap, id, o => {
      o.w3d = { ...o.w3d, leadConversions: o.w3d.conversions, purchaseConversions: 0 };
    });
  }
  edit(snap, "as_cb", o => {
    o.today = {
      ...o.today,
      spend: 129,
      conversions: 0,
      purchaseConversions: 0,
      leadConversions: 5,
    };
  });
  return snap;
}

const ARCHETYPES: Archetype[] = ["paid_lto", "free_lead", "appointment", "webinar"];

export const FIXTURES016: Fixture016[] = [
  ...ARCHETYPES.flatMap(a =>
    [false, true].map(hto => ({
      name: `demo/${a}/hto-${hto ? "on" : "off"}`,
      build: buildDemoSnapshot,
      funnel: funnelOf(a, hto),
    }))
  ),
  ...[false, true].map(hto => ({
    name: `unknown-count/paid_lto/hto-${hto ? "on" : "off"}`,
    build: buildUnknownCount,
    funnel: funnelOf("paid_lto", hto),
  })),
  ...[false, true].map(hto => ({
    name: `split-family/paid_lto/hto-${hto ? "on" : "off"}`,
    build: buildSplitFamily,
    funnel: funnelOf("paid_lto", hto),
  })),
];
