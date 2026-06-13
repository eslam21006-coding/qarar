import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
        <Activity className="h-5 w-5 text-primary" />
      </div>
      <div className="leading-tight">
        <div className="text-xl font-extrabold tracking-tight">قرار</div>
        <div className="num text-[9px] uppercase tracking-widest text-muted-foreground">
          ADS DECISION ENGINE
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();

  // surface OAuth callback result from query param
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const meta = p.get("meta");
    if (!meta) return;
    if (meta === "connected") toast.success("تم توصيل حساب ميتا بنجاح ✓");
    else if (meta === "denied") toast.error("تم رفض الإذن — لازم توافق على صلاحية ads_read");
    else toast.error("فشل توصيل الحساب — حاول مرة أخرى");
    window.history.replaceState({}, "", "/");
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <Button variant="ghost" size="sm" onClick={() => logout()}>
                <LogOut className="ml-1 h-4 w-4" />
                خروج
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container py-10">
        {loading ? (
          <div className="mx-auto max-w-xl space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !isAuthenticated ? (
          <Landing />
        ) : (
          <ConnectScreen userName={user?.name ?? ""} navigate={navigate} />
        )}
      </main>

      <footer className="border-t border-border/60 py-6">
        <div className="container flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>قرار — يشخّص ويقرّر ولا ينفّذ. التنفيذ بيدك دائمًا.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">
              سياسة الخصوصية
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              شروط الاستخدام
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Landing() {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-2">
      <div className="space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
          <ShieldCheck className="h-3.5 w-3.5" />
          قراءة فقط — لا يعدّل حسابك أبدًا
        </div>
        <h1 className="text-4xl font-extrabold leading-tight lg:text-5xl">
          لن تحتار بعد اليوم أمام
          <span className="text-primary"> Ads Manager</span>
        </h1>
        <p className="text-lg leading-relaxed text-muted-foreground">
          «قرار» يتصل بحساب إعلانات ميتا الخاص بك، ويفحص كل حملة ومجموعة وإعلان
          وفق قواعد ثابتة مكتوبة — ثم يعطيك الحكم:
          <span className="font-bold text-foreground"> 🔴 أوقف · 🟡 راقب · 🟢 واصل · 🛟 أنقذه · ⏳ مبكّر</span>
          — مع رقم القاعدة والسبب والإجراء بالعربي.
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-v-continue" />
            محرك قرارات حتمي 100% — صفر ذكاء اصطناعي، صفر اجتهاد
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-v-continue" />
            بوابات بيانات صارمة — لا حكم على بيانات ناقصة
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-v-continue" />
            «قرارات النهاردة» — أعلى 3 إجراءات أثرًا كل يوم
          </li>
        </ul>
        <Button size="lg" className="text-base font-bold" asChild>
          <a href={getLoginUrl()}>
            ابدأ الآن
            <ArrowLeft className="mr-2 h-4 w-4" />
          </a>
        </Button>
      </div>
      <Card className="border-border/60 bg-card/60">
        <CardContent className="space-y-3 p-6" dir="rtl">
          <div className="num mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            LIVE PREVIEW
          </div>
          {[
            { e: "🔴", n: "أوقفه — لا أحد يضغط على الإعلان", r: "أوقف", c: "text-v-kill" },
            { e: "🟢", n: "واصل — العميل يكلفك أقل من هدفك", r: "واصل", c: "text-v-continue" },
            { e: "🟡", n: "راقب — الإعلان جيد لكن صفحتك تخسّرك", r: "راقب", c: "text-v-watch" },
            { e: "🛟", n: "أنقذه — إعلان جيد لم يأخذ فرصته", r: "أنقذ", c: "text-v-rescue" },
            { e: "⏳", n: "انتظر — ما زال مبكّرًا على الحكم", r: "انتظر", c: "text-v-early" },
          ].map(x => (
            <div
              key={x.r}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2.5"
            >
              <span className="flex items-center gap-2 text-sm">
                <span>{x.e}</span>
                <span className="text-foreground/90">{x.n}</span>
              </span>
              <span className={`num text-xs font-bold ${x.c}`}>{x.r}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectScreen({
  userName,
  navigate,
}: {
  userName: string;
  navigate: (to: string) => void;
}) {
  const utils = trpc.useUtils();
  const status = trpc.meta.status.useQuery();
  const accounts = trpc.meta.accounts.useQuery();

  const connectUrl = trpc.meta.connectUrl.useMutation({
    onSuccess: d => {
      window.location.href = d.url;
    },
    onError: e => {
      if (e.message === "APP_NOT_CONFIGURED") {
        toast.error("مفاتيح تطبيق فيسبوك غير مضبوطة — استخدم الوضع التجريبي أو اضبط FACEBOOK_APP_ID/SECRET");
      } else toast.error("تعذر بدء التوصيل");
    },
  });
  const syncAccounts = trpc.meta.syncAccounts.useMutation({
    onSuccess: () => {
      utils.meta.accounts.invalidate();
      toast.success("تم تحديث قائمة الحسابات");
    },
    onError: () => toast.error("فشل تحديث الحسابات — جرّب إعادة التوصيل"),
  });
  const selectAccount = trpc.meta.selectAccount.useMutation({
    onSuccess: () => utils.meta.accounts.invalidate(),
  });
  const enableDemo = trpc.meta.enableDemo.useMutation({
    onSuccess: d => {
      utils.meta.accounts.invalidate();
      navigate(`/dashboard/${d.accountId}`);
    },
  });
  const disconnect = trpc.meta.disconnect.useMutation({
    onSuccess: () => {
      utils.meta.status.invalidate();
      utils.meta.accounts.invalidate();
      toast.success("تم فصل الحساب وحذف كل بياناتك");
    },
  });

  const realAccounts = (accounts.data ?? []).filter(a => !a.isDemo);
  const demoAccount = (accounts.data ?? []).find(a => a.isDemo);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">أهلًا {userName} 👋</h1>
        <p className="mt-1 text-muted-foreground">
          وصّل حساب ميتا أو جرّب الوضع التجريبي لترى المحرك يعمل.
        </p>
      </div>

      {/* Meta connection card */}
      <Card className="border-border/60">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1877F2]/15 ring-1 ring-[#1877F2]/40">
                <Link2 className="h-5 w-5 text-[#4293f5]" />
              </div>
              <div>
                <div className="font-bold">حساب ميتا (فيسبوك/إنستجرام)</div>
                <div className="text-sm text-muted-foreground">
                  {status.isLoading
                    ? "جارٍ الفحص…"
                    : status.data?.connected
                      ? `متوصل: ${status.data.fbUserName ?? ""}`
                      : status.data?.needsReauth
                        ? "انتهت صلاحية التوكن — أعد التوصيل"
                        : "غير متوصل — صلاحية القراءة فقط (ads_read)"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {status.data?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncAccounts.mutate()}
                    disabled={syncAccounts.isPending}
                  >
                    {syncAccounts.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    <span className="mr-1">تحديث الحسابات</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-v-kill hover:text-v-kill"
                    onClick={() => {
                      if (
                        window.confirm(
                          "هيتم فصل حساب ميتا وحذف كل بياناتك من قرار (التوكن، الإعدادات، الكاش). متأكد؟"
                        )
                      )
                        disconnect.mutate();
                    }}
                    disabled={disconnect.isPending}
                  >
                    <Trash2 className="ml-1 h-4 w-4" />
                    افصل واحذف بياناتي
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => connectUrl.mutate()}
                  disabled={connectUrl.isPending || status.isLoading}
                  className="font-bold"
                >
                  {connectUrl.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
                  وصّل حساب ميتا
                </Button>
              )}
            </div>
          </div>

          {status.data && !status.data.configured && !status.data.connected && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-v-watch/30 bg-v-watch/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-v-watch" />
              <div>
                <span className="font-bold">مفاتيح تطبيق فيسبوك غير مضبوطة بعد.</span>{" "}
                صاحب التطبيق يحتاج يضيف FACEBOOK_APP_ID و FACEBOOK_APP_SECRET (من
                developers.facebook.com) لتفعيل التوصيل الحقيقي. لحد ما يحصل — جرّب
                الوضع التجريبي تحت 👇
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Real accounts picker */}
      {realAccounts.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-6">
            <h2 className="mb-4 font-bold">اختر الحساب الإعلاني الذي تريد مراقبته</h2>
            <div className="space-y-2">
              {realAccounts.map(a => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-background/50 px-4 py-3"
                >
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="num text-xs text-muted-foreground">
                      {a.accountId} · {a.currency}
                      {a.accountStatus !== 1 && " · غير نشط"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.selected ? (
                      <>
                        <Button size="sm" onClick={() => navigate(`/dashboard/${a.id}`)}>
                          افتح اللوحة
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => selectAccount.mutate({ id: a.id, selected: false })}
                        >
                          إلغاء
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => selectAccount.mutate({ id: a.id, selected: true })}
                      >
                        راقب هذا الحساب
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Demo mode */}
      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
              <FlaskConical className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-bold">الوضع التجريبي</div>
              <div className="text-sm text-muted-foreground">
                حساب تجريبي واقعي يغطي كل الأحكام — جرّب المحرك دون توصيل حسابك.
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-primary/40 font-bold text-primary hover:bg-primary/10"
            onClick={() => (demoAccount ? navigate(`/dashboard/${demoAccount.id}`) : enableDemo.mutate())}
            disabled={enableDemo.isPending}
          >
            {enableDemo.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
            {demoAccount ? "افتح الحساب التجريبي" : "فعّل الوضع التجريبي"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
