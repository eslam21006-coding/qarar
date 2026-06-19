import { useAuth } from "@/_core/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import { useEffect } from "react";
import { useLocation } from "wouter";

const SIGNIN_PATH = "/auth/signin";
const SIGNUP_PATH = "/auth/signup";
const UPGRADE_PATH = "/upgrade";
const HOME_PATH = "/";

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isActive } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;

    const path = window.location.pathname;

    if (!user) {
      if (path !== SIGNIN_PATH && path !== SIGNUP_PATH) {
        navigate(SIGNIN_PATH, { replace: true });
      }
      return;
    }

    if (!isActive) {
      if (path !== UPGRADE_PATH) {
        navigate(UPGRADE_PATH, { replace: true });
      }
      return;
    }

    if (path === SIGNIN_PATH || path === SIGNUP_PATH || path === UPGRADE_PATH) {
      navigate(HOME_PATH, { replace: true });
    }
  }, [loading, user, isActive, navigate, location]);

  if (loading) {
    return (
      <div
        dir="rtl"
        className="flex min-h-screen items-center justify-center bg-[#0a0a0a]"
      >
        <Spinner className="h-8 w-8 text-white" />
      </div>
    );
  }

  if (!user) return null;

  if (!isActive) {
    if (window.location.pathname !== UPGRADE_PATH) return null;
    return <>{children}</>;
  }

  return <>{children}</>;
}
