import { createAuthClient } from "better-auth/react";

// In dev, use the current origin to avoid CORS issues.
// In production, use VITE_APP_URL for cross-origin requests.
const isDev = import.meta.env.DEV;
const baseURL = isDev ? window.location.origin : (import.meta.env.VITE_APP_URL ?? window.location.origin);

export const authClient = createAuthClient({
  baseURL,
});

export const signIn = authClient.signIn;
export const signOut = authClient.signOut;
export const signUp = authClient.signUp;
export const useSession = authClient.useSession;
export const getSession = authClient.getSession;
