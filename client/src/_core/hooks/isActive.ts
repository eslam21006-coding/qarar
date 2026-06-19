/**
 * Auth-related view-model types shared across the client.
 *
 * These mirror the Better Auth `additionalFields` configured server-side
 * (`subscriptionStatus`, `ghlContactId`, `role`); the values themselves are
 * never written from the front-end.
 */
export type Role = "user" | "admin";
export type SubscriptionStatus = "active" | "inactive";

/**
 * Minimal view of the Better Auth session user consumed by the front-end.
 * Additional fields may be present but are not used by the auth gate.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role?: Role;
  subscriptionStatus?: SubscriptionStatus;
  ghlContactId?: string | null;
}

/**
 * Pure derivation of whether the current user has access to the gated
 * application: admin role OR active subscription.
 *
 * Mirrors `server/_core/trpc.ts` `requireActiveSubscription` so the route
 * guard and the server gate never disagree. Fails closed on `null`/missing
 * fields (treated as `role: "user"`, `subscriptionStatus: "inactive"`).
 *
 * @param user - Session user (or `null`/`undefined` when signed out).
 * @returns `true` when admin or active subscriber, otherwise `false`.
 */
export function deriveIsActive(user: {
  role?: Role;
  subscriptionStatus?: SubscriptionStatus;
} | null | undefined): boolean {
  if (!user) return false;
  return user.role === "admin" || user.subscriptionStatus === "active";
}
