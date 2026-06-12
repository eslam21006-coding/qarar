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
import { Textarea } from "@/components/ui/textarea";
import { money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { deriveTargets, type FunnelInputs } from "@shared/qarar";
import { AlertTriangle, ArrowRight, Calculator, ChevronDown, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useParams } from "wouter";

type FormState = {
  archetype: FunnelInputs["archetype"];
  liveComponent: boolean;
  offerDescription: string;
  ticketPrice: string;
  aov: string;
  htoPrice: string;
  htoConversionRate: string;
  frontEndRoas: string;
  dailyBudget: string;
  marketCplBenchmark: string;
  htoUnderperforming: boolean;
  arena: FunnelInputs["arena"];
  bestInterest: string;
  geoTiers: string;
};

const DEFAULTS: FormState = {
  archetype: "paid_lto",
  liveComponent: false,
  offerDescription: "",
  ticketPrice: "",
  aov: "47",
  htoPrice: "997",
  htoConversionRate: "4",
  frontEndRoas: "1",
  dailyBudget: "",
  marketCplBenchmark: "",
  htoUnderperforming: false,
  arena: "broad",
  bestInterest: "",
  geoTiers: "",
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
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [loadedFromServer, setLoadedFromServer] = useState(false);

  useEffect(() => {
    const s = funnel.data?.settings;
    if (s && !loadedFromServer) {
      setForm({
        archetype: s.archetype,
        liveComponent: s.liveComponent,
        offerDescription: s.offerDescription ?? "",
        ticketPrice: s.ticketPrice != null ? String(s.ticketPrice) : "",
        aov: String(s.aov),
        htoPrice: String(s.htoPrice),
        htoConversionRate: String(s.htoConversionRate),
        frontEndRoas: String(s.frontEndRoas),
        dailyBudget: s.dailyBudget != null && s.dailyBudget > 0 ? String(s.dailyBudget) : "",
        marketCplBenchmark: s.marketCplBenchmark != null ? String(s.marketCplBenchmark) : "",
        htoUnderperforming: s.htoUnderperforming,
        arena: s.arena,
        bestInterest: s.bestInterest ?? "",
        geoTiers: ((s.geoTiers as string[] | null) ?? []).join("، "),
      });
      setLoadedFromServer(true);
    }
  }, [funnel.data, loadedFromServer]);

  const inputs: FunnelInputs = useMemo(
    () => ({
      archetype: form.archetype,
      liveComponent: form.liveComponent,
      offerDescription: form.offerDescription || null,
      ticketPrice: form.ticketPrice ? toNumber(form.ticketPrice) : null,
      aov: toNumber(form.aov),
      htoPrice: toNumber(form.htoPrice),
      htoConversionRate: toNumber(form.htoConversionRate),
      frontEndRoas: toNumber(form.frontEndRoas, 1),
      dailyBudget: form.dailyBudget ? toNumber(form.dailyBudget) : null,
      marketCplBenchmark: form.marketCplBenchmark ? toNumber(form.marketCplBenchmark) : null,
      htoUnderperforming: form.htoUnderperforming,
      arena: form.arena,
      bestInterest: form.bestInterest || null,
      geoTiers: form.geoTiers
        ? form.geoTiers.split(/[،,]/).map(s => s.trim()).filter(Boolean)
        : null,
    }),
    [form]
  );

  // live derived targets — pure shared function, no round-trip
  const targets = useMemo(() => deriveTargets(inputs, null), [inputs]);
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
              <CardTitle className="text-base">طريقة البيع والعرض</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>كيف تبيع؟</Label>
                <Select
                  value={form.archetype}
                  onValueChange={v => set("archetype", v as FunnelInputs["archetype"])}
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
              </div>
              <div className="space-y-2">
                <Label>طريقة الاستهداف</Label>
                <Select value={form.arena} onValueChange={v => set("arena", v as FunnelInputs["arena"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="broad">استهداف واسع (بدون اهتمامات)</SelectItem>
                    <SelectItem value="interests">استهداف بالاهتمامات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 sm:col-span-2">
                <div>
                  <Label>هل تقدم بثًا مباشرًا أو ورشة مباشرة؟</Label>
                  <p className="text-xs text-muted-foreground">يساعدنا فقط في فهم توقيت أرقامك</p>
                </div>
                <Switch
                  checked={form.liveComponent}
                  onCheckedChange={v => set("liveComponent", v)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>وصف العرض (اختياري)</Label>
                <Textarea
                  value={form.offerDescription}
                  onChange={e => set("offerDescription", e.target.value)}
                  placeholder="مثال: ورشة 3 أيام بـ $47 ثم برنامج $997"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">أرقام البيع لديك</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="متوسط قيمة الطلب الواحد ($)"
                hint="كم يدفع العميل في المتوسط عند أول شراء؟"
                value={form.aov}
                onChange={v => set("aov", v)}
              />
              <Field
                label="كم ضعفًا تريد استرداده من الإعلان؟"
                hint="1 = تسترد أموالك بالضبط · أقل من 1 = تقبل خسارة بسيطة مقابل كسب عملاء"
                value={form.frontEndRoas}
                onChange={v => set("frontEndRoas", v)}
                step="0.05"
              />
              <Field
                label="سعر المنتج الغالي ($)"
                hint="العرض الكبير الذي تبيعه بعد المنتج الرخيص"
                value={form.htoPrice}
                onChange={v => set("htoPrice", v)}
              />
              <Field
                label="من كل 100 مشترٍ، كم واحدًا يشتري الغالي؟ (%)"
                hint="مثال: 4 تعني 4 من كل 100"
                value={form.htoConversionRate}
                onChange={v => set("htoConversionRate", v)}
                step="0.5"
              />
              <Field
                label="ميزانيتك اليومية للإعلانات ($) — اختياري"
                value={form.dailyBudget}
                onChange={v => set("dailyBudget", v)}
              />
              {form.archetype === "free_lead" && (
                <Field
                  label="سعر العميل المحتمل المعتاد في مجالك ($) — اختياري"
                  hint="إن كان حسابك جديدًا ولا يوجد تاريخ نقيس عليه"
                  value={form.marketCplBenchmark}
                  onChange={v => set("marketCplBenchmark", v)}
                />
              )}
              <div className="flex items-center justify-between rounded-lg border border-v-watch/30 bg-v-watch/5 p-3 sm:col-span-2">
                <div>
                  <Label>البيع الأول جيد، لكن المنتج الغالي لا يُباع؟</Label>
                  <p className="text-xs text-muted-foreground">
                    فعّل هذا الخيار إن كان الناس يشترون الرخيص ولا يكملون للغالي — سينبهك التطبيق إلى أن المشكلة ليست في الإعلانات نفسها
                  </p>
                </div>
                <Switch
                  checked={form.htoUnderperforming}
                  onCheckedChange={v => set("htoUnderperforming", v)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">الاستهداف (اختياري)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>أنجح اهتمام جرّبته سابقًا</Label>
                <Input
                  value={form.bestInterest}
                  onChange={e => set("bestInterest", e.target.value)}
                  placeholder="مثال: Tony Robbins"
                />
              </div>
              <div className="space-y-2">
                <Label>الدول/المستويات الجغرافية</Label>
                <Input
                  value={form.geoTiers}
                  onChange={e => set("geoTiers", e.target.value)}
                  placeholder="مثال: السعودية، الإمارات، مصر"
                />
              </div>
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

        {/* Derived targets card — live */}
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
                  {/* The one number that matters */}
                  <div className="rounded-lg border border-primary/40 bg-primary/10 p-4 text-center">
                    <p className="text-sm font-bold">هدف تكلفة العميل</p>
                    <p className="num my-1 text-3xl font-extrabold text-primary">
                      {money(targets.effectiveCPA)}
                    </p>
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
                      value={money(targets.cplCeiling)}
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
                        value={money(targets.rawTargetCPA)}
                      />
                      <TargetRow
                        label="القيمة الكاملة للعميل"
                        sub="البيع الأول + نصيبه من المنتج الغالي"
                        value={money(targets.fullBuyerValue)}
                      />
                      <TargetRow
                        label="أقصى تكلفة مسموحة"
                        sub="نصف القيمة الكاملة — لتربح الضعف دائمًا"
                        value={money(targets.maxCPA)}
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
                        {money(targets.effectiveCPA)}–{money(1.5 * targets.effectiveCPA)}
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

function Field({
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
