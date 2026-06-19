import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { LogOut, Lock } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

const DISCOVERY_CALL_URL = "https://eslamsalah.com/team-discovery-call";
const HEADING = "اشتراكك غير مفعّل بعد";
const BODY =
  "للوصول إلى لوحة قرار يجب أن يكون اشتراكك نشطاً. إذا أتممت الدفع ولم يُفعَّل حسابك، تواصل معنا.";

export default function Upgrade() {
  const [, navigate] = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      navigate("/auth/signin", { replace: true });
    }
  };

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-10 text-zinc-100"
    >
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-[#222] bg-[#111]">
          <Lock className="h-8 w-8 text-white" />
        </div>

        <h1 className="text-2xl font-extrabold leading-tight text-white">
          {HEADING}
        </h1>

        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
          {BODY}
        </p>

        <div className="mt-8">
          <Button
            asChild
            className="h-12 w-full rounded-md bg-white text-base font-bold text-black hover:bg-zinc-200"
          >
            <a
              href={DISCOVERY_CALL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              احجز مكالمة الاكتشاف
            </a>
          </Button>
        </div>

        <div className="mt-8">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 underline-offset-4 hover:text-white hover:underline disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            تسجيل خروج
          </button>
        </div>
      </div>
    </div>
  );
}
