/**
 * Decision table — drill-down (campaign → adset → ad) with:
 * - date-range selector (display-only; verdicts always follow the rulebook windows)
 * - free filters: name search + verdict chips
 * - sortable columns, show/hide column picker (persisted)
 * - ad creative thumbnails
 * - pause/resume controls with confirmation (the only write to Meta)
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { VerdictBadge } from "@/components/Verdict";
import { cpaColorClass, ctrColorClass, money, num, pct } from "@/lib/format";
import { applyFilters, FILTER_FIELDS, type FilterAgg, type FilterJoin, type FilterOp, type FilterRule } from "@/lib/filters";
import { aggregateTotals } from "@/lib/aggregate";
import { trpc } from "@/lib/trpc";
import type { DailyMetrics, EngineRow, Verdict, WindowMetrics } from "@shared/qarar";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Columns3,
  ExternalLink,
  Filter,
  ImageOff,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

// ---------- series payload from dashboard.get ----------
export interface SeriesObj {
  id: string;
  level: string;
  parentId: string | null;
  status: string;
  effectiveStatus: string | null;
  thumbnailUrl: string | null;
  today: WindowMetrics;
  w3d: WindowMetrics;
  daily30: DailyMetrics[];
}

// ---------- date ranges ----------
type RangeKey = "today" | "3d" | "7d" | "14d" | "30d" | "custom";

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "اليوم",
  "3d": "آخر 3 أيام",
  "7d": "آخر 7 أيام",
  "14d": "آخر 14 يوم",
  "30d": "آخر 30 يوم",
  custom: "فترة مخصصة",
};

function dateStr(off: number): string {
  const d = new Date();
  d.setDate(d.getDate() - off);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function aggFromWindow(w: WindowMetrics): FilterAgg {
  return {
    spend: w.spend,
    impressions: w.impressions,
    results: w.conversions,
    linkClicks: w.linkClicks,
    clicks: w.clicks,
    cpa: w.conversions > 0 ? w.spend / w.conversions : null,
    ctrLink: w.impressions > 0 ? w.ctrLink : null,
    ctrAll: w.impressions > 0 ? w.ctrAll : null,
    cpm: w.impressions > 0 ? w.cpm : null,
    cpc: w.linkClicks > 0 ? w.spend / w.linkClicks : null,
    hookRate:
      w.impressions > 0 && (w.videoViews3s ?? 0) > 0
        ? ((w.videoViews3s ?? 0) / w.impressions) * 100
        : null,
    holdRate:
      (w.videoViews3s ?? 0) > 0 && (w.thruplays ?? 0) > 0
        ? ((w.thruplays ?? 0) / (w.videoViews3s ?? 1)) * 100
        : null,
    lpRate: w.linkClicks > 0 && w.lpViews > 0 ? (w.lpViews / w.linkClicks) * 100 : null,
    frequency: null,
    spendShare: null,
  };
}

function aggregate(s: SeriesObj | undefined, range: RangeKey, from: string, to: string): FilterAgg | null {
  if (!s) return null;
  if (range === "today") return aggFromWindow(s.today);
  // if the daily series is missing entirely, fall back to the engine's 3-day window
  if (range === "3d" && s.daily30.length === 0) return aggFromWindow(s.w3d);
  const days = range === "3d" ? 3 : range === "7d" ? 7 : range === "14d" ? 14 : 30;
  const since = range === "custom" ? from : dateStr(days - 1);
  const until = range === "custom" ? to : dateStr(0);
  if (!since || !until) return null;
  let spend = 0, imps = 0, clicks = 0, linkClicks = 0, conv = 0, lp = 0, v3 = 0, tp = 0;
  for (const d of s.daily30) {
    if (d.date < since || d.date > until) continue;
    spend += d.spend;
    imps += d.impressions;
    clicks += d.clicks;
    linkClicks += d.linkClicks;
    conv += d.conversions;
    lp += d.lpViews;
    v3 += d.videoViews3s ?? 0;
    tp += d.thruplays ?? 0;
  }
  return {
    spend,
    impressions: imps,
    results: conv,
    linkClicks,
    clicks,
    cpa: conv > 0 ? spend / conv : null,
    ctrLink: imps > 0 ? (linkClicks / imps) * 100 : null,
    ctrAll: imps > 0 ? (clicks / imps) * 100 : null,
    cpm: imps > 0 ? (spend / imps) * 1000 : null,
    cpc: linkClicks > 0 ? spend / linkClicks : null,
    hookRate: imps > 0 && v3 > 0 ? (v3 / imps) * 100 : null,
    holdRate: v3 > 0 && tp > 0 ? (tp / v3) * 100 : null,
    lpRate: linkClicks > 0 && lp > 0 ? (lp / linkClicks) * 100 : null,
    frequency: null,
    spendShare: null,
  };
}

// ---------- columns ----------
type ColKey =
  | "spend"
  | "results"
  | "cpa"
  | "ctrLink"
  | "ctrAll"
  | "cpm"
  | "cpc"
  | "hookRate"
  | "holdRate"
  | "lpRate"
  | "spendShare"
  | "frequency"
  | "impressions";

const ALL_COLUMNS: { key: ColKey; label: string; adOnly?: boolean }[] = [
  { key: "spend", label: "Spend" },
  { key: "results", label: "Results" },
  { key: "cpa", label: "CPA" },
  { key: "ctrLink", label: "Link CTR" },
  { key: "ctrAll", label: "CTR (All)" },
  { key: "cpm", label: "CPM" },
  { key: "cpc", label: "CPC" },
  { key: "hookRate", label: "Hook Rate", adOnly: true },
  { key: "holdRate", label: "Hold Rate", adOnly: true },
  { key: "lpRate", label: "LP View %" },
  { key: "spendShare", label: "% Spend", adOnly: true },
  { key: "frequency", label: "Frequency" },
  { key: "impressions", label: "Impressions" },
];

const DEFAULT_VISIBLE: ColKey[] = ["spend", "results", "cpa", "ctrLink", "spendShare"];
const LS_KEY = "qarar_columns_v1";

function loadVisible(): ColKey[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return DEFAULT_VISIBLE;
}

const VERDICT_CHIPS: { v: Verdict; label: string }[] = [
  { v: "kill", label: "🔴 إيقاف" },
  { v: "watch", label: "🟡 مراقبة" },
  { v: "continue", label: "🟢 سليم" },
  { v: "rescue", label: "🛟 إنقاذ" },
  { v: "too_early", label: "⏳ مبكّر" },
];

const LEVEL_LABELS_AR: Record<string, string> = {
  campaign: "حملة",
  adset: "مجموعة",
  ad: "إعلان",
};

const OP_LABELS_AR: Record<FilterOp, string> = {
  is: "يساوي",
  is_not: "لا يساوي",
  contains: "يحتوي على",
  gte: "أكبر من أو يساوي",
  lte: "أصغر من أو يساوي",
  between: "بين",
};

const OPS_BY_TYPE: Record<string, FilterOp[]> = {
  text: ["contains"],
  enum: ["is", "is_not"],
  numeric: ["gte", "lte", "between"],
};

// ============================================================

export function DecisionTable({
  rows,
  series,
  unitTarget,
  actId,
  accountId,
  isDemo,
  searchTerm,
  onSearchTermChange,
}: {
  rows: EngineRow[];
  series: SeriesObj[];
  unitTarget: number;
  actId: string | null;
  accountId: number;
  isDemo: boolean;
  searchTerm: string;
  onSearchTermChange: (q: string) => void;
}) {
  const utils = trpc.useUtils();

  // drill-down
  const [path, setPath] = useState<{ campaign?: EngineRow; adset?: EngineRow }>({});
  const level = path.adset ? "ad" : path.campaign ? "adset" : "campaign";

  // date range
  const [range, setRange] = useState<RangeKey>("3d");
  const [from, setFrom] = useState(dateStr(6));
  const [to, setTo] = useState(dateStr(0));

  // filters
  const q = searchTerm;
  const setQ = onSearchTermChange;
  const [verdicts, setVerdicts] = useState<Set<Verdict>>(new Set());
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [filterJoin, setFilterJoin] = useState<FilterJoin>("AND");
  const [showFilters, setShowFilters] = useState(false);

  // columns
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(loadVisible);
  const toggleCol = (k: ColKey) => {
    setVisibleCols(prev => {
      const next = prev.includes(k) ? prev.filter(c => c !== k) : [...prev, k];
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // sorting
  const [sort, setSort] = useState<{ key: ColKey | "verdict" | "name"; dir: 1 | -1 }>({
    key: "verdict",
    dir: 1,
  });
  const clickSort = (key: ColKey | "verdict" | "name") =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  // pause/resume
  const [confirmRow, setConfirmRow] = useState<EngineRow | null>(null);
  const setStatus = trpc.control.setStatus.useMutation({
    onSuccess: (res, vars) => {
      utils.dashboard.get.invalidate({ adAccountId: accountId });
      toast.success(
        vars.status === "PAUSED"
          ? `تم إيقاف "${confirmRow?.name ?? ""}" ${res.simulated ? "(محاكاة تجريبية)" : "في ميتا ✓"}`
          : `تم تشغيل "${confirmRow?.name ?? ""}" ${res.simulated ? "(محاكاة تجريبية)" : "في ميتا ✓"}`
      );
      setConfirmRow(null);
    },
    onError: e => {
      if (e.message === "NEEDS_RECONNECT_PERMISSION") {
        toast.error("تلزم صلاحية إضافية — افصل الحساب ثم أعد توصيله لمنح صلاحية التحكم");
      } else if (e.message === "RECONNECT_REQUIRED") {
        toast.error("انتهت صلاحية الاتصال — أعد توصيل حساب ميتا");
      } else {
        toast.error(`فشل تنفيذ الأمر: ${e.message}`);
      }
      setConfirmRow(null);
    },
  });

  const seriesMap = useMemo(() => new Map(series.map(s => [s.id, s])), [series]);

  const adsManagerUrl = (r: EngineRow) => {
    if (!actId) return null;
    const act = actId.replace(/^act_/, "");
    const param =
      r.level === "campaign"
        ? `selected_campaign_ids=${r.id}`
        : r.level === "adset"
          ? `selected_adset_ids=${r.id}`
          : `selected_ad_ids=${r.id}`;
    return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&${param}`;
  };

  // effective-status-aware status resolver for filters
  const getStatus = (r: EngineRow) => {
    const s = seriesMap.get(r.id);
    return (s?.effectiveStatus ?? s?.status ?? r.status) === "ACTIVE" ? "ACTIVE" : "PAUSED";
  };

  // aggregate metrics per row for the selected range (all rows, for filter support)
  const aggs = useMemo(() => {
    const m = new Map<string, FilterAgg | null>();
    for (const r of rows) m.set(r.id, aggregate(seriesMap.get(r.id), range, from, to));
    return m;
  }, [rows, seriesMap, range, from, to]);

  // visible rows — when searching/filtering, search across ALL levels
  const hasFilters = filterRules.length > 0;
  const isSearching = q.trim() !== "" || verdicts.size > 0 || hasFilters;
  const visible = useMemo(() => {
    let list: EngineRow[];
    if (isSearching) {
      list = rows;
    } else if (level === "campaign") {
      list = rows.filter(r => r.level === "campaign");
    } else if (level === "adset")
      list = rows.filter(r => r.level === "adset" && r.campaignId === path.campaign!.id);
    else list = rows.filter(r => r.level === "ad" && r.parentId === path.adset!.id);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(needle));
    }
    if (verdicts.size > 0) list = list.filter(r => verdicts.has(r.verdict));
    if (hasFilters) list = applyFilters(list, filterRules, filterJoin, aggs, getStatus);
    return list;
  }, [rows, level, path, q, verdicts, isSearching, hasFilters, filterRules, filterJoin, aggs]);

  const verdictOrder: Record<Verdict, number> = {
    kill: 0,
    rescue: 1,
    watch: 2,
    continue: 3,
    too_early: 4,
  };

  const sorted = useMemo(() => {
    const val = (r: EngineRow): number | string => {
      const a = aggs.get(r.id);
      switch (sort.key) {
        case "verdict":
          return verdictOrder[r.verdict] * 1e9 - r.spend_3d;
        case "name":
          return r.name;
        case "spendShare":
          return r.spend_share_pct ?? -1;
        case "frequency":
          return r.frequency_3d ?? -1;
        default: {
          const v = a?.[sort.key as keyof FilterAgg];
          return typeof v === "number" ? v : -1;
        }
      }
    };
    return [...visible].sort((x, y) => {
      const a = val(x), b = val(y);
      if (typeof a === "string" || typeof b === "string")
        return String(a).localeCompare(String(b), "ar") * sort.dir;
      return (a - b) * sort.dir;
    });
  }, [visible, aggs, sort]);

  const activeCols = ALL_COLUMNS.filter(
    c => visibleCols.includes(c.key) && (!c.adOnly || level === "ad")
  );

  const totals = useMemo(
    () => aggregateTotals(sorted.map(r => r.id), aggs),
    [sorted, aggs],
  );

  const totalCell = (key: ColKey): string => {
    switch (key) {
      case "spend":
        return money(totals.spend);
      case "results":
        return num(totals.results);
      case "cpa":
        return totals.cpa === null ? "—" : money(totals.cpa);
      case "ctrLink":
        return totals.ctrLink === null ? "—" : pct(totals.ctrLink);
      case "ctrAll":
        return totals.ctrAll === null ? "—" : pct(totals.ctrAll);
      case "cpm":
        return totals.cpm === null ? "—" : money(totals.cpm);
      case "cpc":
        return totals.cpc === null ? "—" : money(totals.cpc);
      case "impressions":
        return num(totals.impressions);
      default:
        return "—";
    }
  };

  const cellValue = (r: EngineRow, key: ColKey): string => {
    const a = aggs.get(r.id);
    switch (key) {
      case "spend":
        return money(a?.spend ?? 0);
      case "results":
        return num(a?.results ?? 0);
      case "cpa":
        return (a?.results ?? 0) === 0 ? "∞" : money(a?.cpa ?? undefined);
      case "ctrLink":
        return a?.ctrLink == null ? "—" : pct(a.ctrLink);
      case "ctrAll":
        return a?.ctrAll == null ? "—" : pct(a.ctrAll);
      case "cpm":
        return a?.cpm == null ? "—" : money(a.cpm);
      case "cpc":
        return a?.cpc == null ? "—" : money(a.cpc);
      case "hookRate":
        return a?.hookRate == null ? "—" : pct(a.hookRate, 1);
      case "holdRate":
        return a?.holdRate == null ? "—" : pct(a.holdRate, 1);
      case "lpRate":
        return a?.lpRate == null ? "—" : pct(a.lpRate, 0);
      case "spendShare":
        return r.spend_share_pct == null ? "—" : pct(r.spend_share_pct, 0);
      case "frequency":
        return r.frequency_3d ? r.frequency_3d.toFixed(2) : "—";
      case "impressions":
        return num(a?.impressions ?? 0);
    }
  };

  const cellClass = (r: EngineRow, key: ColKey): string => {
    const a = aggs.get(r.id);
    if (key === "cpa") return `font-bold ${cpaColorClass((a?.results ?? 0) === 0 ? null : (a?.cpa ?? null), unitTarget)}`;
    if (key === "ctrLink") return `font-bold ${a?.ctrLink == null ? "" : ctrColorClass(a.ctrLink)}`;
    if (key === "spendShare" && r.spend_share_pct !== null && r.spend_share_pct < 10)
      return "text-v-rescue";
    return "";
  };

  const isPaused = (r: EngineRow) => {
    const s = seriesMap.get(r.id);
    const st = s?.effectiveStatus ?? s?.status ?? r.status;
    return st !== "ACTIVE";
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-3 pb-3">
        {/* Breadcrumb */}
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button
            onClick={() => setPath({})}
            className={`rounded px-1.5 py-0.5 hover:bg-accent ${!path.campaign ? "font-extrabold" : "text-muted-foreground"}`}
          >
            الحملات
          </button>
          {path.campaign && (
            <>
              <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                onClick={() => setPath({ campaign: path.campaign })}
                className={`max-w-[200px] truncate rounded px-1.5 py-0.5 hover:bg-accent ${!path.adset ? "font-extrabold" : "text-muted-foreground"}`}
              >
                {path.campaign.name}
              </button>
            </>
          )}
          {path.adset && (
            <>
              <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[200px] truncate px-1.5 font-extrabold">
                {path.adset.name}
              </span>
            </>
          )}
        </div>

        {/* Toolbar: date range / search / verdict chips / columns */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/60 p-0.5">
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map(k => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={`rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
                  range === k
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {RANGE_LABELS[k]}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={from}
                min={dateStr(29)}
                max={to}
                onChange={e => setFrom(e.target.value)}
                className="num rounded-md border border-border/60 bg-background px-2 py-1"
              />
              <span className="text-muted-foreground">→</span>
              <input
                type="date"
                value={to}
                min={from}
                max={dateStr(0)}
                onChange={e => setTo(e.target.value)}
                className="num rounded-md border border-border/60 bg-background px-2 py-1"
              />
            </div>
          )}

          <div className="relative min-w-[160px] flex-1 sm:max-w-[240px]">
            <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="ابحث بالاسم…"
              className="h-8 pr-8 text-xs"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {VERDICT_CHIPS.map(c => (
              <button
                key={c.v}
                onClick={() =>
                  setVerdicts(prev => {
                    const next = new Set(prev);
                    if (next.has(c.v)) next.delete(c.v);
                    else next.add(c.v);
                    return next;
                  })
                }
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                  verdicts.has(c.v)
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-accent"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <Button
            variant={showFilters || hasFilters ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setShowFilters(s => !s)}
          >
            <Filter className="h-3.5 w-3.5" />
            فلتر
            {hasFilters && (
              <span className="num rounded bg-primary-foreground/20 px-1 text-[9px]">
                {filterRules.length}
              </span>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Columns3 className="h-3.5 w-3.5" />
                الأعمدة
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 text-right">
              <DropdownMenuLabel className="text-xs">اختر الأعمدة الظاهرة</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALL_COLUMNS.map(c => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={visibleCols.includes(c.key)}
                  onCheckedChange={() => toggleCol(c.key)}
                  onSelect={e => e.preventDefault()}
                  className="num text-xs"
                >
                  {c.label}
                  {c.adOnly && <span className="mr-1 text-[9px] opacity-50">(إعلانات)</span>}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
        </DropdownMenu>
        </div>

        {showFilters && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-muted-foreground">ربط القواعد:</span>
              <div className="flex rounded-md border border-border/60">
                {(["AND", "OR"] as FilterJoin[]).map(j => (
                  <button
                    key={j}
                    onClick={() => setFilterJoin(j)}
                    className={`rounded-md px-3 py-0.5 text-[11px] font-bold ${
                      filterJoin === j
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {j === "AND" ? "الكل (و)" : "أي واحد (أو)"}
                  </button>
                ))}
              </div>
            </div>

            {filterRules.map((rule, idx) => {
              const meta = FILTER_FIELDS[rule.field];
              const ops = meta ? OPS_BY_TYPE[meta.type] : [];
              return (
                <div key={rule.id} className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={rule.field}
                    onChange={e => {
                      const field = e.target.value;
                      const m = FILTER_FIELDS[field];
                      const defaultOp = m ? OPS_BY_TYPE[m.type][0] : "is";
                      setFilterRules(rs => rs.map(r => r.id === rule.id ? { ...r, field, op: defaultOp, value: "", value2: undefined } : r));
                    }}
                    className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                  >
                    {Object.entries(FILTER_FIELDS).map(([key, m]) => {
                      const fieldMeta = m as { label: string };
                      return <option key={key} value={key}>{fieldMeta.label}</option>;
                    })}
                  </select>

                  <select
                    value={rule.op}
                    onChange={e => setFilterRules(rs => rs.map(r => r.id === rule.id ? { ...r, op: e.target.value as FilterOp } : r))}
                    className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                  >
                    {ops.map(op => (
                      <option key={op} value={op}>{OP_LABELS_AR[op]}</option>
                    ))}
                  </select>

                  {meta?.type === "enum" && meta.options ? (
                    <select
                      value={rule.value}
                      onChange={e => setFilterRules(rs => rs.map(r => r.id === rule.id ? { ...r, value: e.target.value } : r))}
                      className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                    >
                      <option value="">— اختر —</option>
                      {meta.options.map((o: string) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : rule.op === "between" ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={rule.value}
                        onChange={e => setFilterRules(rs => rs.map(r => r.id === rule.id ? { ...r, value: e.target.value } : r))}
                        placeholder="من"
                        className="num w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">→</span>
                      <input
                        type="number"
                        value={rule.value2 ?? ""}
                        onChange={e => setFilterRules(rs => rs.map(r => r.id === rule.id ? { ...r, value2: e.target.value } : r))}
                        placeholder="إلى"
                        className="num w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                      />
                    </div>
                  ) : (
                    <input
                      type={meta?.type === "numeric" ? "number" : "text"}
                      value={rule.value}
                      onChange={e => setFilterRules(rs => rs.map(r => r.id === rule.id ? { ...r, value: e.target.value } : r))}
                      placeholder="قيمة…"
                      className="num rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                    />
                  )}

                  <button
                    onClick={() => setFilterRules(rs => rs.filter(r => r.id !== rule.id))}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-v-kill"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}

            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                const firstField = Object.keys(FILTER_FIELDS)[0];
                const m = FILTER_FIELDS[firstField];
                setFilterRules(rs => [...rs, {
                  id: `f${Date.now()}`,
                  field: firstField,
                  op: OPS_BY_TYPE[m.type][0],
                  value: "",
                }]);
              }}
            >
              <Plus className="h-3 w-3" />
              إضافة قاعدة
            </Button>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setFilterRules([])}
              >
                مسح الكل
              </Button>
            )}
          </div>
        )}

        {range !== "3d" && (
          <p className="text-[11px] text-muted-foreground">
            ℹ️ الأرقام معروضة لفترة «{RANGE_LABELS[range]}» — لكن <b>الحكم</b> محسوب دائمًا حسب
            قواعد التقييم (آخر 3 أيام + اليوم) ولا يتأثر بالفترة المختارة.
          </p>
        )}
      </CardHeader>

      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y border-border/60 bg-background/40 text-[11px] text-muted-foreground">
                <th
                  className="cursor-pointer select-none px-4 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => clickSort("name")}
                >
                  الاسم <SortIcon active={sort.key === "name"} dir={sort.dir} />
                </th>
                {activeCols.map(c => (
                  <th
                    key={c.key}
                    className="num cursor-pointer select-none whitespace-nowrap px-2 py-2 text-center font-medium hover:text-foreground"
                    onClick={() => clickSort(c.key)}
                  >
                    {c.label} <SortIcon active={sort.key === c.key} dir={sort.dir} />
                  </th>
                ))}
                <th
                  className="cursor-pointer select-none px-2 py-2 text-center font-medium hover:text-foreground"
                  onClick={() => clickSort("verdict")}
                >
                  الحكم <SortIcon active={sort.key === "verdict"} dir={sort.dir} />
                </th>
                <th className="px-4 py-2 text-right font-medium">السبب والإجراء</th>
                <th className="px-2 py-2 text-center font-medium">تحكم</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={activeCols.length + 4}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {q || verdicts.size > 0 || hasFilters
                      ? "لا توجد نتائج — امسح البحث للعودة"
                      : "لا توجد عناصر نشطة في هذا المستوى"}
                  </td>
                </tr>
              )}
              {sorted.map(r => {
                const paused = isPaused(r);
                const thumb = seriesMap.get(r.id)?.thumbnailUrl;
                const showLevelPill = isSearching;
                const canDrillDown = !isSearching && level !== "ad";
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-border/40 transition-colors hover:bg-accent/40 ${
                      canDrillDown ? "cursor-pointer" : ""
                    } ${paused ? "opacity-50" : ""}`}
                    onClick={() => {
                      if (isSearching) return;
                      if (level === "campaign") setPath({ campaign: r });
                      else if (level === "adset") setPath({ campaign: path.campaign, adset: r });
                    }}
                  >
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {(level === "ad" || (isSearching && r.level === "ad")) &&
                          (thumb ? (
                            <img
                              src={thumb}
                              alt=""
                              loading="lazy"
                              className="h-9 w-9 shrink-0 rounded-md border border-border/60 object-cover"
                            />
                          ) : (
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60">
                              <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          ))}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{r.name}</span>
                            {showLevelPill && (
                              <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-bold text-muted-foreground">
                                {LEVEL_LABELS_AR[r.level] ?? r.level}
                              </span>
                            )}
                            {!isSearching && level !== "ad" && (
                              <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            {adsManagerUrl(r) && (
                              <a
                                href={adsManagerUrl(r)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                title="افتح في Ads Manager"
                                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {paused && <span className="font-bold text-v-watch">موقوف</span>}
                            {r.learning_phase && r.level === "adset" && (
                              <span className="text-v-rescue">في مرحلة التعلم</span>
                            )}
                            {r.daily_budget !== null && (
                              <span className="num">{money(r.daily_budget)}/يوم</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {activeCols.map(c => (
                      <td
                        key={c.key}
                        className={`num whitespace-nowrap px-2 py-2.5 text-center ${cellClass(r, c.key)}`}
                      >
                        {cellValue(r, c.key)}
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-center">
                      <VerdictBadge verdict={r.verdict} rule={r.rule} />
                    </td>
                    <td className="max-w-[340px] px-4 py-2.5">
                      <p className="text-xs leading-relaxed">{r.reason_ar}</p>
                      <p className="mt-0.5 text-xs font-bold text-foreground/90">
                        ← {r.action_ar}
                      </p>
                      {r.promotion_note && (
                        <p className="mt-0.5 text-[11px] text-v-continue">{r.promotion_note}</p>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-7 gap-1 px-2 text-[11px] font-bold ${
                          paused
                            ? "border-v-continue/40 text-v-continue hover:bg-v-continue/10"
                            : "border-v-kill/40 text-v-kill hover:bg-v-kill/10"
                        }`}
                        onClick={e => {
                          e.stopPropagation();
                          setConfirmRow(r);
                        }}
                      >
                        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                        {paused ? "تشغيل" : "إيقاف"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="border-y-2 border-border/60 bg-background/60 font-bold">
                  <td className="px-4 py-2 text-xs">
                    الإجمالي ({sorted.length})
                  </td>
                  {activeCols.map(c => (
                    <td
                      key={c.key}
                      className="num whitespace-nowrap px-2 py-2 text-center text-xs"
                    >
                      {totalCell(c.key)}
                    </td>
                  ))}
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>

      {/* Pause/resume confirmation */}
      <AlertDialog open={!!confirmRow} onOpenChange={open => !open && setConfirmRow(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmRow && isPaused(confirmRow) ? "تشغيل" : "إيقاف"} «{confirmRow?.name}»؟
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {confirmRow && isPaused(confirmRow) ? (
                <>
                  سيعود للصرف بأموال حقيقية من حساب الإعلانات فورًا.
                  {isDemo && " (في الوضع التجريبي هذه محاكاة فقط)"}
                </>
              ) : (
                <>
                  سيتوقف الصرف فورًا على{" "}
                  {confirmRow?.level === "campaign"
                    ? "الحملة كلها وكل ما بداخلها"
                    : confirmRow?.level === "adset"
                      ? "المجموعة الإعلانية وكل إعلاناتها"
                      : "هذا الإعلان"}
                  . يمكنك إعادة تشغيله بزر «تشغيل» في أي وقت.
                  {isDemo && " (في الوضع التجريبي هذه محاكاة فقط)"}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={setStatus.isPending}
              className={
                confirmRow && isPaused(confirmRow)
                  ? "bg-v-continue text-black hover:bg-v-continue/90"
                  : "bg-v-kill text-white hover:bg-v-kill/90"
              }
              onClick={() => {
                if (!confirmRow) return;
                setStatus.mutate({
                  adAccountId: accountId,
                  objectId: confirmRow.id,
                  status: isPaused(confirmRow) ? "ACTIVE" : "PAUSED",
                });
              }}
            >
              {setStatus.isPending && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />}
              {confirmRow && isPaused(confirmRow) ? "نعم، شغّل" : "نعم، أوقف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active) return null;
  return dir === 1 ? (
    <ArrowUp className="inline h-3 w-3" />
  ) : (
    <ArrowDown className="inline h-3 w-3" />
  );
}
