/**
 * Meta Marketing API client.
 * All calls are server-side with the user's own token. Reads insights data,
 * and — with explicit user confirmation in the UI — can pause/resume a
 * campaign, ad set, or ad (the ONLY write operation, via setObjectStatus).
 */
import {
  AccountSnapshotPayload,
  Baselines,
  DailyMetrics,
  NormalizedObject,
  WindowMetrics,
  median,
  ATTRIBUTION_CHANGE_DATE,
} from "../shared/qarar";

const GRAPH = "https://graph.facebook.com/v23.0";

export const META_APP_ID = () => process.env.FACEBOOK_APP_ID ?? "";
export const META_APP_SECRET = () => process.env.FACEBOOK_APP_SECRET ?? "";

export const INSIGHTS_FIELDS =
  "impressions,reach,frequency,clicks,inline_link_clicks,ctr,inline_link_click_ctr,spend,cpm,cpc,actions,action_values,cost_per_action_type,video_thruplay_watched_actions,date_start,date_stop";

// ---------- OAuth ----------

export function buildOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: META_APP_ID(),
    redirect_uri: redirectUri,
    state,
    scope: "ads_read,ads_management",
    response_type: "code",
  });
  return `https://www.facebook.com/v23.0/dialog/oauth?${params.toString()}`;
}

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params);
  const url = `${GRAPH}${path}?${qs.toString()}`;
  let lastErr: any = null;
  // Up to 3 attempts: Meta returns transient "unknown error" (code 1/2) on heavy queries
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    const res = await fetch(url);
    const json: any = await res.json().catch(() => ({}));
    if (res.ok && !json.error) return json;
    const err = json.error || {};
    const e: any = new Error(err.message || `Meta API error ${res.status}`);
    e.metaCode = err.code;
    e.metaType = err.type;
    e.isAuthError = err.code === 190 || err.type === "OAuthException";
    e.isRateLimit = err.code === 17 || err.code === 4 || err.code === 32 || err.code === 613;
    e.isTransient = err.code === 1 || err.code === 2 || err.is_transient === true;
    lastErr = e;
    if (!e.isTransient) throw e;
  }
  throw lastErr;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresIn: number | null }> {
  const json = await graphGet("/oauth/access_token", {
    client_id: META_APP_ID(),
    client_secret: META_APP_SECRET(),
    redirect_uri: redirectUri,
    code,
  });
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? null };
}

export async function exchangeForLongLivedToken(
  shortToken: string
): Promise<{ accessToken: string; expiresIn: number | null }> {
  const json = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID(),
    client_secret: META_APP_SECRET(),
    fb_exchange_token: shortToken,
  });
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? null };
}

export async function fetchMe(token: string): Promise<{ id: string; name: string }> {
  return graphGet("/me", { fields: "id,name", access_token: token });
}

export async function fetchAdAccounts(
  token: string
): Promise<Array<{ accountId: string; name: string; currency: string; accountStatus: number }>> {
  const out: any[] = [];
  let url: string | null = `/me/adaccounts`;
  let params: Record<string, string> = {
    fields: "id,account_id,name,currency,account_status",
    limit: "100",
    access_token: token,
  };
  // paginate (max 5 pages safety)
  for (let i = 0; i < 5 && url; i++) {
    const json: any = await graphGet(url, params);
    for (const a of json.data ?? []) {
      out.push({
        accountId: a.id, // act_XXXX
        name: a.name ?? a.id,
        currency: a.currency ?? "USD",
        accountStatus: a.account_status ?? 1,
      });
    }
    const next = json.paging?.next as string | undefined;
    if (next) {
      const u = new URL(next);
      url = u.pathname.replace(/^\/v\d+\.\d+/, "");
      params = Object.fromEntries(u.searchParams.entries());
    } else {
      url = null;
    }
  }
  return out;
}

/**
 * Pause or resume a campaign / ad set / ad.
 * The single write operation in the app — always behind a user confirmation
 * dialog in the UI and an ownership check in the router.
 */
