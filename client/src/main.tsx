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

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    handleTrpcError(event.query.state.error);
  }
});

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
