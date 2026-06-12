import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { VerdictBadge, RuleChip } from "@/components/Verdict";
import { cpaColorClass, ctrColorClass, money, num, pct, timeAgoAr } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { EngineRow, TopAction, Verdict } from "@shared/qarar";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  FlaskConical,
  Info,
  Loader2,
  ExternalLink,
  RefreshCw,
  Settings as SettingsIcon,
  Stethoscope,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useParams } from "wouter";

export default function Dashboard() {
  const params = useParams<{ accountId: string }>();
  const accountId = parseInt(params.accountId ?? "0");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const dash = trpc.dashboard.get.useQuery(
    { adAccountId: accountId },
    { enabled: accountId > 0, retry: false }
  );

  const refresh = trpc.dashboard.refresh.useMutation({
    onSuccess: () => {
      utils.dashboard.get.invalidate({ adAccountId: accountId });
      toast.success("تم تحديث البيانات من ميتا ✓");
    },
    onError: e => {
      if (e.message === "RECONNECT_REQUIRED") {
        toast.error("انتهت صلاحية التوكن — أعد توصيل حساب ميتا");
        navigate("/");
      } else if (e.message === "RATE_LIMITED") {
        toast.error("ميتا حدّت الطلبات مؤقتًا — جرّب بعد دقائق");
      } else {
        toast.error(`فشل التحديث: ${e.message}`);
      }
    },
  });

  // drill-down state: null = campaigns, campaignId = adsets, adsetId = ads
  const [path, setPath] = useState<{ campaign?: EngineRow; adset?: EngineRow }>({});

  if (dash.isLoading) return <DashboardSkeleton />;

  if (dash.error || !dash.data) {
    return (
      <Shell accountId={accountId}>
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-v-kill" />}
          title="حصل خطأ في تحميل اللوحة"
          desc={dash.error?.message ?? "جرّب تاني"}
          action={<Button onClick={() => dash.refetch()}>إعادة المحاولة</Button>}
        />
      </Shell>
    );
  }

  const d = dash.data;

  if (d.state === "no_funnel") {
    return (
      <Shell accountId={accountId}>
        <EmptyState
          icon={<SettingsIcon className="h-8 w-8 text-primary" />}
          title="المحرك محتاج اقتصاد الفانل الأول"
          desc="من غير AOV وROAS والـ HTO مفيش Target CPA — ومن غير Target مفيش قرارات. دقيقتان وتخلص."
          action={
            <Button asChild className="font-bold">
              <Link href={`/settings/${accountId}`}>اضبط إعدادات الفانل</Link>
            </Button>
          }
        />
      </Shell>
    );
  }

  if (d.state === "no_snapshot") {
    return (
      <Shell accountId={accountId}>
        <EmptyState
          icon={<RefreshCw className="h-8 w-8 text-primary" />}
          title="لسه مفيش بيانات متخزنة"
          desc="اعمل أول تحديث لسحب الحملات والأرقام من ميتا (أو الحساب التجريبي)."
          action={
            <Button
              onClick={() => refresh.mutate({ adAccountId: accountId })}
              disabled={refresh.isPending}
              className="font-bold"
            >
              {refresh.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              🔄 اسحب البيانات الآن
            </Button>
          }
        />
      </Shell>
    );
  }

  if (d.state === "error") {
    return (
      <Shell accountId={accountId}>
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-v-kill" />}
          title="آخر محاولة سحب فشلت"
          desc={d.error ?? "خطأ غير معروف من ميتا"}
          action={
            <Button
              onClick={() => refresh.mutate({ adAccountId: accountId })}
              disabled={refresh.isPending}
            >
              {refresh.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              حاول تاني
            </Button>
          }
        />
      </Shell>
    );
  }

  const { result, checks, isDemo, settingsReviewDue } = d;
  const accountExternalId = (d as { accountExternalId?: string }).accountExternalId;
  const { rows, summary, targets } = result;

  return (
    <Shell
      accountId={accountId}
      isDemo={isDemo}
      fetchedAt={summary.fetchedAt}
      onRefresh={() => refresh.mutate({ adAccountId: accountId })}
      refreshing={refresh.isPending}
    >
      {/* Attribution banner */}
      {summary.attributionStraddle && (
        <div className="border-b border-v-watch/30 bg-v-watch/10">
          <div className="container flex items-start gap-2 py-2 text-xs">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-v-watch" />
            <span>
              <b>تنبيه قياس:</b> فترة التقرير تشمل ما قبل وما بعد مارس 2026 — ميتا غيّرت
              نموذج الإحالة (نقرات فقط، وأُلغيت نوافذ الـ view). التحويلات{" "}
              <i>المُبلَّغ عنها</i> قد تظهر أقل 20–40% دون انخفاض حقيقي مماثل. قارن بحذر.
            </span>
          </div>
        </div>
      )}

      {settingsReviewDue && (
        <div className="border-b border-primary/20 bg-primary/5">
          <div className="container flex items-center justify-between gap-2 py-2 text-xs">
            <span>⏰ مرّ شهر على آخر مراجعة لإعدادات الفانل — راجع الأرقام.</span>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/settings/${accountId}`}>راجع الآن</Link>
            </Button>
          </div>
        </div>
      )}

      {/* Sticky summary strip */}
      <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="container flex gap-4 overflow-x-auto py-3 text-center [scrollbar-width:none]">
          <Stat label="صرف 3 أيام" value={money(summary.total_spend_3d)} />
          <Stat
            label="نزيف يومي"
            value={money(summary.bleed_daily)}
            cls={summary.bleed_daily > 0 ? "text-v-kill" : "text-v-continue"}
          />
          <Stat label="للإيقاف 🔴" value={String(summary.counts.kill)} cls="text-v-kill" />
          <Stat label="للمراقبة 🟡" value={String(summary.counts.watch)} cls="text-v-watch" />
          <Stat label="سليمة 🟢" value={String(summary.counts.continue)} cls="text-v-continue" />
          <Stat label="للإنقاذ 🛟" value={String(summary.counts.rescue)} cls="text-v-rescue" />
          <Stat label="بدري ⏳" value={String(summary.counts.too_early)} cls="text-v-early" />
          <Stat
            label="ميديان CTR ‏90ي"
            value={pct(summary.baselines.ctrLinkMedian90 ?? undefined)}
          />
          <Stat
            label="ميديان CPA ‏30ي"
            value={money(summary.baselines.cpaMedian30 ?? undefined)}
          />
          <Stat label="هدفك (CPA)" value={money(targets.unitTarget)} cls="text-primary" />
        </div>
      </div>

      <main className="container space-y-6 py-6">
        {/* قرارات النهاردة */}
        <TodayActions
          actions={summary.top_3_actions}
          checks={checks}
          accountId={accountId}
        />

        {/* Decision table with drill-down */}
        <DecisionTable
          rows={rows}
          path={path}
          setPath={setPath}
          unitTarget={targets.unitTarget}
          actId={isDemo ? null : (accountExternalId ?? null)}
        />

        {/* Deep diagnosis section */}
        <DiagnosisSection rows={rows} />
      </main>
    </Shell>
  );
}

// ============================================================
// Shell / chrome
// ============================================================

function Shell({
  children,
  accountId,
  isDemo,
  fetchedAt,
  onRefresh,
  refreshing,
}: {
  children: React.ReactNode;
  accountId: number;
  isDemo?: boolean;
  fetchedAt?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <span className="text-lg font-extrabold">قرار</span>
            </Link>
            {isDemo && (
              <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                <FlaskConical className="h-3 w-3" />
                وضع تجريبي
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {fetchedAt && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                آخر تحديث: {timeAgoAr(fetchedAt)}
              </span>
            )}
            {onRefresh && (
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="mr-1 hidden sm:inline">تحديث</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/settings/${accountId}`}>
                <SettingsIcon className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-[84px] shrink-0">
      <div className={`num text-base font-extrabold ${cls ?? ""}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="container flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-card">
          {icon}
        </div>
        <h2 className="text-xl font-extrabold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
        {action}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-border/60">
        <div className="container flex h-14 items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <div className="border-b border-border/60">
        <div className="container flex gap-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-20 shrink-0" />
          ))}
        </div>
      </div>
      <div className="container space-y-4 py-6">
        <Skeleton className="h-40 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// قرارات النهاردة — top-3 actions card
// ============================================================

function TodayActions({
  actions,
  checks,
  accountId,
}: {
  actions: TopAction[];
  checks: { actionKey: string; done: boolean }[];
  accountId: number;
}) {
  const utils = trpc.useUtils();
  const setCheck = trpc.dashboard.setCheck.useMutation({
    onMutate: async input => {
      await utils.dashboard.get.cancel({ adAccountId: accountId });
      const prev = utils.dashboard.get.getData({ adAccountId: accountId });
      utils.dashboard.get.setData({ adAccountId: accountId }, old => {
        if (!old || old.state !== "ready") return old;
        const others = old.checks.filter(c => c.actionKey !== input.actionKey);
        return {
          ...old,
          checks: [...others, { actionKey: input.actionKey, done: input.done }],
        };
      });
      return { prev };
    },
    onError: (_e, _i, ctx) => {
      if (ctx?.prev) utils.dashboard.get.setData({ adAccountId: accountId }, ctx.prev);
    },
  });

  const doneMap = useMemo(
    () => new Map(checks.map(c => [c.actionKey, c.done])),
    [checks]
  );

  return (
    <Card className="border-primary/30 bg-gradient-to-b from-primary/10 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-lg font-extrabold">
          <span>قرارات النهاردة</span>
          <span className="num text-[10px] font-normal uppercase tracking-widest text-muted-foreground">
            TOP 3 ACTIONS
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            مفيش إجراءات عاجلة النهاردة — الحساب ماشي حسب القواعد ✓
          </p>
        ) : (
          actions.map(a => {
            const done = doneMap.get(a.key) ?? false;
            return (
              <div
                key={a.key}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-opacity ${
                  done
                    ? "border-border/40 bg-background/30 opacity-55"
                    : "border-border/60 bg-background/60"
                }`}
              >
                <Checkbox
                  checked={done}
                  onCheckedChange={v =>
                    setCheck.mutate({
                      adAccountId: accountId,
                      actionKey: a.key,
                      done: v === true,
                    })
                  }
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num rounded bg-white/10 px-1.5 text-[10px] font-bold">
                      #{a.rank}
                    </span>
                    <VerdictBadge verdict={a.verdict} rule={a.rule} />
                    <span className={`truncate text-sm font-bold ${done ? "line-through" : ""}`}>
                      {a.objectName}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm ${done ? "line-through opacity-70" : ""}`}>
                    {a.action_ar}
                  </p>
                  <p className="num mt-0.5 text-[11px] text-muted-foreground" dir="rtl">
                    {a.impact_ar}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Decision table with drill-down + breadcrumb
// ============================================================

function DecisionTable({
  rows,
  path,
  setPath,
  unitTarget,
  actId,
}: {
  rows: EngineRow[];
  path: { campaign?: EngineRow; adset?: EngineRow };
  setPath: (p: { campaign?: EngineRow; adset?: EngineRow }) => void;
  unitTarget: number;
  actId: string | null;
}) {
  /** Deep link into Ads Manager scoped to the clicked object. */
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
  const level = path.adset ? "ad" : path.campaign ? "adset" : "campaign";
  const visible = useMemo(() => {
    if (level === "campaign") return rows.filter(r => r.level === "campaign");
    if (level === "adset")
      return rows.filter(r => r.level === "adset" && r.campaignId === path.campaign!.id);
    return rows.filter(r => r.level === "ad" && r.parentId === path.adset!.id);
  }, [rows, level, path]);

  const sorted = useMemo(() => {
    const order: Record<Verdict, number> = {
      kill: 0,
      rescue: 1,
      watch: 2,
      continue: 3,
      too_early: 4,
    };
    return [...visible].sort(
      (a, b) => order[a.verdict] - order[b.verdict] || b.spend_3d - a.spend_3d
    );
  }, [visible]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
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
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y border-border/60 bg-background/40 text-[11px] text-muted-foreground">
                <th className="px-4 py-2 text-right font-medium">الاسم</th>
                <th className="num px-2 py-2 text-center font-medium">Spend 3d</th>
                <th className="num px-2 py-2 text-center font-medium">CPA 3d</th>
                <th className="num px-2 py-2 text-center font-medium">Link CTR</th>
                <th className="num px-2 py-2 text-center font-medium">Conv</th>
                {level === "ad" && (
                  <th className="num px-2 py-2 text-center font-medium">% Spend</th>
                )}
                <th className="px-2 py-2 text-center font-medium">الحكم</th>
                <th className="px-4 py-2 text-right font-medium">السبب والإجراء</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    لا توجد عناصر نشطة في هذا المستوى
                  </td>
                </tr>
              )}
              {sorted.map(r => (
                <Fragment key={r.id}>
                  <tr
                    className={`border-b border-border/40 transition-colors hover:bg-accent/40 ${
                      level !== "ad" ? "cursor-pointer" : ""
                    }`}
                    onClick={() => {
                      if (level === "campaign") setPath({ campaign: r });
                      else if (level === "adset") setPath({ campaign: path.campaign, adset: r });
                    }}
                  >
                    <td className="max-w-[260px] px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.name}</span>
                        {level !== "ad" && (
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
                        {r.status !== "ACTIVE" && <span>{r.status}</span>}
                        {r.learning_phase && r.level === "adset" && (
                          <span className="text-v-rescue">Learning</span>
                        )}
                        {r.daily_budget !== null && (
                          <span className="num">{money(r.daily_budget)}/يوم</span>
                        )}
                      </div>
                    </td>
                    <td className="num px-2 py-2.5 text-center">{money(r.spend_3d)}</td>
                    <td
                      className={`num px-2 py-2.5 text-center font-bold ${cpaColorClass(r.cpa_3d, unitTarget)}`}
                    >
                      {r.conversions_3d === 0 ? "∞" : money(r.cpa_3d)}
                    </td>
                    <td
                      className={`num px-2 py-2.5 text-center font-bold ${ctrColorClass(r.ctr_link)}`}
                    >
                      {pct(r.ctr_link)}
                    </td>
                    <td className="num px-2 py-2.5 text-center">{num(r.conversions_3d)}</td>
                    {level === "ad" && (
                      <td className="num px-2 py-2.5 text-center">
                        {r.spend_share_pct !== null ? (
                          <span className={r.spend_share_pct < 10 ? "text-v-rescue" : ""}>
                            {pct(r.spend_share_pct, 0)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
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
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Deep diagnosis — ladder output for every 🔴/🟡 unit
// ============================================================

function DiagnosisSection({ rows }: { rows: EngineRow[] }) {
  const diagRows = rows.filter(
    r => (r.verdict === "kill" || r.verdict === "watch") && r.diagnosis
  );
  if (diagRows.length === 0) return null;
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4 text-primary" />
          التشخيص العميق — سُلّم الكشف
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          لكل وحدة 🔴/🟡: أول مستوى مكسور في السُلّم (CPM → Link CTR → CTR-All → LP Views →
          تحويل الصفحة → ما بعد التحويل)
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {diagRows.map(r => (
          <div
            key={r.id}
            className="flex flex-wrap items-start gap-2 rounded-lg border border-border/50 bg-background/50 p-3"
          >
            <VerdictBadge verdict={r.verdict} rule={r.rule} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{r.name}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {r.diagnosis}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
