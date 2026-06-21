import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

const MSG_GENERIC = "حدث خطأ، حاول مرة أخرى";
const MSG_SENT = "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني";

/**
 * Arabic forgot password screen (`/auth/forgot-password`).
 *
 * Behaviour:
 * - User enters email address
 * - On submit, server sends password reset link via email
 * - Shows success message with instructions to check email
 * - Link in email redirects to `/auth/reset-password?token=...`
 */
export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("أدخل البريد الإلكتروني");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      if (!response.ok) {
        // Even on error, show success message for security (don't reveal if email exists)
        setSuccess(true);
        return;
      }

      setSuccess(true);
    } catch (err: unknown) {
      setError(MSG_GENERIC);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submit();
  };

  if (success) {
    return (
      <div
        dir="rtl"
        className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12"
        style={{ background: "#080c14" }}
      >
        <div className="w-full max-w-sm">
          <div className="mb-10 flex flex-col items-center">
            <div
              className="mb-6 rounded-full p-3"
              style={{ background: "rgba(56,132,244,0.1)" }}
            >
              <Mail className="h-8 w-8 text-[#3884f4]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              تحقق من بريدك الإلكتروني
            </h1>
            <p className="text-center text-[14px] text-[#94a3b8] mb-6">
              أرسلنا رابط إعادة تعيين كلمة المرور إلى{" "}
              <span className="font-semibold text-white">{email}</span>
            </p>
            <p className="text-center text-[13px] text-[#64748b] mb-8">
              انقر على الرابط في البريد الإلكتروني لإعادة تعيين كلمة المرور. قد يستغرق وصول البريد بضع دقائق.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-center text-[13px] text-[#475569]">
              لم تستقبل البريد؟
            </p>
            <Button
              type="button"
              onClick={() => setSuccess(false)}
              variant="outline"
              className="h-10 w-full rounded-lg text-sm font-semibold"
              style={{
                borderColor: "rgba(56,132,244,0.3)",
                color: "#5a9cf5",
              }}
            >
              جرب بريد إلكتروني آخر
            </Button>
          </div>

          <p className="mt-8 text-center text-[13px] text-[#475569]">
            <Link
              href="/auth/signin"
              className="font-medium hover:underline inline-flex items-center gap-1"
              style={{ color: "#5a9cf5" }}
            >
              العودة إلى تسجيل الدخول
              <ArrowRight className="h-3 w-3" />
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12"
      style={{ background: "#080c14" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center">
          <div
            className="mb-6 rounded-full p-3"
            style={{ background: "rgba(56,132,244,0.1)" }}
          >
            <Mail className="h-8 w-8 text-[#3884f4]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            إعادة تعيين كلمة المرور
          </h1>
          <p className="text-center text-[14px] text-[#94a3b8]">
            أدخل البريد الإلكتروني المرتبط بحسابك
          </p>
        </div>

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
                جارٍ الإرسال…
              </>
            ) : (
              "إرسال رابط إعادة التعيين"
            )}
          </Button>
        </form>

        <p className="mt-8 text-center text-[13px] text-[#475569]">
          تذكرت كلمة المرور؟{" "}
          <Link
            href="/auth/signin"
            className="font-medium hover:underline"
            style={{ color: "#5a9cf5" }}
          >
            سجّل دخولك
          </Link>
        </p>
      </div>
    </div>
  );
}
