/**
 * Meta Marketing API client.
 * All calls are server-side with the user's own token. Reads insights data,
 * and — with explicit user confirmation in the UI — can pause/resume a
 * campaign, ad set, or ad (the ONLY write operation, via setObjectStatus).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
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

// ---------- Refresh instrumentation ----------
// Per-refresh counters, kept in AsyncLocalStorage so concurrent refreshes from
// different users never share a counter. Populated only when buildSnapshot runs
// inside refreshMetrics.run(...); every other caller of graphGet (OAuth, single
// account lookups) sees an undefined store and pays nothing. Cost when active is
// a handful of integer adds and one performance.now() pair per Graph round-trip
// — negligible against the network time it measures, so it ships permanently.
type RefreshMetrics = {
  graphCalls: number; // total Graph round-trips (GET pages; excludes async POST/poll)
  graphRetries: number; // extra attempts spent on transient Meta errors
  asyncFallbacks: number; // times a sync insights query bounced to the async job path
  metaMs: number; // summed wall-time spent inside fetch() to Meta (serial sum, not wall-clock)
};

const refreshMetrics = new AsyncLocalStorage<RefreshMetrics>();

function newRefreshMetrics(): RefreshMetrics {
  return { graphCalls: 0, graphRetries: 0, asyncFallbacks: 0, metaMs: 0 };
}

/** True only when the caller explicitly opts in via REFRESH_TIMING=1. */
function timingVerbose(): boolean {
  return process.env.REFRESH_TIMING === "1";
}

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
  const m = refreshMetrics.getStore();
  // Up to 3 attempts: Meta returns transient "unknown error" (code 1/2) on heavy queries
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    if (m) {
      m.graphCalls++;
      if (attempt > 0) m.graphRetries++;
    }
    const fetchStart = m ? performance.now() : 0;
    const res = await fetch(url);
    const json: any = await res.json().catch(() => ({}));
    if (m) m.metaMs += performance.now() - fetchStart;
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
      const m = refreshMetrics.getStore();
      if (m) m.asyncFallbacks++;
      if (timingVerbose()) {
        console.log(
          `[refresh-timing] async-fallback level=${level} reason="${(e.message ?? "").slice(0, 80)}"`
        );
      }
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
 *
 * Instrumentation: the per-request RefreshMetrics store sees:
 *   - the POST as `graphCalls` (round-trip) and `metaMs` (wall-time)
 *   - each polling status GET inside `graphGet` (already counts)
 *   - the final result download (`graphGetAll` walks paging.next) inside
 *     `graphGet` (already counts)
 * Originally the POST bypassed `graphGet` and so did NOT contribute to
 * the per-refresh totals — a real gap when a large account bounces to
 * the async path. Promoted here to use the same instrumentation primitive.
 */
