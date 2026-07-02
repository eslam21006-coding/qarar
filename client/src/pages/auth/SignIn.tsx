import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { signIn } from "@/lib/auth-client";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, Eye, EyeOff, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";

const MSG_NO_ACCOUNT =
  "لا يوجد حساب بهذا البريد الإلكتروني. للاشتراك، قم بالشراء من خلال صفحة المبيعات.";
const MSG_WRONG_PASSWORD = "كلمة المرور غير صحيحة";
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

/** Format remaining seconds as mm:ss */
function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Arabic countdown banner shown when sign-in is rate-limited */
function RateLimitBanner({ retryAfterMs }: { retryAfterMs: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((retryAfterMs - Date.now()) / 1000))
  );

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining(() => {
        const next = Math.max(0, Math.ceil((retryAfterMs - Date.now()) / 1000));
        if (next <= 0) clearInterval(id);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfterMs]);

  return (
    <div
      role="alert"
      className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-300"
    >
      <div className="mb-1 flex items-center gap-2">
        <Clock className="h-4 w-4 shrink-0" />
        <span className="font-medium">لقد قمت بالعديد من المحاولات</span>
      </div>
      {remaining > 0 ? (
        <p className="text-xs text-amber-400/80">
          برجاء المحاولة مرة أخرى بعد{" "}
          <span className="font-mono font-bold text-amber-300">
            {formatCountdown(remaining)}
          </span>
        </p>
      ) : (
        <p className="text-xs text-amber-400/80">يمكنك المحاولة الآن</p>
      )}
    </div>
  );
}

/**
 * Heuristic check for an "invalid credentials" error returned by
 * `signIn.email`. Matches on HTTP status (401/400), Better Auth error
 * codes, and the common English message fragments the server may emit.
 */
function isInvalidCredentialsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    status?: number;
    code?: string;
    message?: string;
    cause?: { status?: number; code?: string };
  };
  const status = anyErr.status ?? anyErr.cause?.status;
  if (status === 401 || status === 400) return true;
  const code = anyErr.code ?? anyErr.cause?.code;
  if (
    code === "INVALID_EMAIL_OR_PASSWORD" ||
    code === "INVALID_CREDENTIALS" ||
    code === "INVALID_EMAIL" ||
    code === "INVALID_PASSWORD"
  ) {
    return true;
  }
  const msg = String(anyErr.message ?? "").toLowerCase();
  if (
    msg.includes("invalid email or password") ||
    msg.includes("invalid credentials") ||
    msg.includes("incorrect password")
  ) {
    return true;
  }
  return false;
}

/**
 * Arabic sign-in screen (`/auth/signin`).
 *
 * Behaviour:
 * - Split layout (RTL): branding panel on the right, form panel on the left.
 *   On mobile (<768px), the panels stack vertically with branding on top.
 * - Submit label `دخول`, loading label `جارٍ الدخول…`.
 * - Enter in the password field submits.
 * - Empty fields are blocked client-side with inline Arabic feedback.
 * - Rate limited after 5 failed attempts per 15 minutes; shows Arabic countdown.
 * - On success, navigates to `/`.
 */
