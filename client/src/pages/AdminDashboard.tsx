import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, Shield, Users, CheckCircle, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

interface UserAccount {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: string;
  lastSignedIn: string;
  emailVerified: boolean;
}

/**
 * Admin dashboard for managing users and system status.
 * Only accessible to admin users.
 */
export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "admin") {
      navigate("/", { replace: true });
      return;
    }

    // Fetch users list
    fetchUsers();
  }, [loading, user, navigate]);

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        setError("فشل في جلب قائمة المستخدمين");
        return;
      }
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      setError("حدث خطأ في جلب البيانات");
      console.error(err);
    } finally {
      setLoadingUsers(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-[#94a3b8]">جاري التحميل...</p>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return null;
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen px-6 py-12"
      style={{ background: "#080c14" }}
    >
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-10 flex items-center gap-3">
          <Shield className="h-8 w-8 text-[#3884f4]" />
          <div>
            <h1 className="text-3xl font-bold text-white">لوحة التحكم الإدارية</h1>
            <p className="text-[#94a3b8]">إدارة المستخدمين والحسابات</p>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-10 grid gap-4 md:grid-cols-3">
          <div
            className="rounded-lg border p-6"
            style={{ borderColor: "rgba(56,132,244,0.15)", background: "#0c1220" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[#94a3b8]">إجمالي المستخدمين</p>
                <p className="mt-2 text-3xl font-bold text-white">{users.length}</p>
              </div>
              <Users className="h-8 w-8 text-[#3884f4]" />
            </div>
          </div>

          <div
            className="rounded-lg border p-6"
            style={{ borderColor: "rgba(56,132,244,0.15)", background: "#0c1220" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[#94a3b8]">المسؤولون</p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {users.filter((u) => u.role === "admin").length}
                </p>
              </div>
              <Shield className="h-8 w-8 text-[#10b981]" />
            </div>
          </div>

          <div
            className="rounded-lg border p-6"
            style={{ borderColor: "rgba(56,132,244,0.15)", background: "#0c1220" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[#94a3b8]">البريد المتحقق</p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {users.filter((u) => u.emailVerified).length}
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-[#f59e0b]" />
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div
          className="rounded-lg border"
          style={{ borderColor: "rgba(56,132,244,0.15)", background: "#0c1220" }}
        >
          <div className="border-b p-6" style={{ borderColor: "rgba(56,132,244,0.15)" }}>
            <h2 className="text-lg font-semibold text-white">قائمة المستخدمين</h2>
          </div>

          {error && (
            <div className="m-6 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {loadingUsers ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#3884f4]" />
            </div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center text-[#94a3b8]">لا توجد حسابات مستخدم</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr
                    className="border-b text-right text-sm font-semibold text-[#94a3b8]"
                    style={{ borderColor: "rgba(56,132,244,0.15)" }}
                  >
                    <th className="px-6 py-3">الاسم</th>
                    <th className="px-6 py-3">البريد الإلكتروني</th>
                    <th className="px-6 py-3">الدور</th>
                    <th className="px-6 py-3">التحقق</th>
                    <th className="px-6 py-3">تاريخ الإنشاء</th>
                    <th className="px-6 py-3">آخر دخول</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((userItem) => (
                    <tr
                      key={userItem.id}
                      className="border-b text-sm text-white hover:bg-[#0f172a]/50"
                      style={{ borderColor: "rgba(56,132,244,0.15)" }}
                    >
                      <td className="px-6 py-4">{userItem.name || "—"}</td>
                      <td className="px-6 py-4 font-mono text-[#94a3b8]">
                        {userItem.email || "—"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className="inline-block rounded px-2 py-1 text-xs font-semibold"
                          style={{
                            background:
                              userItem.role === "admin"
                                ? "rgba(16, 185, 129, 0.1)"
                                : "rgba(100, 116, 139, 0.1)",
                            color:
                              userItem.role === "admin" ? "#10b981" : "#94a3b8",
                          }}
                        >
                          {userItem.role === "admin" ? "مسؤول" : "مستخدم"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {userItem.emailVerified ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-[#10b981]" />
                              <span className="text-[#10b981]">موثق</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-4 w-4 text-[#f59e0b]" />
                              <span className="text-[#f59e0b]">قيد الانتظار</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[#94a3b8]">
                        {new Date(userItem.createdAt).toLocaleDateString("ar-SA")}
                      </td>
                      <td className="px-6 py-4 text-[#94a3b8]">
                        {new Date(userItem.lastSignedIn).toLocaleDateString("ar-SA")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
