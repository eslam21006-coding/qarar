import { useEffect, useRef, type RefObject } from "react";

/**
 * Latch `true` the first time `loading` becomes `false`, and stay `true`
 * thereafter regardless of subsequent `loading` flips.
 *
 * Why this exists: Better Auth's `useSession().isPending` flips `true` on
 * every background revalidation (window focus, online, broadcast) when
 * the session data is `null`. Treating raw `loading` as "still booting"
 * after the first resolution unmounts route-guard children like
 * `<SignIn />`, wiping form state on every tab switch. Both
 * `RouteGuard` and `PublicAuthRoute` need to behave as if the session
 * is "resolved" once it has resolved at least once, even though Better
 * Auth's atom keeps flipping `isPending` underneath.
 *
 * The latch is intentionally a `useRef` (not `useState`) so callers can
 * read it inside `useEffect` / render branches without forcing extra
 * re-renders. Mutations to `.current` never schedule a re-render.
 */
export function useHasResolvedOnce(loading: boolean): RefObject<boolean> {
  const hasResolvedOnce = useRef(false);
  useEffect(() => {
    if (!loading) hasResolvedOnce.current = true;
  }, [loading]);
  return hasResolvedOnce;
}
