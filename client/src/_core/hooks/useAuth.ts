import { useSession, signOut } from "@/lib/auth-client";
import {
  deriveIsActive,
  type Role,
  type SessionUser,
  type SubscriptionStatus,
} from "./isActive";

/**
 * Result shape returned by the {@link useAuth} hook.
 *
 * - `user`: the Better Auth session user, or `null` when signed out.
 * - `loading`: `true` while `useSession()` has not yet resolved.
 * - `isActive`: derived access flag — see `deriveIsActive` in `./isActive.ts`.
 * - `refetch`: re-reads the session from the Better Auth client.
 * - `logout`: ends the current Better Auth session.
 */
export interface UseAuthResult {
  user: SessionUser | null;
  loading: boolean;
  isActive: boolean;
  refetch: () => Promise<unknown> | void;
  logout: () => Promise<void>;
}

/**
 * Hook returning the current Better Auth session together with a derived
 * `isActive` access flag. Drives the route guard, sign-out flows, and
 * subscription-state-aware screens.
 *
 * Replaces the legacy tRPC `auth.me` dependency with `useSession()` so the
 * front-end reads subscription state directly from the Better Auth session.
 *
 * @returns See {@link UseAuthResult}.
 */
export function useAuth(): UseAuthResult {
  const session = useSession();
  const user = (session.data?.user as SessionUser | undefined) ?? null;
  const loading = Boolean(session.isPending);

  const isActive = deriveIsActive(user);

  const refetch = () => {
    if (typeof session.refetch === "function") {
      return session.refetch();
    }
    return undefined;
  };

  const logout = async () => {
    await signOut();
  };

  return {
    user,
    loading,
    isActive,
    refetch,
    logout,
  };
}

// Re-export the union types so existing importers (`useAuth`-only consumers
// that read `Role`/`SubscriptionStatus`) keep working without an extra import.
export type { Role, SubscriptionStatus };
