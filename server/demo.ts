/**
 * Demo account — deterministic synthetic snapshot that exercises every rule
 * family (K, CB, F, W, S, GATE) so users can explore Qarar before connecting
 * a real Meta account. Numbers are hand-tuned against the rulebook so the
 * expected verdicts are known (also used in engine unit tests).
 *
 * Demo funnel economics (matches the rulebook worked example):
 *   AOV $43, HTO $3,500 @ 3%, Front-End ROAS 1.0
 *   → rawTargetCPA $43, fullBuyerValue $148, maxCPA $74, effectiveCPA $43
 */
import {
  AccountSnapshotPayload,
  DailyMetrics,
  NormalizedObject,
  WindowMetrics,
} from "../shared/qarar";
import { computeSpendShares } from "./meta";

function W(p: Partial<WindowMetrics>): WindowMetrics {
  const base: WindowMetrics = {
    spend: 0, impressions: 0, reach: 0, frequency: 1.2, clicks: 0, linkClicks: 0,
    ctrAll: 0, ctrLink: 0, cpm: 18, cpc: 0, conversions: 0, conversionValue: 0,
    lpViews: 0, cpa: null,
  };
  const w = { ...base, ...p };
  if (w.impressions > 0) {
    if (!p.linkClicks && w.ctrLink) w.linkClicks = Math.round((w.ctrLink / 100) * w.impressions);
    if (!p.clicks && w.ctrAll) w.clicks = Math.round((w.ctrAll / 100) * w.impressions);
    if (!p.cpm) w.cpm = (w.spend / w.impressions) * 1000;
    if (w.linkClicks > 0) w.cpc = w.spend / w.linkClicks;
    if (!p.lpViews) w.lpViews = Math.round(w.linkClicks * 0.85);
  }
  w.cpa = w.conversions > 0 ? w.spend / w.conversions : null;
  return w;
}

function D(date: string, p: Partial<WindowMetrics>): DailyMetrics {
  return { ...W(p), date };
}

function dateStr(off: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - off);
  return d.toISOString().slice(0, 10);
}

