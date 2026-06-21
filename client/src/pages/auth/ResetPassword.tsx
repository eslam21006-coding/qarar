import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff, Lock } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";

const MSG_GENERIC = "حدث خطأ، حاول مرة أخرى";
const MSG_INVALID_TOKEN = "رابط إعادة التعيين غير صالح أو انتهت صلاحيته";
const MSG_MISMATCH = "كلمات المرور غير متطابقة";
const MSG_SUCCESS = "تم إعادة تعيين كلمة المرور بنجاح!";

/**
 * Arabic reset password screen (`/auth/reset-password?token=...`).
 *
 * Behaviour:
 * - Extracts reset token from URL query parameter
 * - User enters new password and confirmation
 * - On submit, server validates token and updates password
 * - Shows success message and redirects to signin
 */
export default function ResetPassword() {
  const [location, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Extract token from URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1]);
    const resetToken = params.get("token");
    if (!resetToken) {
      setError(MSG_INVALID_TOKEN);
    } else {
      setToken(resetToken);
    }
  }, [location]);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    if (!password || !confirmPassword) {
      setError("أدخل كلمة المرور وتأكيدها");
      return;
    }

    if (password !== confirmPassword) {
      setError(MSG_MISMATCH);
      return;
    }

    if (password.length < 8) {
      setError("يجب أن تكون كلمة المرور 8 أحرف على الأقل");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.message || MSG_GENERIC);
        return;
      }

      setSuccess(true);
      // Redirect to signin after brief delay
      setTimeout(() => {
        navigate("/auth/signin", { replace: true });
      }, 2000);
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
              style={{ background: "rgba(76,175,80,0.1)" }}
            >
              <Lock className="h-8 w-8 text-[#4caf50]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              تم بنجاح!
            </h1>
            <p className="text-center text-[14px] text-[#94a3b8]">
              {MSG_SUCCESS}
            </p>
          </div>

          <p className="mt-8 text-center text-[13px] text-[#475569]">
            جارٍ إعادة التوجيه إلى تسجيل الدخول…
          </p>
        </div>
      </div>
    );
  }

  if (!token) {
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
              style={{ background: "rgba(239,68,68,0.1)" }}
            >
              <Lock className="h-8 w-8 text-[#ef4444]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              رابط غير صالح
            </h1>
            <p className="text-center text-[14px] text-[#94a3b8]">
              {MSG_INVALID_TOKEN}
            </p>
          </div>

          <p className="mt-8 text-center text-[13px] text-[#475569]">
            <Link
              href="/auth/forgot-password"
              className="font-medium hover:underline"
              style={{ color: "#5a9cf5" }}
            >
              طلب رابط إعادة تعيين جديد
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
            <Lock className="h-8 w-8 text-[#3884f4]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            إعادة تعيين كلمة المرور
          </h1>
          <p className="text-center text-[14px] text-[#94a3b8]">
            أدخل كلمة المرور الجديدة
          </p>
        </div>

        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[13px] text-[#64748b]">
              كلمة المرور الجديدة
            </Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={submitting}
                dir="ltr"
                className="h-11 rounded-lg px-[14px] py-[11px] pr-10 text-sm text-white placeholder:text-[#475569] focus-visible:border-[#3884f4] focus-visible:ring-[#3884f4]/30"
                style={{
                  backgroundColor: "#0c1220",
                  borderColor: "rgba(56,132,244,0.15)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={submitting}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] disabled:opacity-50"
                aria-label={showPassword ? "إخفاء كلمة المرور" : "عرض كلمة المرور"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="text-[13px] text-[#64748b]">
              تأكيد كلمة المرور
            </Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={submitting}
                dir="ltr"
                className="h-11 rounded-lg px-[14px] py-[11px] pr-10 text-sm text-white placeholder:text-[#475569] focus-visible:border-[#3884f4] focus-visible:ring-[#3884f4]/30"
                style={{
                  backgroundColor: "#0c1220",
                  borderColor: "rgba(56,132,244,0.15)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                disabled={submitting}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] disabled:opacity-50"
                aria-label={showConfirm ? "إخفاء كلمة المرور" : "عرض كلمة المرور"}
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
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
                جارٍ إعادة التعيين…
              </>
            ) : (
              "إعادة تعيين كلمة المرور"
            )}
          </Button>
        </form>

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