async function fetchInsightsAsync(
  token: string,
  accountId: string,
  params: Record<string, string>,
  timeoutMs = 120000
): Promise<any[]> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const m = refreshMetrics.getStore();
  // The POST is a creation call (no GET read), so we count it manually to
  // match graphGet's accounting shape — graphCalls, retries (0 here — POST
  // is not retried), and metaMs. graphGet's retry-and-instrument logic
  // doesn't fit a POST, so the same metrics primitive is reused by hand.
  if (m) m.graphCalls++;
  const fetchStart = m ? performance.now() : 0;
  const startRes = await fetch(`${GRAPH}/${accountId}/insights`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (m) m.metaMs += performance.now() - fetchStart;
  const startJson: any = await startRes.json().catch(() => ({}));
  const reportId = startJson.report_run_id;
  if (!reportId) {
    throw new Error(startJson.error?.message || "Failed to start async insights job");
  }
  const deadline = Date.now() + timeoutMs;
  // poll job status — graphGet already increments counters per poll.
  for (;;) {
    if (Date.now() > deadline) throw new Error("Async insights job timed out");
    const status = await graphGet(`/${reportId}`, { access_token: token });
    if (status.async_status === "Job Completed") break;
    if (status.async_status === "Job Failed" || status.async_status === "Job Skipped") {
      throw new Error(`Async insights job ${status.async_status}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  // Final download — graphGetAll walks the result pages through graphGet,
  // so every result page call is already in the totals.
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
 *
 * Note on the ad-level daily call (refresh bottleneck fix):
 * the verdict path historically asked Meta for the last_30d daily per ad
 * (875 ads × up-to-30 rows = the 108s slow call, see refresh-bottleneck-
 * root-cause.txt). Investigation proved that EVERY verdict-feeding rule
 * (decayMap K4/W2/S1/W1, fatigueSignals F1/F2, watchRules W2, continueRules
 * S1, weeklyConversions learning gate) reads only the last 7 days of that
 * series; the other 23 days feed NOTHING but the DecisionTable date-range
 * selector's 14d/30d/custom chart view. We split the call:
 *
 *   hot path (this function)   : last_7d daily per ad — same dates/values
 *                               as the trailing 7 of a last_30d query,
 *                               ASSUMING Meta returns the same row set
 *                               for both (true in practice — a day with
 *                               zero spend/impressions is omitted by both
 *                               queries, so the sparse row set matches).
 *   lazy path                  : last_30d daily per ad (display only) fetched
 *                               on-demand by `fetchAdDailyHistory` below.
 *   presence signal (this fn)  : last_30d AGGREGATE per ad (no time_increment
 *                               → 1 row per ad, ~30× lighter than the daily
 *                               30d call) — keeps the relevance filter's
 *                               membership identical to before.
 */
export async function buildSnapshot(
  token: string,
  accountId: string,
  currency: string
): Promise<AccountSnapshotPayload> {
  // Meta's native "last N days" preset covers the last N fully-elapsed days
  // (ending yesterday, evaluated in the ad account's timezone) and excludes
  // today — matching the sibling `today` preset below. This is the window
  // every Kill/Watch/Continue rule judges against (spec 010 FR-001/002).
  const threeDay = { date_preset: "last_3d" };
  const today = { date_preset: "today" };
  // Verdict path: last 7 days, daily, at ad level (was last_30d — see header).
  // Picked up by decayMap / fatigueSignals / watchRules / continueRules.
  const last7daily = { date_preset: "last_7d", time_increment: "1" };
  // Display path: per-row aggregate of "did this ad deliver in 30d?" — only
  // used to compute isRelevant() (presence-only, .length > 0). Omitting
  // time_increment collapses the per-ad response to one row per ad that
  // delivered anything in the window; dramatically smaller payload than the
  // historical last_30d time_increment=1 call.
  const last30aggregate = { date_preset: "last_30d" };
  // Cheap daily path for campaign and ad-set levels (already 34 + 186 objects;
  // the daily per-row volume at these levels doesn't dominate refresh time).
  const last30daily = { date_preset: "last_30d", time_increment: "1" };

  // Instrumentation: establish per-refresh counters for every graphGet spawned
  // below (enterWith propagates the store across all following awaits without
  // wrapping the whole body). t0 anchors every phase offset.
  const metrics = newRefreshMetrics();
  refreshMetrics.enterWith(metrics);
  const t0 = performance.now();
  const phase: Record<string, number> = {};

  const tHier = performance.now();
  const { campaigns, adsets, ads } = await fetchHierarchy(token, accountId);
  phase.fetchHierarchy = Math.round(performance.now() - tHier);

  // Run all per-level calls in parallel. Two facts to lock in:
  //  (1) campaign + adset levels keep the historical last_30d daily call
  //      (cheap — 34 + 186 objects; the previous bottleneck was specifically
  //      the ad-level 30d daily call which was 875 ads × up to 30 rows).
  //  (2) ad level uses last_7d daily for the verdict path + a cheap
  //      last_30d AGGREGATE (no time_increment) for the relevance-filter
  //      presence check. The aggregate's per-ad row is byte-equivalent to
  //      "did this ad ever deliver in 30d" — the only signal the relevance
  //      filter needs.
  // The previous 9-call layout (3 levels × 3 windows) is preserved for
  // campaign + adset (cheap). For the ad level, the historical daily call
  // is replaced by a 7d daily call, and a cheap aggregate fills the
  // presence role previously filled by `dailyMaps.get("ad").get(id).length`.
  // Net: 9 calls + 1 ad-level cheap presence aggregate = 10 calls, with
  // the dominant 30d-daily cost at the ad level removed.
  const w3dMaps = new Map<string, Map<string, any[]>>();
  const todayMaps = new Map<string, Map<string, any[]>>();
  // Per-level daily maps. Campaign & adset still hold the full last_30d
  // daily series (cheap), and power both `daily7` (engine) and `daily30`
  // (display) at those levels. At the ad level the map now holds last_7d
  // daily — engine reads daily7 via toDaily(...) directly with no slice.
  const dailyMaps = new Map<string, Map<string, any[]>>();
  // ad-level presence map (last_30d aggregate, 1 row per ad) — feeds only
  // the relevance filter (.length > 0). Kept separate from dailyMaps so the
  // daily maps stay a pure verdict/display artifact.
  const adPresence30d = new Map<string, boolean>();

  type CallSpec =
    | { kind: "level"; level: "campaign" | "adset" | "ad"; bucket: "w3dMaps" | "todayMaps" | "dailyMaps"; params: Record<string, string> }
    | { kind: "adPresence"; params: Record<string, string> };
  const calls: CallSpec[] = [
    ...(["campaign", "adset", "ad"] as const).flatMap(level =>
      (["w3dMaps", "todayMaps", "dailyMaps"] as const).map(bucket => {
        let params: Record<string, string>;
        if (bucket === "w3dMaps") params = threeDay;
        else if (bucket === "todayMaps") params = today;
        else params = level === "ad" ? last7daily : last30daily;
        return { kind: "level" as const, level, bucket, params };
      })
    ),
    { kind: "adPresence", params: last30aggregate },
  ];

  // Per-call start-offset + duration proves the calls are genuinely
  // concurrent. If they were accidentally serialized the start offsets
  // would climb monotonically instead of all clustering near 0.
  const tInsights = performance.now();
  const callTrace: Array<{ label: string; startOffMs: number; durMs: number; rows: number }> = [];
  await Promise.all(
    calls.map(c => {
      const startOff = performance.now() - tInsights;
      const callStart = performance.now();
      if (c.kind === "level") {
        return fetchLevelInsights(token, accountId, c.level, c.params).then(map => {
          if (timingVerbose()) {
            let rows = 0;
            for (const arr of Array.from(map.values())) rows += arr.length;
            callTrace.push({
              label: `${c.level}/${c.bucket}`,
              startOffMs: Math.round(startOff),
              durMs: Math.round(performance.now() - callStart),
              rows,
            });
          }
          if (c.bucket === "w3dMaps") w3dMaps.set(c.level, map);
          else if (c.bucket === "todayMaps") todayMaps.set(c.level, map);
          else dailyMaps.set(c.level, map);
        });
      }
      // c.kind === "adPresence" — ad-level 30d aggregate (1 row per ad).
      // Built via fetchLevelInsights so it shares the same paging + retry +
      // async-fallback path; params deliberately omit `time_increment` so
      // Meta returns one row per ad that delivered anything in the window.
      return fetchLevelInsights(token, accountId, "ad", c.params).then(map => {
        if (timingVerbose()) {
          let rows = 0;
          for (const arr of Array.from(map.values())) rows += arr.length;
          callTrace.push({
            label: "ad/presence30d",
            startOffMs: Math.round(startOff),
            durMs: Math.round(performance.now() - callStart),
            rows,
          });
        }
        for (const id of Array.from(map.keys())) adPresence30d.set(id, true);
      });
    })
  );
  phase.insightsParallel = Math.round(performance.now() - tInsights);
  if (timingVerbose()) {
    (phase as Record<string, unknown>).insightsCallTrace = callTrace;
  }

  // Baselines
  const tBaselines = performance.now();
  const baselines = await fetchBaselines(token, accountId);
  phase.fetchBaselines = Math.round(performance.now() - tBaselines);

  // Relevance filter: keep objects that are currently delivering OR had any
  // delivery in the last 30 days. Mature accounts hold thousands of long-dead
  // paused objects that would drown the decision table in noise.
  //
  // At the ad level the historical implementation read dailyMaps (last_30d
  // daily) for a presence-only `.length > 0` test — paying for ~875 ads ×
  // up-to-30 rows of daily values to answer "did this ad ever deliver".
  // After the refresh-bottleneck fix, the ad-level daily call is last_7d,
  // so the 30d presence signal now comes from `adPresence30d` (a separate
  // cheap aggregate call — 1 row per ad that delivered in 30d). This
  // preserves the EXACT same membership as before: an ad that delivered
  // 8–30 days ago but is silent in the last 7d still appears in the
  // decision table.
  const hadDelivery = (lvl: "campaign" | "adset" | "ad", id: string) => {
    if (lvl === "ad") {
      // ad-level uses the cheap 30d aggregate for 30d presence; w3d/today
      // still cover the last-3-days and today windows.
      if (adPresence30d.get(id)) return true;
      if ((w3dMaps.get(lvl)!.get(id)?.length ?? 0) > 0) return true;
      if ((todayMaps.get(lvl)!.get(id)?.length ?? 0) > 0) return true;
      return false;
    }
    // campaign + adset still have last_30d daily in dailyMaps; the original
    // semantics apply unchanged.
    return (
      (dailyMaps.get(lvl)!.get(id)?.length ?? 0) > 0 ||
      (w3dMaps.get(lvl)!.get(id)?.length ?? 0) > 0 ||
      (todayMaps.get(lvl)!.get(id)?.length ?? 0) > 0
    );
  };
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
      // Verdict path: the ad-level daily call is now last_7d (was last_30d).
      // The verdict rulebook only ever reads ad.daily7 here. Daily7 =
      // toDaily(dailyMaps.get("ad").get(a.id)) — whatever rows Meta returns
      // for the last_7d window. When Meta returns a row for every calendar
      // day in the window, daily7 ends up with 7 entries; on a sparse day
      // (zero spend / impressions that day), Meta omits the row and daily7
      // has fewer entries. The engine rules treat a missing day as a
      // "no-impressions" day (daily7.length < 3 ⇒ bail, filter d.impressions
      // > 100 ⇒ skip missing days). The OLD last_30d + last7() path had the
      // SAME behavior on sparse delivery. So daily7 is byte-identical to
      // the historical last-7-slice whenever Meta returns the same row set
      // for both queries — which it does for any day that had delivery.
      // See server/daily7Slice.test.ts for the explicit byte-identity
      // coverage + the sparse-day explicit test.
      daily7: toDaily(dailyMaps.get("ad")!.get(a.id)),
      // Display path: only the campaign/adset levels still hold a daily30
      // series on the snapshot. Ad-level `daily30` is now populated lazily
      // via routers.ts#dashboard.adDailyHistory when the user picks a
      // 14d/30d/custom range in the date-range selector (DecisionTable.tsx).
      // Empty here keeps the per-row aggregate logic in clients/routers.ts
      // working — it already falls back to `o.daily7` (or sums children)
      // when `daily30` is short or missing.
      daily30: [],
      spendSharePct: null,
      thumbnailUrl: a.creative?.image_url || a.creative?.thumbnail_url || null,
      effectiveStatus: a.effective_status ?? null,
    });
  }

  computeSpendShares(objects);

  // Account-timezone "today" (YYYY-MM-DD) anchors the client's preset date-range
  // chips so they exclude today and reconcile with Meta (spec 010, FR-012). The
  // account timezone is authoritative on the success path; a single failed field
  // must not fail the whole refresh, so we fall back to the server's system-tz
  // current date (intentional error path per spec note U1 — not an FR-012
  // violation, which governs the normal path).
  let asOfDate: string;
  const tTz = performance.now();
  try {
    const acct = await graphGet(`/${accountId}`, {
      fields: "timezone_name",
      access_token: token,
    });
    const tzName = acct?.timezone_name;
    asOfDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: tzName || undefined,
    }).format(new Date());
  } catch {
    asOfDate = new Intl.DateTimeFormat("en-CA").format(new Date());
  }
  phase.accountTimezone = Math.round(performance.now() - tTz);

  // Instrumentation summary. One structured line per refresh — cheap enough to
  // leave on permanently (it measures phases that each take seconds). Note this
  // covers Meta-fetch + CPU only; it stops before the DB write, which happens in
  // routers.ts#dashboard.refresh (saveSnapshot) outside buildSnapshot's scope.
  phase.buildSnapshotTotal = Math.round(performance.now() - t0);
  const summary: Record<string, unknown> = {
    accountId,
    counts: {
      campaigns: campaigns.length,
      adsets: adsets.length,
      ads: ads.length,
      keptObjects: objects.length,
    },
    phaseMs: phase,
    metaRoundTrips: metrics.graphCalls,
    metaRetries: metrics.graphRetries,
    asyncFallbacks: metrics.asyncFallbacks,
    // Serial sum of time inside fetch() to Meta. metaMs > buildSnapshotTotal
    // means concurrency is helping (work overlapped); metaMs ≈ total means the
    // fetches ran serially. The gap is what Promise.all bought us.
    metaMsSerialSum: Math.round(metrics.metaMs),
  };
  if (timingVerbose()) summary.insightsCallTrace = callTrace;
  console.log(`[refresh-timing] ${JSON.stringify(summary)}`);

  return {
    accountId,
    currency,
    fetchedAt: new Date().toISOString(),
    asOfDate,
    objects,
    baselines,
    attributionStraddle: daysAgo(90) < ATTRIBUTION_CHANGE_DATE,
  };
}

/**
 * Lazy 30-day ad-level daily history for the DecisionTable date-range chart.
 * Returns the FULL ad-level daily series for the requested window (default
 * 30d, supports 14d). Per-row it is the same shape the historical buildSnapshot
 * populated `ad.daily30` with; consumed by the display-only `aggregate()`
 * helper in DecisionTable.tsx when the user selects 14d/30d/custom.
 *
 * Refresh-bottleneck rationale: previously this data was pulled on every
 * refresh — the dominant 108s call on a real 875-ad account. It feeds no
 * verdict rule (only the date-range chart), so it now lives behind this
 * separate, on-demand fetch. Per-call timed via the AsyncLocalStorage counter
 * — every graphGet round-trip increments `metrics.graphCalls`. Concurrent
 * calls (refresh ticking while user opens a 30d chip) are safe; the metric
 * store is per-request via enterWith().
 */
export async function fetchAdDailyHistory(
  token: string,
  accountId: string,
  days: 14 | 30 = 30
): Promise<Map<string, DailyMetrics[]>> {
  // Lazy fetch — opt into the same instrumentation store that buildSnapshot
  // uses, so [refresh-timing] counters still credit every round-trip. If we
  // are called outside a previously-entered store (e.g. the standalone
  // measure-refresh-timing harness), establish a fresh one in this async
  // context so counters still increment. We also emit a [refresh-timing]
  // summary at the end (round-3 CodeRabbit: lazy-fetch round-trips were
  // previously invisible in timing output).
  const ownStore = !refreshMetrics.getStore();
  if (ownStore) {
    refreshMetrics.enterWith(newRefreshMetrics());
  }
  const t0 = performance.now();
  const preset = days === 14 ? "last_14d" : "last_30d";
  const map = await fetchLevelInsights(token, accountId, "ad", {
    date_preset: preset,
    time_increment: "1",
  });
  // Build a per-AD keyed map (rowId → date-sorted DailyMetrics). The
  // DecisionTable picks the slice matching the row being aggregated —
  // without row identity, every row's range totals would include every
  // other ad's spend (each row sees the union). See aggregate() in
  // client/src/components/DecisionTable.tsx for the consumer side.
  const byId = new Map<string, DailyMetrics[]>();
  for (const [adId, rows] of Array.from(map.entries())) {
    const series: DailyMetrics[] = rows
      .map(r => ({ ...parseInsightsRow(r), date: r.date_start as string }))
      .sort((a, b) => a.date.localeCompare(b.date));
    byId.set(adId, series);
  }
  // Emit the [refresh-timing] summary when we OWN the store — otherwise
  // we're nested inside a refresh whose own summary already covers us, and
  // a second emit would double-count the parent refresh's totals.
  if (ownStore) {
    const m = refreshMetrics.getStore();
    if (m) {
      // Round-6 CodeRabbit: `byId.size` is the number of ADS in the
      // keyed map, not the number of daily-history rows returned.
      // Sum the per-ad series lengths to report actual rows.
      let totalRows = 0;
      for (const series of Array.from(byId.values())) totalRows += series.length;
      console.log(
        `[refresh-timing] adDailyHistory ${JSON.stringify({
          accountId,
          days,
          wallMs: Math.round(performance.now() - t0),
          metaRoundTrips: m.graphCalls,
          metaRetries: m.graphRetries,
          asyncFallbacks: m.asyncFallbacks,
          metaMsSerialSum: Math.round(m.metaMs),
          adsReturned: byId.size,
          rowsReturned: totalRows,
        })}`
      );
    }
  }
  return byId;
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
      // "current" CPM over the last 3 complete days (account tz, excludes today)
      // — matches the engine's corrected w3d window (spec 010 FR-003).
      date_preset: "last_3d",
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
