import { useAuth } from "@/_core/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const SIGNIN_PATH = "/auth/signin";
const SIGNUP_PATH = "/auth/signup";
const UPGRADE_PATH = "/upgrade";
const HOME_PATH = "/";

/**
 * Three-state access guard that gates the application's protected route
 * subtree (`/`, `/dashboard/:accountId`, `/settings/:accountId`,
 * `/privacy`, `/terms`, `/data-deletion-status`, etc.).
 *
 * Behaviour (mutually exclusive, exhaustive):
 *
 * | Precondition            | Rendered result | Navigation                              |
 * |-------------------------|-----------------|-----------------------------------------|
 * | `loading === true`      | Spinner only    | none                                    |
 * | `!user`                 | nothing         | ensure URL is `/auth/signin` or `/auth/signup` |
 * | `user && !isActive`     | `children`      | ensure URL is `/upgrade`                |
 * | `user && isActive`      | `children`      | leave `/auth/*` and `/upgrade` for `/`  |
 *
 * Redirect effects are idempotent (no loop) — navigate only when the path
 * is not already the target. See `contracts/route-guard.md` C2.
 *
 * Re-render gating: Better Auth's `useSession().isPending` flips true on
 * every background revalidation (window focus, online, broadcast) when
 * the session data is `null`. Treating raw `loading` as "still booting"
 * after the first resolution unmounts the protected route tree on every
 * tab switch. We latch `hasResolvedOnce` once the initial session query
 * has settled; only the FIRST resolution is allowed to blank the screen.
 * After that, subsequent `loading` flips from background refetches are
 * ignored for rendering decisions (redirect logic still uses the freshest
 * `user`/`isActive`).
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isActive } = useAuth();
  const [location, navigate] = useLocation();
  const hasResolvedOnce = useRef(false);

  useEffect(() => {
    if (!loading) hasResolvedOnce.current = true;
  }, [loading]);

  useEffect(() => {
    if (!hasResolvedOnce.current) return;
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

  if (!hasResolvedOnce.current && loading) {
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
