import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { currencySymbol, money } from "@/lib/format";
import { FIELD_COPY, isFieldVisible, type FunnelArchetype } from "@/lib/settingsFields";
import { trpc } from "@/lib/trpc";
import { deriveTargets, SUPPORTED_CURRENCIES, type FunnelInputs } from "@shared/qarar";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  ChevronDown,
  Loader2,
  RotateCw,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useParams } from "wouter";

type FormState = {
  archetype: FunnelArchetype;
  // Hidden in the UI but still in state + save payload (FR-003, resolved Q3):
  liveComponent: boolean;
  offerDescription: string;
  ticketPrice: string;
  arena: FunnelInputs["arena"];
  bestInterest: string;
  geoTiers: string;
  // Visible:
  inputCurrency: string;
  aov: string;
  htoPrice: string;
  htoConversionRate: string;
  frontEndRoas: string;
  dailyBudget: string;
  marketCplBenchmark: string;
  htoUnderperforming: boolean;
};

// US11 / Spec 011 / T017 — placeholder hints only. These render as
// greyed text inside an empty input via the `placeholder` prop — never
// as form values. The legacy `DEFAULTS` seeded `aov: "47"` /
// `htoPrice: "997"` into state and rendered them as if saved; that
// shape is gone (FR-002, contracts/funnel-get.md §client contract).
export const PLACEHOLDERS = {
  aov: "47",
  htoPrice: "997",
  htoConversionRate: "4",
  frontEndRoas: "1",
} as const;

function emptyFormState(accountCurrency: string): FormState {
  return {
    archetype: "paid_lto",
    liveComponent: false,
    offerDescription: "",
    ticketPrice: "",
    arena: "broad",
    bestInterest: "",
    geoTiers: "",
    inputCurrency: accountCurrency,
    aov: "",
    htoPrice: "",
    htoConversionRate: "",
    frontEndRoas: "",
    dailyBudget: "",
    marketCplBenchmark: "",
    htoUnderperforming: false,
  };
}

function toNumber(s: string, fallback = 0): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

