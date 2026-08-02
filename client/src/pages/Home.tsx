import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FacebookPagesCard } from "@/components/FacebookPagesCard";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

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
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate("/auth/signin", { replace: true });
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="ml-1 h-4 w-4" />
              خروج
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-10">
        {loading ? (
          <div className="mx-auto max-w-xl space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <ConnectScreen userName={user?.name ?? ""} navigate={navigate} />
        )}
      </main>

      <footer className="border-t border-border/60 py-6">
        <div className="container flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>قرار — يشخّص ويقرّر ولا ينفّذ. التنفيذ بيدك دائمًا.</span>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-foreground">
              سياسة الخصوصية
            </a>
            <a href="/terms" className="hover:text-foreground">
              شروط الاستخدام
            </a>
          </div>
        </div>
      </footer>
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
  // Spec 013 — read stored Pages for the calling user. Gated on an
  // active connection so an expired token doesn't trigger the read.
  // The server's `meta.pages` query also enforces the same gate; the
  // client-side guard is purely an optimization to skip the round-trip.
  const pagesQuery = trpc.meta.pages.useQuery(undefined, {
    enabled: !!status.data?.connected,
  });
  const dismissPagesNotice = trpc.meta.dismissPagesNotice.useMutation({
    onSuccess: () => utils.meta.status.invalidate(),
  });

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
    onSuccess: d => {
      // Spec 013 / contracts §syncAccounts — the mutation now returns
      // `{ accounts, pagesSynced }`. `accounts` is the legacy list shape
      // consumed by the picker; `pagesSynced` is a per-call flag so a
      // Pages failure surfaces without failing the account sync.
      utils.meta.accounts.invalidate();
      utils.meta.pages.invalidate();
      toast.success("تم تحديث الحسابات");
      if (d && d.pagesSynced === false) {
        toast.warning("تعذّر تحديث قائمة الصفحات");
      }
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
      utils.meta.pages.invalidate();
      toast.success("تم فصل الحساب وحذف كل بياناتك");
    },
  });

  const realAccounts = (accounts.data ?? []).filter(a => !a.isDemo);
  const demoAccount = (accounts.data ?? []).find(a => a.isDemo);
  const pages = pagesQuery.data ?? [];
  // Demo mode: there is no Meta connection, so the Pages query never
  // fires. Defensive guard — even if it did, `pages.length === 0` makes
  // the card render nothing (FR-002). The reconnect note also checks
  // `connected` and never appears for demo users (FR-027).
  const isDemo = !!demoAccount;
  const showPagesNotice = !!status.data?.showPagesNotice && !isDemo;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">أهلًا {userName} 👋</h1>
        <p className="mt-1 text-muted-foreground">
          وصّل حساب ميتا أو جرّب الوضع التجريبي لترى المحرك يعمل.
        </p>
      </div>

      <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
        <ShieldCheck className="h-3.5 w-3.5" />
        قراءة فقط — لا يعدّل حسابك أبدًا
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
                        ? "انتهت صلاحية رمز الوصول — أعد التوصيل"
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
                          "هيتم فصل حساب ميتا وحذف كل بياناتك من قرار (رمز الوصول، الإعدادات، البيانات المحفوظة). متأكد؟"
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

      {/* Spec 013 / FR-001, FR-002 — Facebook Pages card.
          Mounted above the ad account picker. Renders nothing when the
          list is empty (FR-002); the server's gate enforces the
          "active Meta connection" precondition before this query can
          return any rows. */}
      {status.data?.connected && pages.length > 0 && (
        <FacebookPagesCard pages={pages} />
      )}

      {/* Spec 013 / FR-025 → FR-028 — one-time dismissible reconnect
          note for users whose connection lacks Page visibility (legacy
          grants, declined permissions). It does not gate any existing
          action — a user who ignores or dismisses it keeps working
          exactly as before. */}
      {showPagesNotice && (
        <Card className="border-v-watch/40 bg-v-watch/10">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-v-watch" />
            <div className="flex-1">
              <div className="font-bold">
                أعد التوصيل عشان نقدر نعرض صفحاتك على فيسبوك.
              </div>
              <div className="mt-1 text-muted-foreground">
                حسابك الحالي ما فيه صلاحية عرض الصفحات. وصّل حسابك مرة
                ثانية من زر «وصّل حساب ميتا» تحت، وبنعرض صفحاتك اللي
                تديرها فوق قائمة الحسابات الإعلانية.
              </div>
            </div>
            <button
              type="button"
              data-testid="pages-notice-dismiss"
              aria-label="إخفاء التنبيه"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => dismissPagesNotice.mutate()}
              disabled={dismissPagesNotice.isPending}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