export async function setObjectStatus(
  token: string,
  objectId: string,
  status: "PAUSED" | "ACTIVE"
): Promise<void> {
  const body = new URLSearchParams({ status, access_token: token });
  const res = await fetch(`${GRAPH}/${objectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const err = json.error || {};
    const e: any = new Error(err.message || `Meta API error ${res.status}`);
    e.isAuthError = err.code === 190 || err.type === "OAuthException";
    e.needsPermission = err.code === 200 || err.code === 10;
    throw e;
  }
}

/**
 * US13 — update the daily_budget on a campaign / ad set.
 * Meta stores budgets in minor units (cents). The caller passes the value
 * already rounded to minor units; do not re-multiply.
 */
export async function setDailyBudget(
  token: string,
  objectId: string,
  newBudgetMinorUnits: number
): Promise<void> {
  const body = new URLSearchParams({
    daily_budget: String(Math.round(newBudgetMinorUnits)),
    access_token: token,
  });
  const res = await fetch(`${GRAPH}/${objectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const err = json.error || {};
    const e: any = new Error(err.message || `Meta API error ${res.status}`);
    e.isAuthError = err.code === 190 || err.type === "OAuthException";
    e.needsPermission = err.code === 200 || err.code === 10;
    // Meta code 4 is "Application request limit reached" (a rate limit), not a
    // minimum-budget violation — keep it out of belowMinimum so routers map it
    // to TOO_MANY_REQUESTS instead of BUDGET_BELOW_MINIMUM (checked first).
    e.belowMinimum = err.error_subcode === 1885994;
    e.isRateLimit = err.code === 17 || err.code === 4 || err.code === 32 || err.error_subcode === 2443279;
    throw e;
  }
}

/** Revoke the app's permissions for this user (disconnect). */
export async function revokeToken(token: string): Promise<void> {
  try {
    const qs = new URLSearchParams({ access_token: token });
    await fetch(`${GRAPH}/me/permissions?${qs.toString()}`, { method: "DELETE" });
  } catch {
    // best effort — data deletion proceeds regardless
  }
}

// ---------- Insights fetching ----------

function emptyWindow(): WindowMetrics {
  return {
    spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, linkClicks: 0,
    ctrAll: 0, ctrLink: 0, cpm: 0, cpc: 0, conversions: 0, conversionValue: 0,
    lpViews: 0, cpa: null, videoViews3s: 0, thruplays: 0,
  };
}

const CONVERSION_ACTION_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "lead",
  "offsite_conversion.fb_pixel_lead",
];

function pickAction(actions: any[] | undefined, types: string[]): number {
  if (!actions) return 0;
  for (const t of types) {
    const hit = actions.find((a: any) => a.action_type === t);
    if (hit) return parseFloat(hit.value) || 0;
  }
  return 0;
}

export function parseInsightsRow(row: any): WindowMetrics {
  const w = emptyWindow();
  if (!row) return w;
  w.spend = parseFloat(row.spend) || 0;
  w.impressions = parseInt(row.impressions) || 0;
  w.reach = parseInt(row.reach) || 0;
  w.frequency = parseFloat(row.frequency) || 0;
  w.clicks = parseInt(row.clicks) || 0;
  w.linkClicks = parseInt(row.inline_link_clicks) || 0;
  w.ctrAll = parseFloat(row.ctr) || 0;
  w.ctrLink = parseFloat(row.inline_link_click_ctr) || 0;
  w.cpm = parseFloat(row.cpm) || 0;
  w.cpc = parseFloat(row.cpc) || 0;
  w.conversions = pickAction(row.actions, CONVERSION_ACTION_TYPES);
  w.lpViews = pickAction(row.actions, ["landing_page_view"]);
  w.conversionValue = pickAction(row.action_values, CONVERSION_ACTION_TYPES);
  w.videoViews3s = pickAction(row.actions, ["video_view"]);
  w.thruplays = pickAction(row.video_thruplay_watched_actions, ["video_view"]);
  w.cpa = w.conversions > 0 ? w.spend / w.conversions : null;
  return w;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return fmtDate(d);
}

/**
 * Fetch all objects of a level with their insights via account-level insights
 * call (1 request per window for the whole level — rate-limit friendly).
 */