export default function Settings() {
  const params = useParams<{ accountId: string }>();
  const accountId = parseInt(params.accountId ?? "0");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const funnel = trpc.funnel.get.useQuery(
    { adAccountId: accountId },
    { enabled: accountId > 0 }
  );
  const accounts = trpc.meta.accounts.useQuery(undefined, { enabled: accountId > 0 });
  const accountCurrency = useMemo(
    () => accounts.data?.find(a => a.id === accountId)?.currency ?? "USD",
    [accounts.data, accountId]
  );
  const sym = currencySymbol(accountCurrency);

  // US11 / Spec 011 / T017 — initialize from EMPTY, not DEFAULTS. The
  // form's initial values come from one of three sources depending on
  // the discriminated `status` returned by `funnel.get`:
  //   "found"            → hydrate from the server row
  //   "never_configured" → empty first-time form (placeholders only)
  //   "unavailable"      → failure card; no fields rendered at all
  //
  // T017 hardening: reset account-scoped state (loadedFromServer,
  // freshStartConfirmed, and the form itself) on accountId change.
  // Without this, navigating from one account to another would leak
  // the previous account's values into the new account's form (a
  // cross-account write if the user hits Save).
  const [form, setForm] = useState<FormState>(() => emptyFormState(accountCurrency));
  const [loadedFromServer, setLoadedFromServer] = useState(false);
  // T018 — explicit user confirmation to start fresh from the failure
  // state. Save is unavailable until this flips true (FR-004).
  const [freshStartConfirmed, setFreshStartConfirmed] = useState(false);
  const lastSeenAccountId = useRef(accountId);
  useEffect(() => {
    if (lastSeenAccountId.current === accountId) return;
    lastSeenAccountId.current = accountId;
    setForm(emptyFormState(accountCurrency));
    setLoadedFromServer(false);
    setFreshStartConfirmed(false);
  }, [accountId, accountCurrency]);

  const loadStatus: "loading" | "found" | "never_configured" | "unavailable" =
    funnel.isLoading
      ? "loading"
      : funnel.isError
        ? "unavailable"
        : funnel.data?.status ?? "loading";

  useEffect(() => {
    if (!funnel.data) return;
    if (funnel.data.status === "found") {
      const s = funnel.data.settings;
      // Re-hydrate whenever the server returns data for the
      // CURRENT accountId, even if loadedFromServer is true. This
      // keeps the form in sync with the server across the
      // accountId-change reset above. The previous-account values
      // were already cleared by the reset effect.
      setForm({
        archetype: s.archetype as FunnelArchetype,
        liveComponent: s.liveComponent,
        offerDescription: s.offerDescription ?? "",
        ticketPrice: s.ticketPrice != null ? String(s.ticketPrice) : "",
        arena: s.arena,
        bestInterest: s.bestInterest ?? "",
        geoTiers: ((s.geoTiers as string[] | null) ?? []).join("، "),
        inputCurrency: s.inputCurrency ?? accountCurrency,
        aov: String(s.aov),
        htoPrice: String(s.htoPrice),
        htoConversionRate: String(s.htoConversionRate),
        frontEndRoas: String(s.frontEndRoas),
        dailyBudget: s.dailyBudget != null ? String(s.dailyBudget) : "",
        marketCplBenchmark:
          s.marketCplBenchmark != null ? String(s.marketCplBenchmark) : "",
        htoUnderperforming: s.htoUnderperforming,
      });
      setLoadedFromServer(true);
      return;
    }
    if (funnel.data.status === "never_configured") {
      setForm(prev => {
        if (prev.inputCurrency === "" && accountCurrency) {
          return { ...prev, inputCurrency: accountCurrency };
        }
        return prev;
      });
      return;
    }
    // "unavailable" — do NOT touch form state. Spec edge case
    // "unsaved edits": a failing refetch MUST NOT clear what the user
    // has already typed.
  }, [funnel.data, loadedFromServer, accountCurrency]);

  const inputs: FunnelInputs = useMemo(
    () => ({
      archetype: form.archetype,
      liveComponent: form.liveComponent,
      offerDescription: form.offerDescription || null,
      ticketPrice: form.ticketPrice ? toNumber(form.ticketPrice) : null,
      arena: form.arena,
      bestInterest: form.bestInterest || null,
      geoTiers: form.geoTiers
        ? form.geoTiers.split(/[،,]/).map(s => s.trim()).filter(Boolean)
        : null,
      aov: toNumber(form.aov),
      htoPrice: toNumber(form.htoPrice),
      htoConversionRate: toNumber(form.htoConversionRate),
      frontEndRoas: toNumber(form.frontEndRoas, 1),
      dailyBudget: form.dailyBudget ? toNumber(form.dailyBudget) : null,
      marketCplBenchmark: form.marketCplBenchmark
        ? toNumber(form.marketCplBenchmark)
        : null,
      htoUnderperforming: form.htoUnderperforming,
      inputCurrency: form.inputCurrency,
    }),
    [form]
  );

  const targetsInInput = useMemo(() => deriveTargets(inputs, null), [inputs]);
  const targetsInAccount = useMemo(
    () => deriveTargets(inputs, null, form.inputCurrency, accountCurrency),
    [inputs, form.inputCurrency, accountCurrency]
  );
  const targets = targetsInAccount;
  const showDualCurrency = form.inputCurrency !== accountCurrency;
  const valid = inputs.aov > 0 && inputs.frontEndRoas > 0;

  const save = trpc.funnel.save.useMutation({
    onSuccess: data => {
      if (data?.status === "found" && data.outcome === "freshStartRefused" && data.settings) {
        // Fresh-start save refused — server returned the existing row.
        // Hydrate and tell the user (FR-006, contracts/funnel-get.md).
        const s = data.settings;
        setForm({
          archetype: s.archetype as FunnelArchetype,
          liveComponent: s.liveComponent,
          offerDescription: s.offerDescription ?? "",
          ticketPrice: s.ticketPrice != null ? String(s.ticketPrice) : "",
          arena: s.arena,
          bestInterest: s.bestInterest ?? "",
          geoTiers: ((s.geoTiers as string[] | null) ?? []).join("، "),
          inputCurrency: s.inputCurrency ?? accountCurrency,
          aov: String(s.aov),
          htoPrice: String(s.htoPrice),
          htoConversionRate: String(s.htoConversionRate),
          frontEndRoas: String(s.frontEndRoas),
          dailyBudget: s.dailyBudget != null ? String(s.dailyBudget) : "",
          marketCplBenchmark:
            s.marketCplBenchmark != null ? String(s.marketCplBenchmark) : "",
          htoUnderperforming: s.htoUnderperforming,
        });
        setLoadedFromServer(true);
        setFreshStartConfirmed(false);
        toast.success("عُثر على إعداداتك المحفوظة — تم استرجاعها بدلًا من الكتابة فوقها.");
        return;
      }
      utils.funnel.get.invalidate({ adAccountId: accountId });
      utils.dashboard.get.invalidate({ adAccountId: accountId });
      toast.success("تم حفظ إعداداتك ✓");
      navigate(`/dashboard/${accountId}`);
    },
    onError: e => toast.error(`فشل الحفظ: ${e.message}`),
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  if (loadStatus === "loading") {
    return (
      <div className="container max-w-4xl space-y-4 py-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // US11 / Spec 011 / T018 — failure card. NO economics fields rendered
  // at all (FR-003). Save unavailable (FR-004). Simple MSA, numerals
  // LTR via `.num` (Constitution III).
  if (loadStatus === "unavailable") {
    return (
      <div className="min-h-screen pb-16">
        <header className="border-b border-border/60 bg-background/80 backdrop-blur">
          <div className="container flex h-14 items-center justify-between">
            <Link
              href={`/dashboard/${accountId}`}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="h-4 w-4" />
              رجوع للوحة
            </Link>
            <div className="font-extrabold">⚙️ إعدادات البيع والأهداف</div>
          </div>
        </header>
        <main className="container max-w-2xl py-10">
          <Card
            className="border-v-watch/40 bg-v-watch/5"
            role="alert"
            aria-live="assertive"
            data-testid="settings-failure-card"
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-v-watch">
                <AlertTriangle className="h-5 w-5" />
                تعذّر تحميل إعداداتك
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed">
                لم نتمكن من قراءة إعدادات هذا الحساب. قد يكون السبب مشكلة في
                الاتصال أو في قاعدة البيانات. إعداداتك المحفوظة موجودة — لم
                نكتب فوقها.
              </p>
              <p className="text-xs text-muted-foreground">
                إن كنت متأكدًا أن هذا الحساب لم يُهيَّأ من قبل، يمكنك البدء
                من جديد — اضغط الزر أدناه ثم أكمل الحقول.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  size="lg"
                  variant="default"
                  data-testid="settings-retry-button"
                  onClick={() => {
                    funnel.refetch();
                  }}
                >
                  <RotateCw className="ml-2 h-4 w-4" />
                  إعادة المحاولة
                </Button>
                {!freshStartConfirmed ? (
                  <Button
                    size="lg"
                    variant="outline"
                    data-testid="settings-start-fresh-button"
                    onClick={() => setFreshStartConfirmed(true)}
                  >
                    ابدأ من جديد
                  </Button>
                ) : (
                  <span className="rounded-md border border-v-watch/30 bg-background px-3 py-2 text-xs leading-relaxed">
                    اضغط الحفظ لتأكيد الإعداد الجديد. إن كان قد سبق لك الحفظ،
                    سيرفض الخادم ويُظهر لك إعداداتك الأصلية.
                  </span>
                )}
              </div>
              {freshStartConfirmed && (
                <FailureStartFreshForm
                  accountCurrency={accountCurrency}
                  form={form}
                  setForm={setForm}
                  valid={valid}
                  saving={save.isPending}
                  onSave={() =>
                    save.mutate({
                      adAccountId: accountId,
                      ...inputs,
                      freshStart: true,
                    })
                  }
                />
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const inputSym = currencySymbol(form.inputCurrency);
  const labelFor = (
    field: keyof typeof FIELD_COPY,
    symbol: string = inputSym
  ): string => FIELD_COPY[field].label.replace("{عملة}", symbol);

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <Link
            href={`/dashboard/${accountId}`}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع للوحة
          </Link>
          <div className="font-extrabold">⚙️ إعدادات البيع والأهداف</div>
        </div>
      </header>

      <main className="container grid max-w-5xl gap-6 py-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">نوع الفانل</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>{labelFor("archetype")}</Label>
                <Select
                  value={form.archetype}
                  onValueChange={v => set("archetype", v as FunnelArchetype)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid_lto">أبيع منتجًا رخيصًا أولًا ثم أعرض منتجًا غاليًا</SelectItem>
                    <SelectItem value="free_lead">أجمع بيانات عملاء مجانًا ثم أبيع منتجًا غاليًا</SelectItem>
                    <SelectItem value="direct_call">العميل يحجز مكالمة مباشرة</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{FIELD_COPY.archetype.hint}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">أرقام البيع</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>{labelFor("inputCurrency")}</Label>
                <Select
                  value={form.inputCurrency}
                  onValueChange={v => set("inputCurrency", v)}
                >
                  <SelectTrigger className="num">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map(c => (
                      <SelectItem key={c} value={c}>
                        {currencySymbol(c)} — {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showDualCurrency && (
                  <p className="rounded-md border border-v-watch/30 bg-v-watch/5 p-2 text-xs leading-relaxed text-v-watch">
                    سيتم تحويل الأسعار تلقائيًا إلى {currencySymbol(accountCurrency)} — كل ما تكتبه هنا بعملتك، والتطبيق يحسب الأهداف بعملة حسابك.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{FIELD_COPY.inputCurrency.hint}</p>
              </div>
              <NumberField
                label={labelFor("aov")}
                hint={FIELD_COPY.aov.hint}
                value={form.aov}
                placeholder={PLACEHOLDERS.aov}
                onChange={v => set("aov", v)}
              />
              <NumberField
                label={labelFor("frontEndRoas")}
                hint={FIELD_COPY.frontEndRoas.hint}
                value={form.frontEndRoas}
                placeholder={PLACEHOLDERS.frontEndRoas}
                onChange={v => set("frontEndRoas", v)}
                step="0.05"
              />
              <NumberField
                label={labelFor("htoPrice")}
                hint={FIELD_COPY.htoPrice.hint}
                value={form.htoPrice}
                placeholder={PLACEHOLDERS.htoPrice}
                onChange={v => set("htoPrice", v)}
              />
              <NumberField
                label={labelFor("htoConversionRate")}
                hint={FIELD_COPY.htoConversionRate.hint}
                value={form.htoConversionRate}
                placeholder={PLACEHOLDERS.htoConversionRate}
                onChange={v => set("htoConversionRate", v)}
                step="0.5"
              />
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">إعدادات متقدمة</CardTitle>
            </CardHeader>
            <CardContent>
              <details
                className="group rounded-lg border border-border/60 bg-background/50"
                open
              >
                <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
                  عرض الإعدادات المتقدمة
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid gap-4 px-1 pb-1 pt-3 sm:grid-cols-2">
                  {isFieldVisible("marketCplBenchmark", form.archetype) && (
                    <NumberField
                      label={labelFor("marketCplBenchmark")}
                      hint={FIELD_COPY.marketCplBenchmark.hint}
                      value={form.marketCplBenchmark}
                      onChange={v => set("marketCplBenchmark", v)}
                    />
                  )}
                  <div className="flex items-center justify-between rounded-lg border border-v-watch/30 bg-v-watch/5 p-3 sm:col-span-2">
                    <div>
                      <Label>{labelFor("htoUnderperforming")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {FIELD_COPY.htoUnderperforming.hint}
                      </p>
                    </div>
                    <Switch
                      checked={form.htoUnderperforming}
                      onCheckedChange={v => set("htoUnderperforming", v)}
                    />
                  </div>
                  <NumberField
                    label={labelFor("dailyBudget", sym)}
                    hint={FIELD_COPY.dailyBudget.hint}
                    value={form.dailyBudget}
                    onChange={v => set("dailyBudget", v)}
                  />
                </div>
              </details>
            </CardContent>
          </Card>

          <Button
            size="lg"
            className="w-full font-bold"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate({ adAccountId: accountId, ...inputs })}
            data-testid="settings-save-button"
          >
            {save.isPending ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="ml-2 h-4 w-4" />
            )}
            احفظ وارجع للوحة
          </Button>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4 text-primary" />
                أرقامك المستهدفة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!valid ? (
                <p className="text-sm text-muted-foreground">
                  اكتب متوسط قيمة الطلب والعائد الذي تريده لكي نحسب لك أهدافك.
                </p>
              ) : (
                <>
                  <div className="rounded-lg border border-primary/40 bg-primary/10 p-4 text-center">
                    <p className="text-sm font-bold">هدف تكلفة العميل</p>
                    {showDualCurrency ? (
                      <p className="num my-1 text-2xl font-extrabold text-primary">
                        {currencySymbol(form.inputCurrency)}
                        {money(
                          targetsInInput.effectiveCPA,
                          currencySymbol(form.inputCurrency)
                        ).replace(/^[^\d-]+/, "")}
                        {" = "}
                        {money(targetsInAccount.effectiveCPA, sym)}
                      </p>
                    ) : (
                      <p className="num my-1 text-3xl font-extrabold text-primary">
                        {money(targets.effectiveCPA, sym)}
                      </p>
                    )}
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      إن كلفك العميل أقل من هذا الرقم = جيد، وأكثر منه = خسارة.
                      <br />يحكم التطبيق على كل إعلان بهذا الرقم.
                    </p>
                  </div>
                  {targets.capped && (
                    <div className="flex items-start gap-2 rounded-lg border border-v-watch/40 bg-v-watch/10 p-3 text-xs">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-v-watch" />
                      <span>
                        <b>تنبيه:</b> أرقامك تسمح بدفع أكثر للعميل، لكننا خفّضنا الهدف
                        لتبقى رابحًا في المجمل. إن أردت هامشًا أوسع: ارفع متوسط قيمة
                        الطلب أو حسّن نسبة شراء المنتج الغالي.
                      </span>
                    </div>
                  )}
                  {form.archetype === "free_lead" && targets.cplCeiling !== null && (
                    <TargetRow
                      label="أقصى تكلفة للعميل المحتمل"
                      sub="إن دفعت أكثر من ذلك للعميل المحتمل الواحد فأنت تخسر"
                      value={
                        showDualCurrency
                          ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.cplCeiling, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.cplCeiling, sym)}`
                          : money(targets.cplCeiling, sym)
                      }
                    />
                  )}
                  <details className="group rounded-lg border border-border/60 bg-background/50">
                    <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
                      كيف حسبنا هذا الرقم؟
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="space-y-2 px-3 pb-3">
                      <TargetRow
                        label="تكلفة العميل من البيع الأول"
                        sub="متوسط قيمة الطلب ÷ العائد المطلوب"
                        value={
                          showDualCurrency
                            ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.rawTargetCPA, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.rawTargetCPA, sym)}`
                            : money(targets.rawTargetCPA, sym)
                        }
                      />
                      <TargetRow
                        label="القيمة الكاملة للعميل"
                        sub="البيع الأول + نصيبه من المنتج الغالي"
                        value={
                          showDualCurrency
                            ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.fullBuyerValue, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.fullBuyerValue, sym)}`
                            : money(targets.fullBuyerValue, sym)
                        }
                      />
                      <TargetRow
                        label="أقصى تكلفة مسموحة"
                        sub="نصف القيمة الكاملة — لتربح الضعف دائمًا"
                        value={
                          showDualCurrency
                            ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.maxCPA, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.maxCPA, sym)}`
                            : money(targets.maxCPA, sym)
                        }
                      />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        هدفك = الأصغر بين الرقم الأول والثالث، لنبقى دائمًا في الجانب الآمن.
                      </p>
                    </div>
                  </details>
                  {inputs.dailyBudget != null && inputs.dailyBudget > 0 && (
                    <p className="rounded-lg bg-background/60 p-2 text-[11px] text-muted-foreground">
                      ميزانية مقترحة لكل مجموعة إعلانية جديدة:{" "}
                      <span className="num">
                        {money(targets.effectiveCPA, sym)}–
                        {money(1.5 * targets.effectiveCPA, sym)}
                      </span>{" "}
                      في اليوم
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  step,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step={step ?? "1"}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="num"
        dir="ltr"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TargetRow({
  label,
  sub,
  value,
}: {
  label: string;
  sub: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/50 px-3 py-2">
      <div>
        <div className="num text-xs font-bold">{label}</div>
        <div className="text-[10px] text-muted-foreground">{sub}</div>
      </div>
      <div className="num text-base font-bold">{value}</div>
    </div>
  );
}

/**
 * US11 / Spec 011 / T018 — the "start fresh" form rendered under the
 * failure card. Only path that can produce a Save control in the
 * unavailable state (FR-005). Always sends `freshStart: true` so the
 * server's write-time guard (FR-006) refuses the save if a row exists.
 */
function FailureStartFreshForm({
  accountCurrency,
  form,
  setForm,
  valid,
  saving,
  onSave,
}: {
  accountCurrency: string;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  valid: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));
  const inputSym = currencySymbol(form.inputCurrency || accountCurrency);
  const labelFor = (
    field: keyof typeof FIELD_COPY,
    symbol: string = inputSym
  ): string => FIELD_COPY[field].label.replace("{عملة}", symbol);

  return (
    <div className="mt-6 space-y-4 border-t border-v-watch/20 pt-6">
      <p className="text-xs leading-relaxed text-muted-foreground">
        ابدأ بإدخال أرقامك — الحقول الفارغة لا تُحفظ.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label={labelFor("aov")}
          value={form.aov}
          placeholder={PLACEHOLDERS.aov}
          onChange={v => set("aov", v)}
        />
        <NumberField
          label={labelFor("htoPrice")}
          value={form.htoPrice}
          placeholder={PLACEHOLDERS.htoPrice}
          onChange={v => set("htoPrice", v)}
        />
        <NumberField
          label={labelFor("frontEndRoas")}
          value={form.frontEndRoas}
          placeholder={PLACEHOLDERS.frontEndRoas}
          onChange={v => set("frontEndRoas", v)}
          step="0.05"
        />
        <NumberField
          label={labelFor("htoConversionRate")}
          value={form.htoConversionRate}
          placeholder={PLACEHOLDERS.htoConversionRate}
          onChange={v => set("htoConversionRate", v)}
          step="0.5"
        />
      </div>
      <Button
        size="lg"
        className="w-full font-bold"
        disabled={!valid || saving}
        onClick={onSave}
        data-testid="settings-fresh-start-save"
      >
        {saving ? (
          <Loader2 className="ml-2 h-4 w-4 animate-spin" />
        ) : (
          <Save className="ml-2 h-4 w-4" />
        )}
        ابدأ الإعداد الجديد
      </Button>
    </div>
  );
}