export function buildDemoSnapshot(): AccountSnapshotPayload {
  const d6 = dateStr(6), d5 = dateStr(5), d4 = dateStr(4), d3 = dateStr(3),
    d2 = dateStr(2), d1 = dateStr(1), d0 = dateStr(0);

  const objects: NormalizedObject[] = [];

  // ============ Campaign 1: Testing (ABO) — المصنع ============
  objects.push({
    id: "cmp_test", name: "اختبار — Tier 1 الخليج (ABO)", status: "ACTIVE",
    level: "campaign", parentId: null, campaignId: "cmp_test",
    dailyBudget: null, bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    createdTime: dateStr(45), ageDays: 45,
    w3d: W({ spend: 391, impressions: 31000, ctrLink: 1.45, ctrAll: 2.6, conversions: 7 }),
    today: W({ spend: 132, impressions: 9000, ctrLink: 1.3, conversions: 1 }),
    daily7: [], spendSharePct: null,
  });

  // --- Ad set A: K1 case — spend ≥ 2×target ($86), zero conversions
  objects.push({
    id: "as_k1", name: "Stage A — جمهور اهتمام: ريادة أعمال", status: "ACTIVE",
    level: "adset", parentId: "cmp_test", campaignId: "cmp_test",
    dailyBudget: 45, createdTime: dateStr(9), ageDays: 9,
    w3d: W({ spend: 95, impressions: 8200, ctrLink: 0.9, ctrAll: 1.8, conversions: 0 }),
    today: W({ spend: 30, impressions: 2500, ctrLink: 0.8, conversions: 0 }),
    daily7: [
      D(d2, { spend: 32, impressions: 2700, ctrLink: 0.95 }),
      D(d1, { spend: 33, impressions: 2900, ctrLink: 0.9 }),
      D(d0, { spend: 30, impressions: 2600, ctrLink: 0.85 }),
    ],
    spendSharePct: null, learningPhase: true,
  });
  // its ads
  objects.push({
    id: "ad_k3", name: "كريتف #14 — هوك سؤال مباشر", status: "ACTIVE",
    level: "ad", parentId: "as_k1", campaignId: "cmp_test",
    dailyBudget: null, createdTime: dateStr(9), ageDays: 9,
    w3d: W({ spend: 60, impressions: 5200, ctrLink: 0.4, ctrAll: 1.1, conversions: 0 }),
    today: W({ spend: 19, impressions: 1600, ctrLink: 0.38, conversions: 0 }),
    daily7: [
      D(d2, { spend: 20, impressions: 1700, ctrLink: 0.45 }),
      D(d1, { spend: 21, impressions: 1800, ctrLink: 0.4 }),
      D(d0, { spend: 19, impressions: 1700, ctrLink: 0.38 }),
    ],
    spendSharePct: null,
  });
  objects.push({
    id: "ad_k1b", name: "كريتف #15 — ستاتيك ألم", status: "ACTIVE",
    level: "ad", parentId: "as_k1", campaignId: "cmp_test",
    dailyBudget: null, createdTime: dateStr(9), ageDays: 9,
    w3d: W({ spend: 35, impressions: 3000, ctrLink: 1.6, ctrAll: 2.5, conversions: 0 }),
    today: W({ spend: 11, impressions: 900, ctrLink: 1.5, conversions: 0 }),
    daily7: [
      D(d2, { spend: 12, impressions: 1000, ctrLink: 1.7 }),
      D(d1, { spend: 12, impressions: 1050, ctrLink: 1.6 }),
      D(d0, { spend: 11, impressions: 950, ctrLink: 1.55 }),
    ],
    spendSharePct: null,
  });

  // --- Ad set B: healthy + contains flash creative (K4), rescue ad (K5) and strong S1 ad
  objects.push({
    id: "as_good", name: "Stage A — بروود + Advantage", status: "ACTIVE",
    level: "adset", parentId: "cmp_test", campaignId: "cmp_test",
    dailyBudget: 60, createdTime: dateStr(20), ageDays: 20,
    w3d: W({ spend: 180, impressions: 14500, ctrLink: 1.9, ctrAll: 3.1, conversions: 5 }),
    today: W({ spend: 58, impressions: 4600, ctrLink: 1.8, conversions: 2 }),
    daily7: [
      D(d6, { spend: 55, impressions: 4400, ctrLink: 2.0, conversions: 2 }),
      D(d5, { spend: 57, impressions: 4500, ctrLink: 1.95, conversions: 1 }),
      D(d4, { spend: 58, impressions: 4700, ctrLink: 1.9, conversions: 2 }),
      D(d3, { spend: 59, impressions: 4800, ctrLink: 1.92, conversions: 2 }),
      D(d2, { spend: 60, impressions: 4800, ctrLink: 1.9, conversions: 2 }),
      D(d1, { spend: 61, impressions: 4900, ctrLink: 1.88, conversions: 2 }),
      D(d0, { spend: 58, impressions: 4600, ctrLink: 1.8, conversions: 1 }),
    ],
    spendSharePct: null,
  });
  // Flash creative — day-1 peak then ≥50% collapse within 72h (K4), age 3 days
  objects.push({
    id: "ad_flash", name: "كريتف #18 — فيديو UGC خام", status: "ACTIVE",
    level: "ad", parentId: "as_good", campaignId: "cmp_test",
    dailyBudget: null, createdTime: dateStr(3), ageDays: 3,
    w3d: W({ spend: 68, impressions: 5500, ctrLink: 1.6, ctrAll: 2.8, conversions: 2 }),
    today: W({ spend: 18, impressions: 1500, ctrLink: 0.9, conversions: 0 }),
    daily7: [
      D(d2, { spend: 26, impressions: 2100, ctrLink: 2.6, conversions: 2 }),
      D(d1, { spend: 24, impressions: 1900, ctrLink: 1.4, conversions: 0 }),
      D(d0, { spend: 18, impressions: 1500, ctrLink: 0.9, conversions: 0 }),
    ],
    spendSharePct: null,
  });
  // Starved but high-efficiency ad → rescue 🛟 (K5 matrix)
  objects.push({
    id: "ad_rescue", name: "كريتف #11 — شهادة عميلة", status: "ACTIVE",
    level: "ad", parentId: "as_good", campaignId: "cmp_test",
    dailyBudget: null, createdTime: dateStr(8), ageDays: 8,
    w3d: W({ spend: 12, impressions: 1100, ctrLink: 3.4, ctrAll: 4.8, conversions: 1 }),
    today: W({ spend: 4, impressions: 350, ctrLink: 3.2, conversions: 0 }),
    daily7: [
      D(d2, { spend: 4, impressions: 380, ctrLink: 3.5, conversions: 1 }),
      D(d1, { spend: 4, impressions: 370, ctrLink: 3.4 }),
      D(d0, { spend: 4, impressions: 350, ctrLink: 3.2 }),
    ],
    spendSharePct: null,
  });
  // Main workhorse ad — S1 promotion eligible
  objects.push({
    id: "ad_s1", name: "كريتف #9 — وجه مباشر: اعتراض السعر", status: "ACTIVE",
    level: "ad", parentId: "as_good", campaignId: "cmp_test",
    dailyBudget: null, createdTime: dateStr(15), ageDays: 15,
    w3d: W({ spend: 100, impressions: 7900, ctrLink: 2.4, ctrAll: 3.6, conversions: 4 }),
    today: W({ spend: 36, impressions: 2750, ctrLink: 2.3, conversions: 2 }),
    daily7: [
      D(d6, { spend: 30, impressions: 2400, ctrLink: 2.5, conversions: 1 }),
      D(d5, { spend: 31, impressions: 2500, ctrLink: 2.45, conversions: 1 }),
      D(d4, { spend: 32, impressions: 2600, ctrLink: 2.4, conversions: 2 }),
      D(d3, { spend: 33, impressions: 2650, ctrLink: 2.42, conversions: 1 }),
      D(d2, { spend: 32, impressions: 2600, ctrLink: 2.45, conversions: 1 }),
      D(d1, { spend: 32, impressions: 2550, ctrLink: 2.4, conversions: 1 }),
      D(d0, { spend: 36, impressions: 2750, ctrLink: 2.3, conversions: 2 }),
    ],
    spendSharePct: null,
  });

  // --- Ad set C: circuit breaker CB2 — today spend ≥ 2.5×target, 0 conv
  objects.push({
    id: "as_cb", name: "Stage B — جمهور Lookalike 1%", status: "ACTIVE",
    level: "adset", parentId: "cmp_test", campaignId: "cmp_test",
    dailyBudget: 110, createdTime: dateStr(5), ageDays: 5,
    w3d: W({ spend: 116, impressions: 9300, ctrLink: 1.2, ctrAll: 2.0, conversions: 1 }),
    today: W({ spend: 110, impressions: 8800, ctrLink: 1.1, conversions: 0 }),
    daily7: [
      D(d2, { spend: 3, impressions: 250, ctrLink: 1.4 }),
      D(d1, { spend: 3, impressions: 250, ctrLink: 1.3, conversions: 1 }),
      D(d0, { spend: 110, impressions: 8800, ctrLink: 1.1 }),
    ],
    spendSharePct: null, learningPhase: true,
  });
  objects.push({
    id: "ad_cb", name: "كريتف #9 (منسوخ Post ID)", status: "ACTIVE",
    level: "ad", parentId: "as_cb", campaignId: "cmp_test",
    dailyBudget: null, createdTime: dateStr(5), ageDays: 5,
    w3d: W({ spend: 116, impressions: 9300, ctrLink: 1.2, ctrAll: 2.0, conversions: 1 }),
    today: W({ spend: 110, impressions: 8800, ctrLink: 1.1, conversions: 0 }),
    daily7: [
      D(d2, { spend: 3, impressions: 250, ctrLink: 1.4 }),
      D(d1, { spend: 3, impressions: 250, ctrLink: 1.3, conversions: 1 }),
      D(d0, { spend: 110, impressions: 8800, ctrLink: 1.1 }),
    ],
    spendSharePct: null,
  });

  // --- Ad set D: too-early (GATE) — new, tiny spend/impressions
  objects.push({
    id: "as_gate", name: "Stage A — كريتفات الأسبوع الجديدة", status: "ACTIVE",
    level: "adset", parentId: "cmp_test", campaignId: "cmp_test",
    dailyBudget: 45, createdTime: dateStr(1), ageDays: 1,
    w3d: W({ spend: 14, impressions: 1100, ctrLink: 1.5, ctrAll: 2.4, conversions: 0 }),
    today: W({ spend: 14, impressions: 1100, ctrLink: 1.5, conversions: 0 }),
    daily7: [D(d0, { spend: 14, impressions: 1100, ctrLink: 1.5 })],
    spendSharePct: null, learningPhase: true,
  });
  objects.push({
    id: "ad_gate", name: "كريتف #19 — كاروسيل أرقام", status: "ACTIVE",
    level: "ad", parentId: "as_gate", campaignId: "cmp_test",
    dailyBudget: null, createdTime: dateStr(1), ageDays: 1,
    w3d: W({ spend: 14, impressions: 1100, ctrLink: 1.5, ctrAll: 2.4, conversions: 0 }),
    today: W({ spend: 14, impressions: 1100, ctrLink: 1.5, conversions: 0 }),
    daily7: [D(d0, { spend: 14, impressions: 1100, ctrLink: 1.5 })],
    spendSharePct: null,
  });

  // ============ Campaign 2: Scaling (CBO) — التوسيع ============
  objects.push({
    id: "cmp_scale", name: "توسيع — Tier 1 الخليج (CBO)", status: "ACTIVE",
    level: "campaign", parentId: null, campaignId: "cmp_scale",
    dailyBudget: 250, bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    createdTime: dateStr(60), ageDays: 60,
    w3d: W({ spend: 705, impressions: 52000, ctrLink: 1.8, ctrAll: 2.9, conversions: 19 }),
    today: W({ spend: 235, impressions: 17500, ctrLink: 1.75, conversions: 6 }),
    daily7: [], spendSharePct: null,
  });

  // --- Scaling ad set: W1 (CPA between 1×–1.5× target)
  objects.push({
    id: "as_w1", name: "توسيع — الجمهور الرابح + Advantage", status: "ACTIVE",
    level: "adset", parentId: "cmp_scale", campaignId: "cmp_scale",
    dailyBudget: 150, createdTime: dateStr(30), ageDays: 30,
    w3d: W({ spend: 420, impressions: 31000, ctrLink: 1.9, ctrAll: 3.0, conversions: 8 }),
    today: W({ spend: 140, impressions: 10400, ctrLink: 1.85, conversions: 3 }),
    daily7: [
      D(d6, { spend: 138, impressions: 10000, ctrLink: 2.0, conversions: 3 }),
      D(d5, { spend: 139, impressions: 10200, ctrLink: 1.95, conversions: 3 }),
      D(d4, { spend: 140, impressions: 10300, ctrLink: 1.92, conversions: 3 }),
      D(d3, { spend: 141, impressions: 10400, ctrLink: 1.9, conversions: 3 }),
      D(d2, { spend: 140, impressions: 10300, ctrLink: 1.9, conversions: 3 }),
      D(d1, { spend: 140, impressions: 10350, ctrLink: 1.88, conversions: 2 }),
      D(d0, { spend: 140, impressions: 10400, ctrLink: 1.85, conversions: 3 }),
    ],
    spendSharePct: null,
  });
  // Fatigued ad inside scaling (F1): CTR dropped ≥25-30% from 3-day peak, CPM stable
  objects.push({
    id: "ad_fatigue", name: "كريتف #5 — الرابح القديم (21 يوم)", status: "ACTIVE",
    level: "ad", parentId: "as_w1", campaignId: "cmp_scale",
    dailyBudget: null, createdTime: dateStr(21), ageDays: 21,
    w3d: W({ spend: 230, impressions: 17500, ctrLink: 1.5, ctrAll: 2.6, conversions: 4, cpm: 18.2 }),
    today: W({ spend: 76, impressions: 5800, ctrLink: 1.45, conversions: 1, cpm: 18.4 }),
    daily7: [
      D(d6, { spend: 75, impressions: 5600, ctrLink: 2.3, conversions: 2, cpm: 18.0 }),
      D(d5, { spend: 75, impressions: 5650, ctrLink: 2.25, conversions: 2, cpm: 18.1 }),
      D(d4, { spend: 76, impressions: 5700, ctrLink: 2.1, conversions: 2, cpm: 18.0 }),
      D(d3, { spend: 76, impressions: 5750, ctrLink: 1.8, conversions: 1, cpm: 18.2 }),
      D(d2, { spend: 77, impressions: 5800, ctrLink: 1.6, conversions: 1, cpm: 18.1 }),
      D(d1, { spend: 77, impressions: 5850, ctrLink: 1.5, conversions: 2, cpm: 18.3 }),
      D(d0, { spend: 76, impressions: 5800, ctrLink: 1.45, conversions: 1, cpm: 18.4 }),
    ],
    spendSharePct: null,
  });
  // Healthy scaling winner — S4
  objects.push({
    id: "ad_s4", name: "كريتف #7 — الرابح الحالي + variations", status: "ACTIVE",
    level: "ad", parentId: "as_w1", campaignId: "cmp_scale",
    dailyBudget: null, createdTime: dateStr(12), ageDays: 12,
    w3d: W({ spend: 190, impressions: 13500, ctrLink: 2.5, ctrAll: 3.7, conversions: 4 }),
    today: W({ spend: 64, impressions: 4600, ctrLink: 2.45, conversions: 2 }),
    daily7: [
      D(d6, { spend: 62, impressions: 4400, ctrLink: 2.5, conversions: 1 }),
      D(d5, { spend: 63, impressions: 4450, ctrLink: 2.52, conversions: 1 }),
      D(d4, { spend: 63, impressions: 4500, ctrLink: 2.5, conversions: 1 }),
      D(d3, { spend: 64, impressions: 4500, ctrLink: 2.48, conversions: 2 }),
      D(d2, { spend: 63, impressions: 4450, ctrLink: 2.5, conversions: 1 }),
      D(d1, { spend: 63, impressions: 4480, ctrLink: 2.5, conversions: 1 }),
      D(d0, { spend: 64, impressions: 4600, ctrLink: 2.45, conversions: 2 }),
    ],
    spendSharePct: null,
  });

  // --- Scaling ad set 2: W3 — ad innocent, page problem
  objects.push({
    id: "as_w3", name: "توسيع — بروود (مساحة التمدد)", status: "ACTIVE",
    level: "adset", parentId: "cmp_scale", campaignId: "cmp_scale",
    dailyBudget: 100, createdTime: dateStr(25), ageDays: 25,
    w3d: W({ spend: 285, impressions: 21000, ctrLink: 2.6, ctrAll: 4.0, conversions: 2, lpViews: 480 }),
    today: W({ spend: 95, impressions: 7100, ctrLink: 2.5, conversions: 1 }),
    daily7: [
      D(d6, { spend: 94, impressions: 6900, ctrLink: 2.7, conversions: 1 }),
      D(d5, { spend: 95, impressions: 7000, ctrLink: 2.65, conversions: 0 }),
      D(d4, { spend: 95, impressions: 7000, ctrLink: 2.6, conversions: 1 }),
      D(d3, { spend: 95, impressions: 7050, ctrLink: 2.6, conversions: 0 }),
      D(d2, { spend: 95, impressions: 7000, ctrLink: 2.6, conversions: 1 }),
      D(d1, { spend: 95, impressions: 7000, ctrLink: 2.55, conversions: 0 }),
      D(d0, { spend: 95, impressions: 7100, ctrLink: 2.5, conversions: 1 }),
    ],
    spendSharePct: null,
  });
  objects.push({
    id: "ad_w3", name: "كريتف #12 — فيديو قصة تحول", status: "ACTIVE",
    level: "ad", parentId: "as_w3", campaignId: "cmp_scale",
    dailyBudget: null, createdTime: dateStr(10), ageDays: 10,
    w3d: W({ spend: 285, impressions: 21000, ctrLink: 2.6, ctrAll: 4.0, conversions: 2, lpViews: 480 }),
    today: W({ spend: 95, impressions: 7100, ctrLink: 2.5, conversions: 1 }),
    daily7: [
      D(d2, { spend: 95, impressions: 7000, ctrLink: 2.6, conversions: 1 }),
      D(d1, { spend: 95, impressions: 7000, ctrLink: 2.55 }),
      D(d0, { spend: 95, impressions: 7100, ctrLink: 2.5, conversions: 1 }),
    ],
    spendSharePct: null,
  });

  computeSpendShares(objects);

  // ---- enrich for the UI: daily30 history, thumbnails, video (hook/hold) metrics ----
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  };
  for (const o of objects) {
    // deterministic 30-day history that ends with the known daily7 days
    const known = new Map(o.daily7.map(d => [d.date, d]));
    const out: DailyMetrics[] = [];
    const base = o.daily7.length
      ? o.daily7.reduce((s, d) => s + d.spend, 0) / o.daily7.length
      : o.w3d.spend / 3;
    for (let off = 29; off >= 0; off--) {
      const date = dateStr(off);
      if (known.has(date)) {
        out.push(known.get(date)!);
        continue;
      }
      if (off >= o.ageDays) continue; // object didn't exist yet
      const h = hash(o.id + date);
      const wobble = 0.7 + ((h % 60) / 100); // 0.7–1.29
      const spend = Math.round(base * wobble * 100) / 100;
      const imps = Math.round(spend * (50 + (h % 20)));
      const ctr = Math.round((o.w3d.ctrLink || 1.5) * (0.85 + ((h >> 3) % 30) / 100) * 100) / 100;
      const conv = base > 20 ? Math.max(0, Math.round(spend / 45 + (((h >> 5) % 3) - 1))) : 0;
      out.push(D(date, { spend, impressions: imps, ctrLink: ctr, ctrAll: ctr * 1.6, conversions: conv }));
    }
    o.daily30 = out;
    if (o.level === "ad") {
      o.thumbnailUrl = `https://picsum.photos/seed/qarar_${hash(o.id) % 1000}/120/120`;
      const isVideo = o.name.includes("فيديو") || o.name.includes("UGC");
      if (isVideo) {
        for (const w of [o.w3d, o.today]) {
          w.videoViews3s = Math.round(w.impressions * 0.27);
          w.thruplays = Math.round(w.impressions * 0.09);
        }
        for (const d of [...o.daily7, ...o.daily30]) {
          d.videoViews3s = Math.round(d.impressions * 0.27);
          d.thruplays = Math.round(d.impressions * 0.09);
        }
      }
    }
  }

  return {
    accountId: "demo_account",
    currency: "USD",
    fetchedAt: new Date().toISOString(),
    objects,
    baselines: {
      ctrLinkMedian90: 1.7,
      cpmAvg14: 18.0,
      cpaMedian30: 39,
      cpmNow: 18.5,
    },
    attributionStraddle: true,
    isDemo: true,
  };
}

export const DEMO_FUNNEL = {
  archetype: "paid_lto" as const,
  liveComponent: true,
  offerDescription: "تحدي 3 أيام مباشر بسعر $19 مع order bump قوالب جاهزة و upsell جلسة استراتيجية",
  ticketPrice: 19,
  aov: 43,
  htoPrice: 3500,
  htoConversionRate: 3,
  frontEndRoas: 1.0,
  dailyBudget: 150,
  marketCplBenchmark: null,
  arena: "broad" as const,
  bestInterest: "ريادة الأعمال / Online Business",
  geoTiers: ["tier1"],
};
