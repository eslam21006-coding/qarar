type Role = "user" | "admin";
type SubscriptionStatus = "active" | "inactive";

export function deriveIsActive(user: {
  role?: Role;
  subscriptionStatus?: SubscriptionStatus;
} | null | undefined): boolean {
  if (!user) return false;
  return user.role === "admin" || user.subscriptionStatus === "active";
}