async function fetchLevelInsights(
  token: string,
  accountId: string,
  level: "campaign" | "adset" | "ad",
  timeParams: Record<string, string>
): Promise<Map<string, any[]>> {
  const idField = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id";
  const byId = new Map<string, any[]>();
  const params: Record<string, string> = {
    level,
    // The id field MUST be requested explicitly, otherwise rows cannot be
    // matched back to objects and every metric reads as zero.
    fields: `${idField},${INSIGHTS_FIELDS}`,
    limit: "500",
    access_token: token,
    ...timeParams,
  };
  let rows: any[];
  try {
    rows = await graphGetAll(`/${accountId}/insights`, params, 20);
  } catch (e: any) {
    // Large accounts / heavy queries: fall back to Meta's async insights job
    if (
      e.isRateLimit ||
      e.isTransient ||
      /reduce the amount of data|too large|unknown error/i.test(e.message ?? "")
    ) {
      const { access_token: _t, limit: _l, ...asyncParams } = params;
      rows = await fetchInsightsAsync(token, accountId, asyncParams);
    } else {
      throw e;
    }
  }
  for (const row of rows) {
    const id = row[idField];
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(row);
  }
  return byId;
}

/** Generic Graph paginator — follows paging.next up to maxPages. */
async function graphGetAll(
  path: string,
  params: Record<string, string>,
  maxPages = 20
): Promise<any[]> {
  const out: any[] = [];
  let curPath: string | null = path;
  let curParams = params;
  for (let i = 0; i < maxPages && curPath; i++) {
    const json: any = await graphGet(curPath, curParams);
    out.push(...(json.data ?? []));
    const next = json.paging?.next as string | undefined;
    if (next) {
      const u = new URL(next);
      curPath = u.pathname.replace(/^\/v\d+\.\d+/, "");
      curParams = Object.fromEntries(u.searchParams.entries());
    } else {
      curPath = null;
    }
  }
  return out;
}

async function fetchHierarchy(token: string, accountId: string) {
  const campaigns = await graphGetAll(`/${accountId}/campaigns`, {
    fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,created_time",
    limit: "200",
    access_token: token,
  });
  const adsets = await graphGetAll(`/${accountId}/adsets`, {
    fields: "id,name,status,effective_status,daily_budget,campaign_id,created_time,learning_stage_info",
    limit: "500",
    access_token: token,
  });
  const ads = await graphGetAll(`/${accountId}/ads`, {
    fields: "id,name,status,effective_status,adset_id,campaign_id,created_time,creative{thumbnail_url,image_url}",
    limit: "500",
    access_token: token,
  });
  return { campaigns, adsets, ads };
}

// ---------- Async insights (large accounts / rate-limit fallback) ----------

/**
 * Start an async insights report (POST /{accountId}/insights → report_run_id),
 * poll until completion, then page through the results. This POST creates a
 * report only — it never modifies the ad account (the app stays read-only).
 */
