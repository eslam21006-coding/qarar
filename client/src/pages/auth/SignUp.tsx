import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSession, signIn, signUp } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

const MSG_DUPLICATE = "هذا البريد الإلكتروني مسجّل بالفعل";
const MSG_GENERIC = "حدث خطأ، حاول مرة أخرى";

const VERDICT_ROWS = [
  {
    dot: "🟢",
    entity: "حملة — عروض الصيف",
    action: "كمّل",
    actionColor: "#4ade80",
    cost: "٤٢ ر.س/عميل",
  },
  {
    dot: "🔴",
    entity: "مجموعة — اهتمامات عامة",
    action: "اقفل",
    actionColor: "#f87171",
    cost: "١٨٧ ر.س/عميل",
  },
  {
    dot: "🟡",
    entity: "إعلان — فيديو المنتج",
    action: "راقب",
    actionColor: "#facc15",
    cost: "٩١ ر.س/عميل",
  },
  {
    dot: "🛟",
    entity: "إعلان — صورة ثابتة",
    action: "أنقذ",
    actionColor: "#38bdf8",
    cost: "١٣٥ ر.س/عميل",
  },
];

const FEATURES = [
  "٣٩ قاعدة حتمية لتقييم كل إعلان",
  "قرارات فورية — بدون تخمين أو ذكاء اصطناعي",
  "مبني على خبرة تجاوزت ٣٠ مليون دولار إنفاق إعلاني",
];

/**
 * Heuristic check for a "duplicate email" error returned by `signUp.email`.
 *
 * Matches on HTTP status (409/422), Better Auth error codes, and the common
 * English message fragments the server may emit.
 *
 * @param err - The error thrown or returned from `signUp.email`.
 * @returns `true` if the error should surface the duplicate-email copy.
 */
function isDuplicateEmailError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    status?: number;
    code?: string;
    message?: string;
    cause?: { status?: number; code?: string };
  };
  const status = anyErr.status ?? anyErr.cause?.status;
  if (status === 409 || status === 422) return true;
  const code = anyErr.code ?? anyErr.cause?.code;
  if (
    code === "USER_ALREADY_EXISTS" ||
    code === "USER_EMAIL_ALREADY_EXISTS" ||
    code === "EMAIL_ALREADY_EXISTS"
  ) {
    return true;
  }
  const msg = String(anyErr.message ?? "").toLowerCase();
  if (
    msg.includes("already exists") ||
    msg.includes("already registered") ||
    msg.includes("email already")
  ) {
    return true;
  }
  return false;
}

/**
 * Arabic sign-up screen (`/auth/signup`).
 *
 * Behaviour (per `contracts/auth-screens.md` S2):
 * - Split layout (RTL): branding panel on the right, form panel on the left.
 *   On mobile (<768px), the panels stack vertically with branding on top.
 * - Submit label `إنشاء حساب`, loading label `جارٍ الإنشاء…`.
 * - Empty fields are blocked client-side with inline Arabic feedback; no
 *   network call is made.
 * - On success, reads fresh session state via `getSession()` (see
 *   research R6); when Better Auth is configured without `autoSignIn`,
 *   falls back to `signIn.email()` so FR-008 (new non-admin user lands on
 *   `/upgrade`) still holds.
 * - On success navigates to `/`; the route guard routes onward
 *   (`/upgrade` for non-admin, dashboard for admin via `ADMIN_EMAIL`).
 * - Footer link `لديك حساب؟ سجّل دخولك` → `/auth/signin`.
 */
