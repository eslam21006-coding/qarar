import { useAuth } from "@/_core/hooks/useAuth";
import { useEffect, useRef } from "react";
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
 * tab switch. We latch `hasResolvedOnce` once the initial session query has
 * settled; only the FIRST resolution is allowed to blank the screen. After
 * that, subsequent `loading` flips from background refetches are ignored for
 * rendering decisions (redirect logic still uses the freshest `user`/`isActive`).
 */
export function PublicAuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isActive } = useAuth();
  const [, navigate] = useLocation();
  const hasResolvedOnce = useRef(false);

  useEffect(() => {
    if (!loading) hasResolvedOnce.current = true;
  }, [loading]);

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