async function fetchInsightsAsync(
  token: string,
  accountId: string,
  params: Record<string, string>,
  timeoutMs = 120000
): Promise<any[]> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const startRes = await fetch(`${GRAPH}/${accountId}/insights`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const startJson: any = await startRes.json().catch(() => ({}));
  const reportId = startJson.report_run_id;
  if (!reportId) {
    throw new Error(startJson.error?.message || "Failed to start async insights job");
  }
  const deadline = Date.now() + timeoutMs;
  // poll job status
  for (;;) {
    if (Date.now() > deadline) throw new Error("Async insights job timed out");
    const status = await graphGet(`/${reportId}`, { access_token: token });
    if (status.async_status === "Job Completed") break;
    if (status.async_status === "Job Failed" || status.async_status === "Job Skipped") {
      throw new Error(`Async insights job ${status.async_status}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return graphGetAll(`/${reportId}/insights`, { limit: "500", access_token: token }, 40);
}

function ageDaysFrom(createdTime: string | undefined | null): number {
  if (!createdTime) return 999;
  const created = new Date(createdTime).getTime();
  return Math.max(0, (Date.now() - created) / 86400000);
}

/**
 * Build the complete normalized snapshot for an ad account.
 * Windows: 3-day rolling, today, last_7d daily; baselines: 90d median Link CTR,
 * 14d avg CPM, 30d median CPA.
 */
export async function buildSnapshot(
  token: string,
  accountId: string,
  currency: string
): Promise<AccountSnapshotPayload> {
  const threeDay = {
    time_range: JSON.stringify({ since: daysAgo(2), until: daysAgo(0) }),
  };
  const today = { date_preset: "today" };
  // last 30 days daily — powers both daily7 (engine) and the date-range selector (display)
  const last30daily = { date_preset: "last_30d", time_increment: "1" };

  const { campaigns, adsets, ads } = await fetchHierarchy(token, accountId);

  const levels: Array<"campaign" | "adset" | "ad"> = ["campaign", "adset", "ad"];
  const w3dMaps = new Map<string, Map<string, any[]>>();
  const todayMaps = new Map<string, Map<string, any[]>>();
  const dailyMaps = new Map<string, Map<string, any[]>>();
  for (const lvl of levels) {
    w3dMaps.set(lvl, await fetchLevelInsights(token, accountId, lvl, threeDay));
    todayMaps.set(lvl, await fetchLevelInsights(token, accountId, lvl, today));
    dailyMaps.set(lvl, await fetchLevelInsights(token, accountId, lvl, last30daily));
  }

  // Baselines
  const baselines = await fetchBaselines(token, accountId);

  // Relevance filter: keep objects that are currently delivering OR had any
  // delivery in the last 30 days. Mature accounts hold thousands of long-dead
  // paused objects that would drown the decision table in noise.
  const hadDelivery = (lvl: "campaign" | "adset" | "ad", id: string) =>
    (dailyMaps.get(lvl)!.get(id)?.length ?? 0) > 0 ||
    (w3dMaps.get(lvl)!.get(id)?.length ?? 0) > 0 ||
    (todayMaps.get(lvl)!.get(id)?.length ?? 0) > 0;
  const isRelevant = (lvl: "campaign" | "adset" | "ad", o: any) =>
    o.effective_status === "ACTIVE" || hadDelivery(lvl, o.id);

  const keptCampaignIds = new Set(
    campaigns.filter((c: any) => isRelevant("campaign", c)).map((c: any) => c.id)
  );
  const filteredCampaigns = campaigns.filter((c: any) => keptCampaignIds.has(c.id));
  const filteredAdsets = adsets.filter(
    (s: any) => keptCampaignIds.has(s.campaign_id) && isRelevant("adset", s)
  );
  const keptAdsetIds = new Set(filteredAdsets.map((s: any) => s.id));
  const filteredAds = ads.filter(
    (a: any) => keptAdsetIds.has(a.adset_id) && isRelevant("ad", a)
  );

  const objects: NormalizedObject[] = [];

  const toDaily = (rows: any[] | undefined): DailyMetrics[] =>
    (rows ?? [])
      .map(r => ({ ...parseInsightsRow(r), date: r.date_start as string }))
      .sort((a, b) => a.date.localeCompare(b.date));

  const last7 = (rows: DailyMetrics[]): DailyMetrics[] => rows.slice(-7);

  const firstRow = (rows: any[] | undefined) => (rows && rows.length ? rows[0] : null);

  for (const c of filteredCampaigns) {
    objects.push({
      id: c.id,
      name: c.name,
      status: c.status,
      level: "campaign",
      parentId: null,
      campaignId: c.id,
      dailyBudget: c.daily_budget ? parseInt(c.daily_budget) / 100 : null,
      bidStrategy: c.bid_strategy ?? null,
      objective: c.objective ?? null,
      createdTime: c.created_time ?? null,
      ageDays: ageDaysFrom(c.created_time),
      w3d: parseInsightsRow(firstRow(w3dMaps.get("campaign")!.get(c.id))),
      today: parseInsightsRow(firstRow(todayMaps.get("campaign")!.get(c.id))),
      daily7: last7(toDaily(dailyMaps.get("campaign")!.get(c.id))),
      daily30: toDaily(dailyMaps.get("campaign")!.get(c.id)),
      spendSharePct: null,
      effectiveStatus: c.effective_status ?? null,
    });
  }

  for (const s of filteredAdsets) {
    const learning =
      s.learning_stage_info?.status === "LEARNING" ||
      s.learning_stage_info?.status === "learning";
    objects.push({
      id: s.id,
      name: s.name,
      status: s.status,
      level: "adset",
      parentId: s.campaign_id ?? null,
      campaignId: s.campaign_id ?? null,
      dailyBudget: s.daily_budget ? parseInt(s.daily_budget) / 100 : null,
      createdTime: s.created_time ?? null,
      ageDays: ageDaysFrom(s.created_time),
      w3d: parseInsightsRow(firstRow(w3dMaps.get("adset")!.get(s.id))),
      today: parseInsightsRow(firstRow(todayMaps.get("adset")!.get(s.id))),
      daily7: last7(toDaily(dailyMaps.get("adset")!.get(s.id))),
      daily30: toDaily(dailyMaps.get("adset")!.get(s.id)),
      spendSharePct: null,
      learningPhase: !!learning,
      effectiveStatus: s.effective_status ?? null,
    });
  }

  for (const a of filteredAds) {
    objects.push({
      id: a.id,
      name: a.name,
      status: a.status,
      level: "ad",
      parentId: a.adset_id ?? null,
      campaignId: a.campaign_id ?? null,
      dailyBudget: null,
      createdTime: a.created_time ?? null,
      ageDays: ageDaysFrom(a.created_time),
      w3d: parseInsightsRow(firstRow(w3dMaps.get("ad")!.get(a.id))),
      today: parseInsightsRow(firstRow(todayMaps.get("ad")!.get(a.id))),
      daily7: last7(toDaily(dailyMaps.get("ad")!.get(a.id))),
      daily30: toDaily(dailyMaps.get("ad")!.get(a.id)),
      spendSharePct: null,
      thumbnailUrl: a.creative?.image_url || a.creative?.thumbnail_url || null,
      effectiveStatus: a.effective_status ?? null,
    });
  }

  computeSpendShares(objects);

  return {
    accountId,
    currency,
    fetchedAt: new Date().toISOString(),
    objects,
    baselines,
    attributionStraddle: daysAgo(90) < ATTRIBUTION_CHANGE_DATE,
  };
}

/** Spend share within ad set — required for rule K5 (computed client-side per spec A3.6). */
export function computeSpendShares(objects: NormalizedObject[]): void {
  const adsByParent = new Map<string, NormalizedObject[]>();
  for (const o of objects) {
    if (o.level !== "ad" || !o.parentId) continue;
    if (!adsByParent.has(o.parentId)) adsByParent.set(o.parentId, []);
    adsByParent.get(o.parentId)!.push(o);
  }
  for (const ads of Array.from(adsByParent.values())) {
    const total = ads.reduce((s: number, a: NormalizedObject) => s + a.w3d.spend, 0);
    for (const a of ads) {
      a.spendSharePct = total > 0 ? (a.w3d.spend / total) * 100 : null;
    }
  }
}

async function fetchBaselines(token: string, accountId: string): Promise<Baselines> {
  // 90-day median Link CTR across ads/days
  let ctrValues: number[] = [];
  try {
    const json = await graphGet(`/${accountId}/insights`, {
      level: "ad",
      date_preset: "last_90d",
      time_increment: "1",
      fields: "inline_link_click_ctr",
      limit: "1000",
      access_token: token,
    });
    ctrValues = (json.data ?? [])
      .map((r: any) => parseFloat(r.inline_link_click_ctr))
      .filter((v: number) => Number.isFinite(v) && v > 0);
  } catch {
    /* baseline optional */
  }

  let cpmAvg14: number | null = null;
  let cpmNow: number | null = null;
  try {
    const json = await graphGet(`/${accountId}/insights`, {
      date_preset: "last_14d",
      fields: "cpm",
      access_token: token,
    });
    cpmAvg14 = parseFloat(json.data?.[0]?.cpm) || null;
    const j2 = await graphGet(`/${accountId}/insights`, {
      time_range: JSON.stringify({ since: daysAgo(2), until: daysAgo(0) }),
      fields: "cpm",
      access_token: token,
    });
    cpmNow = parseFloat(j2.data?.[0]?.cpm) || null;
  } catch {
    /* optional */
  }

  let cpaValues: number[] = [];
  try {
    const json = await graphGet(`/${accountId}/insights`, {
      date_preset: "last_30d",
      time_increment: "1",
      fields: "spend,actions",
      access_token: token,
    });
    cpaValues = (json.data ?? [])
      .map((r: any) => {
        const conv = pickAction(r.actions, CONVERSION_ACTION_TYPES);
        const spend = parseFloat(r.spend) || 0;
        return conv > 0 ? spend / conv : NaN;
      })
      .filter((v: number) => Number.isFinite(v));
  } catch {
    /* optional */
  }

  return {
    ctrLinkMedian90: median(ctrValues),
    cpmAvg14,
    cpaMedian30: median(cpaValues),
    cpmNow,
  };
}