export default function SignIn() {
  const [, navigate] = useLocation();
  const { refetch } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // retryAfterMs is a UTC ms timestamp when the rate-limit block expires
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const isBlocked = rateLimitedUntil !== null && Date.now() < rateLimitedUntil;

  const submit = async () => {
    if (submitting || isBlocked) return;
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("أدخل البريد الإلكتروني وكلمة المرور");
      return;
    }

    setSubmitting(true);
    try {
      // Check if the email exists first to show a distinct Arabic error message
      let emailExists = true;
      try {
        const checkRes = await fetch("/api/auth/check-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail }),
        });
        const checkData = await checkRes.json();
        emailExists = !!checkData.exists;
      } catch {
        // If check fails, proceed normally — Better Auth will handle it
      }

      if (!emailExists) {
        setError(MSG_NO_ACCOUNT);
        setSubmitting(false);
        return;
      }

      // Use raw fetch so we can read the 429 body before Better Auth client
      // swallows it. Better Auth's signIn.email doesn't expose retryAfter.
      const rawRes = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      if (rawRes.status === 429) {
        const data = await rawRes.json().catch(() => ({}));
        const retryAfterMs =
          typeof data.retryAfter === "number"
            ? data.retryAfter
            : Date.now() + 15 * 60 * 1000;
        setRateLimitedUntil(retryAfterMs);
        return;
      }

      if (!rawRes.ok) {
        // Non-429 error — parse and classify
        const data = await rawRes.json().catch(() => ({}));
        if (isInvalidCredentialsError({ status: rawRes.status, ...data })) {
          setError(MSG_WRONG_PASSWORD);
        } else {
          setError(MSG_GENERIC);
        }
        return;
      }

      // Success — handle remember me preference
      if (rememberMe) {
        localStorage.setItem("qarar_remember_me", "true");
      } else {
        localStorage.removeItem("qarar_remember_me");
      }

      // We used raw `fetch` above so we can read the 429 body before Better
      // Auth's client swallows it. The trade-off is that the Better Auth
      // client-side session atom wasn't notified, so `useSession()` would
      // still report `data: null` and the route guard would bounce us back
      // to `/auth/signin` after navigation. Explicitly refetch the session
      // and await it before navigating so the guard sees the authenticated
      // user on the very next render.
      try {
        await refetch();
      } catch {
        // Refetch errors are non-fatal here: the cookie is set, navigation
        // will still happen, and the subsequent revalidation will pick it up.
      }

      navigate("/", { replace: true });
    } catch (err: unknown) {
      if (isInvalidCredentialsError(err)) {
        setError(MSG_WRONG_PASSWORD);
      } else {
        setError(MSG_GENERIC);
      }
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="mb-10 flex items-center gap-3">
            <img
              src="/qarar_logo_transparent.png"
              alt="قرار"
              style={{ height: "44px", width: "auto", borderRadius: "10px" }}
            />
            <div>
              <h1 className="text-[28px] font-bold leading-tight text-white">
                قرار
              </h1>
              <p
                dir="ltr"
                className="mt-1 text-[11px] uppercase text-[#4a8ae6]"
              >
                ADS DECISION ENGINE
              </p>
            </div>
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
          <p className="mb-10 text-[15px] text-[#94a3b8]">
            سجّل دخولك للمتابعة
          </p>

          <form className="space-y-5" onSubmit={onSubmit} noValidate>
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
                disabled={submitting || isBlocked}
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
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={submitting || isBlocked}
                  dir="ltr"
                  className="h-11 rounded-lg px-[14px] py-[11px] pl-10 text-sm text-white placeholder:text-[#475569] focus-visible:border-[#3884f4] focus-visible:ring-[#3884f4]/30"
                  style={{
                    backgroundColor: "#0c1220",
                    borderColor: "rgba(56,132,244,0.15)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={submitting || isBlocked}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] disabled:opacity-50"
                  aria-label={
                    showPassword ? "إخفاء كلمة المرور" : "عرض كلمة المرور"
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="rememberMe"
                checked={rememberMe}
                onCheckedChange={checked => setRememberMe(checked as boolean)}
                disabled={submitting || isBlocked}
                className="border-[#3884f4] bg-[#0c1220]"
              />
              <Label
                htmlFor="rememberMe"
                className="text-[13px] text-[#64748b] font-normal cursor-pointer"
              >
                تذكرني
              </Label>
            </div>

            {/* Rate-limit countdown banner */}
            {isBlocked && rateLimitedUntil !== null && (
              <RateLimitBanner retryAfterMs={rateLimitedUntil} />
            )}

            {/* Regular error message */}
            {!isBlocked && error && (
              <div
                role="alert"
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || isBlocked}
              className="h-11 w-full rounded-lg text-sm font-semibold text-white"
              style={{ background: isBlocked ? "#1e3a5f" : "#3884f4" }}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جارٍ الدخول…
                </>
              ) : isBlocked ? (
                "محظور مؤقتاً"
              ) : (
                "دخول"
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-[12px]">
            <Link
              href="/auth/forgot-password"
              className="font-medium hover:underline"
              style={{ color: "#5a9cf5" }}
            >
              هل نسيت كلمة المرور؟
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
