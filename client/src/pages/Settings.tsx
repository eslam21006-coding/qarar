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
import { AlertTriangle, ArrowRight, Calculator, ChevronDown, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

const DEFAULTS: FormState = {
  archetype: "paid_lto",
  liveComponent: false,
  offerDescription: "",
  ticketPrice: "",
  arena: "broad",
  bestInterest: "",
  geoTiers: "",
  inputCurrency: "",
  aov: "47",
  htoPrice: "997",
  htoConversionRate: "4",
  frontEndRoas: "1",
  dailyBudget: "",
  marketCplBenchmark: "",
  htoUnderperforming: false,
};

function toNumber(s: string, fallback = 0): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

export default function Settings() {
  const params = useParams<{ accountId: string }>();
  const accountId = parseInt(params.accountId ?? "0");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const funnel = trpc.funnel.get.useQuery({ adAccountId: accountId }, { enabled: accountId > 0 });
  // Hotfix T2: pull the account's currency from the connected account list
  // (the summary is also a source, but it's only available after the user
  // saves funnel settings — accounts is always available per-user).
  const accounts = trpc.meta.accounts.useQuery(undefined, { enabled: accountId > 0 });
  const accountCurrency = useMemo(
    () => accounts.data?.find(a => a.id === accountId)?.currency ?? "USD",
    [accounts.data, accountId]
  );
  const sym = currencySymbol(accountCurrency);
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [loadedFromServer, setLoadedFromServer] = useState(false);

  useEffect(() => {
    const s = funnel.data?.settings;
    // Path A — no saved settings row yet. As soon as the account currency
    // is known (meta.accounts resolved), default inputCurrency to it. This
    // covers first-time non-USD accounts where funnel.get returns null.
    if (!s) {
      if (accountCurrency && form.inputCurrency === "") {
        setForm(prev => ({ ...prev, inputCurrency: accountCurrency }));
      }
      return;
    }
    // Path B — saved settings row. Hydrate once, but ALWAYS use the saved
    // inputCurrency when present (don't overwrite it with the account
    // currency). Re-run if accountCurrency arrives later so the fallback
    // uses the real account currency, not the empty placeholder.
    if (s && !loadedFromServer && accountCurrency) {
      setForm({
        archetype: s.archetype as FunnelArchetype,
        // Hidden — carried through for the unchanged save payload (FR-003).
        liveComponent: s.liveComponent,
        offerDescription: s.offerDescription ?? "",
        ticketPrice: s.ticketPrice != null ? String(s.ticketPrice) : "",
        arena: s.arena,
        bestInterest: s.bestInterest ?? "",
        geoTiers: ((s.geoTiers as string[] | null) ?? []).join("، "),
        // Visible:
        inputCurrency: (s as { inputCurrency?: string | null }).inputCurrency ?? accountCurrency,
        aov: String(s.aov),
        htoPrice: String(s.htoPrice),
        htoConversionRate: String(s.htoConversionRate),
        frontEndRoas: String(s.frontEndRoas),
        dailyBudget: s.dailyBudget != null && s.dailyBudget > 0 ? String(s.dailyBudget) : "",
        marketCplBenchmark: s.marketCplBenchmark != null ? String(s.marketCplBenchmark) : "",
        htoUnderperforming: s.htoUnderperforming,
      });
      setLoadedFromServer(true);
    }
  }, [funnel.data, loadedFromServer, accountCurrency, form.inputCurrency]);

  const inputs: FunnelInputs = useMemo(
    () => ({
      archetype: form.archetype,
      // Hidden fields ride along untouched — FR-003 / resolved Q3.
      liveComponent: form.liveComponent,
      offerDescription: form.offerDescription || null,
      ticketPrice: form.ticketPrice ? toNumber(form.ticketPrice) : null,
      arena: form.arena,
      bestInterest: form.bestInterest || null,
      geoTiers: form.geoTiers
        ? form.geoTiers.split(/[،,]/).map(s => s.trim()).filter(Boolean)
        : null,
      // Visible:
      aov: toNumber(form.aov),
      htoPrice: toNumber(form.htoPrice),
      htoConversionRate: toNumber(form.htoConversionRate),
      frontEndRoas: toNumber(form.frontEndRoas, 1),
      dailyBudget: form.dailyBudget ? toNumber(form.dailyBudget) : null,
      marketCplBenchmark: form.marketCplBenchmark ? toNumber(form.marketCplBenchmark) : null,
      htoUnderperforming: form.htoUnderperforming,
      inputCurrency: form.inputCurrency,
    }),
    [form]
  );

  // live derived targets — pure shared function, no round-trip
  // Batch 2 / ISSUE-009 — compute both views from the same FunnelInputs so
  // the user can verify the conversion (research R5):
  //   targetsInInput   = deriveTargets(inputs, null) — no conversion ⇒ input currency
  //   targetsInAccount = deriveTargets(inputs, null, inputCurrency, accountCurrency)
  const targetsInInput = useMemo(() => deriveTargets(inputs, null), [inputs]);
  const targetsInAccount = useMemo(
    () => deriveTargets(inputs, null, form.inputCurrency, accountCurrency),
    [inputs, form.inputCurrency, accountCurrency]
  );
  const targets = targetsInAccount;
  const showDualCurrency = form.inputCurrency !== accountCurrency;
  const valid = inputs.aov > 0 && inputs.frontEndRoas > 0;

  const save = trpc.funnel.save.useMutation({
    onSuccess: () => {
      utils.funnel.get.invalidate({ adAccountId: accountId });
      utils.dashboard.get.invalidate({ adAccountId: accountId });
      toast.success("تم حفظ إعداداتك ✓");
      navigate(`/dashboard/${accountId}`);
    },
    onError: e => toast.error(`فشل الحفظ: ${e.message}`),
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  if (funnel.isLoading) {
    return (
      <div className="container max-w-4xl space-y-4 py-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Localised aria-currency-style hint substitution: visible-field labels that
  // contain `{عملة}` are rendered with the user-selected input-currency symbol.
  const inputSym = currencySymbol(form.inputCurrency);
  const labelFor = (field: keyof typeof FIELD_COPY): string =>
    FIELD_COPY[field].label.replace("{عملة}", inputSym);

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
          {/* Section: نوع الفانل — archetype only (FR-009). */}
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

          {/* Section: أرقام البيع — currency selector + selling numbers (FR-009). */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">أرقام البيع</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {/* Batch 2 / ISSUE-009 — price-currency selector (FR-007).
                  Positioned at the top of the selling-numbers section,
                  preserved verbatim from Batch 2. */}
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
                onChange={v => set("aov", v)}
              />
              <NumberField
                label={labelFor("frontEndRoas")}
                hint={FIELD_COPY.frontEndRoas.hint}
                value={form.frontEndRoas}
                onChange={v => set("frontEndRoas", v)}
                step="0.05"
              />
              <NumberField
                label={labelFor("htoPrice")}
                hint={FIELD_COPY.htoPrice.hint}
                value={form.htoPrice}
                onChange={v => set("htoPrice", v)}
              />
              <NumberField
                label={labelFor("htoConversionRate")}
                hint={FIELD_COPY.htoConversionRate.hint}
                value={form.htoConversionRate}
                onChange={v => set("htoConversionRate", v)}
                step="0.5"
              />
            </CardContent>
          </Card>

          {/* Section: إعدادات متقدمة — collapsible, expanded by default (FR-009,
              Q4). Holds the engine-used marketCplBenchmark / htoUnderperforming
              so they are never hidden behind a click. */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">إعدادات متقدمة</CardTitle>
            </CardHeader>
            <CardContent>
              <details className="group rounded-lg border border-border/60 bg-background/50" open>
                <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
                  عرض الإعدادات المتقدمة
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid gap-4 px-1 pb-1 pt-3 sm:grid-cols-2">
                  {/* Visible only when archetype === "free_lead" (FR-011). */}
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
                    label={labelFor("dailyBudget").replace("{عملة}", sym)}
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
          >
            {save.isPending ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="ml-2 h-4 w-4" />
            )}
            احفظ وارجع للوحة
          </Button>
        </div>

        {/* Derived targets card — live (FR-008, preserved from Batch 2). */}
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
                  {/* The one number that matters — Batch 2 / ISSUE-009 shows
                      both currencies when they differ so the user can verify
                      the conversion (FR-014). */}
                  <div className="rounded-lg border border-primary/40 bg-primary/10 p-4 text-center">
                    <p className="text-sm font-bold">هدف تكلفة العميل</p>
                    {showDualCurrency ? (
                      <p className="num my-1 text-2xl font-extrabold text-primary">
                        {currencySymbol(form.inputCurrency)}{money(targetsInInput.effectiveCPA, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")}
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
                      value={showDualCurrency
                        ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.cplCeiling, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.cplCeiling, sym)}`
                        : money(targets.cplCeiling, sym)}
                    />
                  )}

                  {/* How we computed it — collapsed by default */}
                  <details className="group rounded-lg border border-border/60 bg-background/50">
                    <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
                      كيف حسبنا هذا الرقم؟
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="space-y-2 px-3 pb-3">
                      <TargetRow
                        label="تكلفة العميل من البيع الأول"
                        sub="متوسط قيمة الطلب ÷ العائد المطلوب"
                        value={showDualCurrency
                          ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.rawTargetCPA, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.rawTargetCPA, sym)}`
                          : money(targets.rawTargetCPA, sym)}
                      />
                      <TargetRow
                        label="القيمة الكاملة للعميل"
                        sub="البيع الأول + نصيبه من المنتج الغالي"
                        value={showDualCurrency
                          ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.fullBuyerValue, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.fullBuyerValue, sym)}`
                          : money(targets.fullBuyerValue, sym)}
                      />
                      <TargetRow
                        label="أقصى تكلفة مسموحة"
                        sub="نصف القيمة الكاملة — لتربح الضعف دائمًا"
                        value={showDualCurrency
                          ? `${currencySymbol(form.inputCurrency)}${money(targetsInInput.maxCPA, currencySymbol(form.inputCurrency)).replace(/^[^\d-]+/, "")} = ${money(targetsInAccount.maxCPA, sym)}`
                          : money(targets.maxCPA, sym)}
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
                        {money(targets.effectiveCPA, sym)}–{money(1.5 * targets.effectiveCPA, sym)}
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
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
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
        onChange={e => onChange(e.target.value)}
        className="num"
        dir="ltr"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TargetRow({ label, sub, value }: { label: string; sub: string; value: string }) {
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
