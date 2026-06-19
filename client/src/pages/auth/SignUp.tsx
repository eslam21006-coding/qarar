import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSession, signIn, signUp } from "@/lib/auth-client";
import { LockKeyhole, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

const MSG_DUPLICATE = "هذا البريد الإلكتروني مسجّل بالفعل";
const MSG_GENERIC = "حدث خطأ، حاول مرة أخرى";

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
 * - Title `قرار`, subtitle `أنشئ حساباً جديداً`.
 * - Name + email + password fields, RTL, dark `#0a0a0a`/`#111`/`#1a1a1a`/`#333`.
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
      className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-10 text-zinc-100"
    >
      <Card className="w-full max-w-md rounded-2xl border-[#222] bg-[#111] text-zinc-100 shadow-xl">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            <LockKeyhole className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-extrabold text-white">
            قرار
          </CardTitle>
          <CardDescription className="text-zinc-400">
            أنشئ حساباً جديداً
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="name" className="text-zinc-200">
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
                className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-zinc-500 focus-visible:ring-white/30"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-zinc-200">
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
                className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-zinc-500 focus-visible:ring-white/30"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-200">
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
                className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-zinc-500 focus-visible:ring-white/30"
                dir="ltr"
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
              className="h-11 w-full rounded-md bg-white text-base font-bold text-black hover:bg-zinc-200"
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

          <p className="mt-6 text-center text-sm text-zinc-400">
            لديك حساب؟{" "}
            <Link
              href="/auth/signin"
              className="font-bold text-white underline-offset-4 hover:underline"
            >
              سجّل دخولك
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
