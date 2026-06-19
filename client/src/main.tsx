import { trpc } from "@/lib/trpc";
import { SUBSCRIPTION_REQUIRED } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

const UPGRADE_PATH = "/upgrade";
const SIGNIN_PATH = "/auth/signin";

/**
 * Centralized tRPC error subscriber.
 *
 * Handles two specific server-driven navigation cases (per
 * `contracts/route-guard.md` C4):
 *
 * - `code === "FORBIDDEN"` AND `message === SUBSCRIPTION_REQUIRED` →
 *   navigate to `/upgrade` (no generic toast — this is the stale-session
 *   safety net).
 * - `code === "UNAUTHORIZED"` → navigate to `/auth/signin`.
 *
 * Runs outside the wouter `<Router>` tree, so navigation uses
 * `window.location.assign(...)`. Idempotent against the current path.
 * All other errors are logged but left for callers to handle.
 *
 * @param error - The error raised by a tRPC query or mutation.
 */
const handleTrpcError = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const code = error.data?.code;
  const currentPath = window.location.pathname;

  if (code === "FORBIDDEN" && error.message === SUBSCRIPTION_REQUIRED) {
    if (currentPath !== UPGRADE_PATH) {
      window.location.assign(UPGRADE_PATH);
    }
    return;
  }

  if (code === "UNAUTHORIZED") {
    if (currentPath !== SIGNIN_PATH) {
      window.location.assign(SIGNIN_PATH);
    }
    return;
  }

  console.error("[API Error]", error);
};

/**
 * Subscribe to the TanStack Query cache so every tRPC error reaches
 * {@link handleTrpcError}.
 */
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    handleTrpcError(event.query.state.error);
  }
});

/**
 * Subscribe to the TanStack Query mutation cache so every tRPC mutation
 * error reaches {@link handleTrpcError}.
 */
queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    handleTrpcError(event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
