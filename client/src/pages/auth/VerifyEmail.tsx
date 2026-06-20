import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";

const MSG_GENERIC = "حدث خطأ، حاول مرة أخرى";
const MSG_VERIFIED = "تم التحقق من البريد الإلكتروني بنجاح!";
const MSG_RESENT = "تم إعادة إرسال رابط التحقق";

/**
 * Arabic email verification screen (`/auth/verify-email`).
 *
 * Behaviour:
 * - Shows after user signs up; displays email address and verification instructions.
 * - User receives email with verification link/code.
 * - Can resend verification email if not received.
 * - On verification success, redirects to `/` (dashboard or upgrade based on subscription).
 */
export default function VerifyEmail() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Get email from localStorage
  useEffect(() => {
    const storedEmail = localStorage.getItem("qarar_signup_email");
    if (storedEmail) {
      setEmail(storedEmail);
    }
  }, []);

  // Handle resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const verifyEmail = async () => {
    if (verifying) return;
    setError(null);
    setSuccess(null);

    if (!code.trim()) {
      setError("أدخل رمز التحقق");
      return;
    }

    setVerifying(true);
    try {
      // Call better-auth email verification via API
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (!response.ok) {
        setError(MSG_GENERIC);
        return;
      }

      setSuccess(MSG_VERIFIED);
      // Clear stored email
      localStorage.removeItem("qarar_signup_email");
      // Redirect to home after brief delay
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 1500);
    } catch (err: unknown) {
      setError(MSG_GENERIC);
    } finally {
      setVerifying(false);
    }
  };

  const resendVerification = async () => {
    if (resending || resendCooldown > 0) return;
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError("البريد الإلكتروني غير موجود");
      return;
    }

    setResending(true);
    try {
      // Call better-auth resend email verification via API
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) {
        setError(MSG_GENERIC);
        return;
      }

      setSuccess(MSG_RESENT);
      setResendCooldown(60); // 60 second cooldown
    } catch (err: unknown) {
      setError(MSG_GENERIC);
    } finally {
      setResending(false);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void verifyEmail();
  };

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
          <p className="text-center text-[14px] text-[#94a3b8]">
            أرسلنا رابط تحقق إلى{" "}
            <span className="font-semibold text-white">{email}</span>
          </p>
        </div>

        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="code" className="text-[13px] text-[#64748b]">
              رمز التحقق
            </Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              placeholder="أدخل الرمز من البريد"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={verifying}
              dir="ltr"
              maxLength={6}
              className="h-11 rounded-lg px-[14px] py-[11px] text-center text-sm font-mono text-white placeholder:text-[#475569] focus-visible:border-[#3884f4] focus-visible:ring-[#3884f4]/30"
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

          {success && (
            <div
              role="status"
              className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300"
            >
              {success}
            </div>
          )}

          <Button
            type="submit"
            disabled={verifying}
            className="h-11 w-full rounded-lg text-sm font-semibold text-white"
            style={{ background: "#3884f4" }}
          >
            {verifying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ التحقق…
              </>
            ) : (
              "تحقق من البريد"
            )}
          </Button>
        </form>

        <div className="mt-6 space-y-3">
          <p className="text-center text-[13px] text-[#475569]">
            لم تستقبل الرمز؟
          </p>
          <Button
            type="button"
            onClick={resendVerification}
            disabled={resending || resendCooldown > 0}
            variant="outline"
            className="h-10 w-full rounded-lg text-sm font-semibold"
            style={{
              borderColor: "rgba(56,132,244,0.3)",
              color: "#5a9cf5",
            }}
          >
            {resending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ الإرسال…
              </>
            ) : resendCooldown > 0 ? (
              `أعد المحاولة بعد ${resendCooldown}ث`
            ) : (
              "أعد إرسال الرمز"
            )}
          </Button>
        </div>

        <p className="mt-8 text-center text-[13px] text-[#475569]">
          <Link
            href="/auth/signin"
            className="font-medium hover:underline"
            style={{ color: "#5a9cf5" }}
          >
            العودة إلى تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
