import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

const DISCOVERY_CALL_URL = "https://eslamsalah.com/team-discovery-call";
const HEADING = "اشتراكك غير مفعّل بعد";
const BODY =
  "للوصول إلى لوحة قرار يجب أن يكون اشتراكك نشطاً. إذا أتممت الدفع ولم يُفعَّل حسابك، تواصل معنا.";
const TAGLINE = "هل جربت كل شيء ولا تزال ضائعاً بالإعلانات الممولة؟";
const CTA_LABEL = "احجز مكالمة استكشافية مجانية مع الفريق";

/**
 * Arabic upgrade / access-denied screen (`/upgrade`).
 *
 * Shown to authenticated users whose session is not active (i.e.
 * `useAuth().isActive === false`). Per `contracts/auth-screens.md` S3:
 * - Lock icon at the top (rounded bordered container with the 🔒 glyph).
 * - Heading `اشتراكك غير مفعّل بعد` and the verbatim body copy.
 * - Tagline above the CTA asking whether the visitor is still stuck.
 * - Blue CTA `احجز مكالمة استكشافية مجانية مع الفريق` opening
 *   `https://eslamsalah.com/team-discovery-call` in a new tab
 *   (`target="_blank"`, `rel="noopener noreferrer"`).
 * - Small `تسجيل خروج` link that calls `signOut()` and navigates to
 *   `/auth/signin`.
 */
export default function Upgrade() {
  const [, navigate] = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  /**
   * End the current session and route the visitor back to the sign-in screen.
   *
   * Sets a local `signingOut` flag to keep the button disabled while the
   * Better Auth client call is in flight.
   */
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
      className="flex min-h-screen w-full items-center justify-center px-4 py-10 text-zinc-100"
      style={{
        backgroundColor: "#060d18",
        backgroundImage:
          "linear-gradient(170deg, #060d18 0%, #0a1628 40%, #0d1f3a 100%)",
      }}
    >
      <div className="w-full max-w-md text-center">
        <div
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            background: "rgba(10,18,32,0.85)",
            border: "1px solid rgba(56,132,244,0.2)",
          }}
        >
          <span className="text-3xl" aria-hidden="true">
            🔒
          </span>
        </div>

        <h1 className="text-2xl font-bold leading-tight text-white">
          {HEADING}
        </h1>

        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-[#64748b]">
          {BODY}
        </p>

        <p className="mx-auto mt-8 max-w-sm text-[15px] leading-relaxed text-[#94a3b8]">
          {TAGLINE}
        </p>

        <div className="mt-5">
          <Button
            asChild
            className="h-12 w-full rounded-lg text-sm font-semibold text-white"
            style={{ background: "#3884f4" }}
          >
            <a
              href={DISCOVERY_CALL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {CTA_LABEL}
            </a>
          </Button>
        </div>

        <div className="mt-8">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="inline-flex items-center gap-2 text-sm font-medium hover:underline disabled:opacity-50"
            style={{ color: "#475569" }}
          >
            <LogOut className="h-4 w-4" />
            تسجيل خروج
          </button>
        </div>
      </div>
    </div>
  );
}
