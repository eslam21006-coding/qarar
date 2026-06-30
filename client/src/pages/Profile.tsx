import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrengthMeter, isPasswordStrong } from "@/components/PasswordStrengthMeter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, Eye, EyeOff, LogOut, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

/**
 * User profile page for managing account settings.
 * Allows users to:
 * - View account information (name, email)
 * - Change password
 * - Log out
 */
export default function Profile() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-[#94a3b8]">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("أدخل كلمة المرور الحالية والجديدة");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("كلمات المرور الجديدة غير متطابقة");
      return;
    }

    if (!isPasswordStrong(newPassword)) {
      setError("كلمة المرور الجديدة لا تلبي جميع المتطلبات");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "فشل تغيير كلمة المرور");
        return;
      }

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError("حدث خطأ، حاول مرة أخرى");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/auth/signin", { replace: true });
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen px-6 py-12"
      style={{ background: "#080c14" }}
    >
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">حسابي</h1>
          <p className="text-[#94a3b8]">إدارة إعدادات حسابك وكلمة المرور</p>
        </div>

        {/* Account Information */}
        <div
          className="mb-10 rounded-lg border p-6"
          style={{ borderColor: "rgba(56,132,244,0.15)", background: "#0c1220" }}
        >
          <h2 className="mb-6 text-lg font-semibold text-white">معلومات الحساب</h2>
          <div className="space-y-4">
            <div>
              <Label className="text-[13px] text-[#64748b]">الاسم</Label>
              <p className="mt-2 text-white">{user.name || "—"}</p>
            </div>
            <div>
              <Label className="text-[13px] text-[#64748b]">البريد الإلكتروني</Label>
              <p className="mt-2 text-white">{user.email || "—"}</p>
            </div>
            <div>
              <Label className="text-[13px] text-[#64748b]">الدور</Label>
              <p className="mt-2 text-white capitalize">
                {user.role === "admin" ? "مسؤول" : "مستخدم"}
              </p>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div
          className="mb-10 rounded-lg border p-6"
          style={{ borderColor: "rgba(56,132,244,0.15)", background: "#0c1220" }}
        >
          <h2 className="mb-6 text-lg font-semibold text-white">تغيير كلمة المرور</h2>

          <form className="space-y-5" onSubmit={handleChangePassword} noValidate>
            {/* Current Password */}
            <div className="space-y-1.5">
              <Label htmlFor="current" className="text-[13px] text-[#64748b]">
                كلمة المرور الحالية
              </Label>
              <div className="relative">
                <Input
                  id="current"
                  type={showCurrent ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
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
                  onClick={() => setShowCurrent(!showCurrent)}
                  disabled={submitting}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] disabled:opacity-50"
                >
                  {showCurrent ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-1.5">
              <Label htmlFor="new" className="text-[13px] text-[#64748b]">
                كلمة المرور الجديدة
              </Label>
              <div className="relative">
                <Input
                  id="new"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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
                  onClick={() => setShowNew(!showNew)}
                  disabled={submitting}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] disabled:opacity-50"
                >
                  {showNew ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <PasswordStrengthMeter password={newPassword} showRequirements={true} />
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-[13px] text-[#64748b]">
                تأكيد كلمة المرور الجديدة
              </Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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

            {success && (
              <div
                role="alert"
                className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300"
              >
                تم تغيير كلمة المرور بنجاح!
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
                  جاري التحديث…
                </>
              ) : (
                "تحديث كلمة المرور"
              )}
            </Button>
          </form>
        </div>

        {/* Logout */}
        <div className="flex gap-3">
          <Button
            onClick={handleLogout}
            className="flex-1 h-11 rounded-lg text-sm font-semibold text-white"
            style={{ background: "#ef4444" }}
          >
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </Button>
        </div>
      </div>
    </div>
  );
}
