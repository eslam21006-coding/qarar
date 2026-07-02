import { useAuth } from "@/_core/hooks/useAuth";
import { useHasResolvedOnce } from "@/hooks/useHasResolvedOnce";
import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Wrapper for routes that should only be reachable by signed-out visitors.
 * Authenticated users are redirected to `/` (active) or `/upgrade` (!active),
 * per contracts/route-guard.md C2.
 *
 * Re-render gating: Better Auth's `useSession().isPending` flips true on every
 * background revalidation (window focus, online, broadcast) when the session
 * data is `null`. Treating raw `loading` as "still booting" after the first
 * resolution unmounts children like `<SignIn />`, wiping form state on every
 * tab switch. `useHasResolvedOnce` latches the resolution and is used in place
 * of raw `loading` to decide whether to blank the screen. Redirect logic still
 * uses the freshest `user`/`isActive`.
 */
export function PublicAuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isActive } = useAuth();
  const [, navigate] = useLocation();
  const hasResolvedOnce = useHasResolvedOnce(loading);

  useEffect(() => {
    if (!hasResolvedOnce.current) return;
    if (loading || !user) return;
    const target = isActive ? "/" : "/upgrade";
    navigate(target, { replace: true });
  }, [loading, user, isActive, navigate]);

  if (!hasResolvedOnce.current && loading) return null;
  if (user) return null;
  return <>{children}</>;
}