export default function SignUp() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Validate the form, call `signUp.email`, and navigate on success.
   *
   * Guards required fields locally (empty name/email/password) per spec Edge
   * Cases / data-model E3 so no blind server call is made.
   */
  const submit = async () => {
    if (submitting) return;
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail || !password) {
      setError("أدخل الاسم والبريد الإلكتروني وكلمة المرور");
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUp.email({
        name: trimmedName,
        email: trimmedEmail,
        password,
      });

      if (result?.error) {
        if (isDuplicateEmailError(result.error)) {
          setError(MSG_DUPLICATE);
        } else {
          setError(MSG_GENERIC);
        }
        return;
      }

      // Read fresh session state — the pre-submit `useSession()` snapshot may
      // not yet reflect autoSignIn. Per research R6, fall back to signIn.email
      // when Better Auth is configured without autoSignIn.
      const fresh = await getSession();
      if (!fresh?.data?.user) {
        const fallback = await signIn.email({
          email: trimmedEmail,
          password,
        });
        if (fallback?.error) {
          if (isDuplicateEmailError(fallback.error)) {
            setError(MSG_DUPLICATE);
          } else {
            setError(MSG_GENERIC);
          }
          return;
        }
      }

      navigate("/", { replace: true });
    } catch (err: unknown) {
      if (isDuplicateEmailError(err)) {
        setError(MSG_DUPLICATE);
      } else {
        setError(MSG_GENERIC);
      }
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Form submit handler; prevents default navigation and calls `submit`.
   */
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submit();
  };

  return (
    <div
      dir="rtl"
      className="flex min-h-screen w-full flex-col text-zinc-100 md:flex-row"
    >
      {/* Branding panel — visually on the right; on mobile, on top */}
      <aside
        className="order-1 flex w-full flex-col justify-center px-6 py-12 md:order-2 md:w-1/2 md:px-12 lg:px-16"
        style={{
          backgroundColor: "#060d18",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(56,132,244,0.04) 1px, transparent 0), linear-gradient(170deg, #060d18 0%, #0a1628 40%, #0d1f3a 100%)",
          backgroundSize: "32px 32px, 100% 100%",
          backgroundRepeat: "repeat, no-repeat",
        }}
      >
        <div className="mx-auto w-full max-w-md">
          <div className="mb-10">
            <h1 className="text-[32px] font-bold leading-tight text-white">
              قرار
            </h1>
            <p className="mt-1 text-sm text-[#4a8ae6]">
              لوحة قرارات إعلانات ميتا
            </p>
          </div>

          <div
            className="mb-10 rounded-[10px] border p-4"
            style={{
              background: "rgba(10,18,32,0.85)",
              borderColor: "rgba(56,132,244,0.15)",
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">
                لوحة القرارات
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{
                  background: "rgba(56,132,244,0.12)",
                  color: "#8ab4f0",
                }}
              >
                ٣ أيام
              </span>
            </div>
            <div className="space-y-2">
              {VERDICT_ROWS.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md px-[10px] py-2 text-[13px]"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <span className="flex items-center gap-2 text-zinc-300">
                    <span aria-hidden="true">{row.dot}</span>
                    <span>{row.entity}</span>
                  </span>
                  <span style={{ color: row.actionColor }}>{row.action}</span>
                  <span className="text-[12px] text-zinc-500">{row.cost}</span>
                </div>
              ))}
            </div>
          </div>

          <ul className="mb-8 space-y-2">
            {FEATURES.map((feature, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-[13px] text-[#8ab4f0]"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#3884f4]" />
                {feature}
              </li>
            ))}
          </ul>

          <p
            className="mt-6 border-t pt-4 text-[11px] leading-relaxed text-[#334155]"
            style={{ borderColor: "rgba(56,132,244,0.1)" }}
          >
            بياناتك مشفرة ولا تُشارك مع أي طرف — اتصال مباشر مع حسابك في ميتا
          </p>
        </div>
      </aside>

      {/* Form panel — visually on the left; on mobile, below */}
      <main
        className="order-2 flex w-full flex-col items-center justify-center px-6 py-12 md:order-1 md:w-1/2 md:px-12 lg:px-20"
        style={{
          background: "#080c14",
          borderRight: "1px solid rgba(56,132,244,0.08)",
        }}
      >
        <div className="w-full max-w-sm">
          <h2 className="mb-2 text-2xl font-bold text-white">قرار</h2>
          <p className="mb-10 text-[15px] text-[#94a3b8]">أنشئ حساباً جديداً</p>

          <form className="space-y-5" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-[13px] text-[#64748b]">
                الاسم
              </Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="اسمك الكامل"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={submitting}
                className="h-11 rounded-lg px-[14px] py-[11px] text-sm text-white placeholder:text-[#475569] focus-visible:border-[#3884f4] focus-visible:ring-[#3884f4]/30"
                style={{
                  backgroundColor: "#0c1220",
                  borderColor: "rgba(56,132,244,0.15)",
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px] text-[#64748b]">
                البريد الإلكتروني
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={submitting}
                dir="ltr"
                className="h-11 rounded-lg px-[14px] py-[11px] text-sm text-white placeholder:text-[#475569] focus-visible:border-[#3884f4] focus-visible:ring-[#3884f4]/30"
                style={{
                  backgroundColor: "#0c1220",
                  borderColor: "rgba(56,132,244,0.15)",
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[13px] text-[#64748b]">
                كلمة المرور
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={submitting}
                dir="ltr"
                className="h-11 rounded-lg px-[14px] py-[11px] text-sm text-white placeholder:text-[#475569] focus-visible:border-[#3884f4] focus-visible:ring-[#3884f4]/30"
                style={{
                  backgroundColor: "#0c1220",
                  borderColor: "rgba(56,132,244,0.15)",
                }}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-lg text-sm font-semibold text-white"
              style={{ background: "#3884f4" }}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جارٍ الإنشاء…
                </>
              ) : (
                "إنشاء حساب"
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-[13px] text-[#475569]">
            لديك حساب؟{" "}
            <Link
              href="/auth/signin"
              className="font-medium hover:underline"
              style={{ color: "#5a9cf5" }}
            >
              سجّل دخولك
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
