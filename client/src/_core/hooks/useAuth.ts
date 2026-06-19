import { useSession, signOut } from "@/lib/auth-client";
import { deriveIsActive } from "./isActive";

type Role = "user" | "admin";
type SubscriptionStatus = "active" | "inactive";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role?: Role;
  subscriptionStatus?: SubscriptionStatus;
  ghlContactId?: string | null;
}

export interface UseAuthResult {
  user: SessionUser | null;
  loading: boolean;
  isActive: boolean;
  refetch: () => Promise<unknown> | void;
  logout: () => Promise<void>;
}

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
