// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

/**
 * Round-12 Part A: stale-while-revalidate tests.
 *
 * The user said: "Right now, clicking refresh blocks the UI with a loading
 * state for the full ~30 seconds, even though the last successfully refreshed
 * data is already sitting in the database and could be shown instantly."
 *
 * We lock in two specific behaviors:
 *   1. While a refetch is in flight, the OLD data continues to render
 *      (no skeleton, no flash). React Query's `isLoading` is the right
 *      gate for the skeleton — and it's only true on the initial fetch
 *      (no cached data).
 *   2. A small "refreshing" banner appears during the in-flight period
 *      so the user knows a refresh is in progress.
 *
 * Implementation note: the full Dashboard is impractical to mount in
 * a unit test (its `result` runs runEngine synchronously over the mocked
 * data, which is fragile). Instead, this file tests the SWR gating
 * pattern at the React Query level — confirming that `isLoading` is
 * the correct gate, and that `isFetching` + `data` together correctly
 * present the SWR "old data visible" behavior.
 *
 * The component-level banner test is in
 * client/src/pages/Dashboard.swr-banner.test.tsx (separate file).
 */

const mocks = vi.hoisted(() => ({
  // dashboard.get mock state — React Query v5 shape:
  //   isLoading: true only on initial fetch (no cached data)
  //   isFetching: true whenever a fetch is in flight (incl. background)
  //   data: undefined on initial, then preserved across background fetches
  //   error: set when a fetch fails; the component decides whether to show
  //          an error state or keep showing the old data.
  dash: {
    data: undefined as unknown,
    isLoading: true,
    isError: false,
    error: null as unknown,
    isFetching: false,
    refetch: vi.fn(),
  },
  refresh: {
    mutate: vi.fn(),
    isPending: false,
  },
  utils: {
    dashboard: {
      get: {
        invalidate: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    dashboard: {
      get: {
        useQuery: () => mocks.dash,
      },
      refresh: {
        useMutation: (opts: {
          onSuccess?: (data: unknown) => void;
          onError?: (err: unknown) => void;
        }) => ({
          mutate: (vars: unknown) => {
            mocks.refresh.mutate(vars);
            if (opts?.onSuccess) opts.onSuccess({ ok: true });
          },
          isPending: mocks.refresh.isPending,
        }),
      },
      setCheck: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
    useUtils: () => mocks.utils,
  },
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/100", vi.fn()],
    useParams: () => ({ accountId: "100" }),
  };
});

// Heavy children — stubbed so we don't pull in runEngine etc.
vi.mock("@/components/DecisionTable", () => ({
  DecisionTable: () => createElement("div", { "data-testid": "decision-table-stub" }, "table"),
  SeriesObj: class {},
}));
vi.mock("@/components/TodayActions", () => ({
  TodayActions: () => null,
}));
vi.mock("@/components/PromotionList", () => ({
  PromotionList: () => null,
}));
vi.mock("@/components/DiagnosisSection", () => ({
  DiagnosisSection: () => null,
}));

import Dashboard from "@/pages/Dashboard";

// Minimal AccountSnapshotPayload stub for the "ready" state. Matches
// the structure the Dashboard reads (d.result.rows, d.result.summary,
// etc.) so the gating code at line 62 + 77 of Dashboard.tsx runs to
// completion and the children render.
const READY_SNAPSHOT = {
  state: "ready" as const,
  series: [],
  result: {
    rows: [],
    summary: {
      fetchedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      total_spend_3d: 100,
      bleed_daily: 5,
      counts: { kill: 0, watch: 0, continue: 0, rescue: 0, too_early: 0 },
      baselines: { ctrLinkMedian90: null, cpaMedian30: null, cpmAvg14: null, cpmNow: null },
      attributionStraddle: false,
      account_alert: null,
      account_funnel_cta: null,
      cadence: { state: "reminder" as const, message_ar: "تذكير" },
      top_3_actions: [],
    },
    targets: { unitTarget: 50 },
    currencySymbol: "$",
  },
  asOfDate: "2026-07-17",
  accountExternalId: null,
  checks: [],
  isDemo: false,
  settingsReviewDue: false,
  account_funnel_cta: null,
  targets: { unitTarget: 50 },
  currencySymbol: "$",
  currency: "USD",
  accountId: "act_x",
  fetchedAt: new Date().toISOString(),
  baselines: { ctrLinkMedian90: null, cpaMedian30: null, cpmAvg14: null, cpmNow: null },
  attributionStraddle: false,
  objects: [],
};

describe("Dashboard (round-12 Part A) — stale-while-revalidate gating", () => {
  beforeEach(() => {
    mocks.dash.data = READY_SNAPSHOT;
    mocks.dash.isLoading = false;
    mocks.dash.isError = false;
    mocks.dash.error = null;
    mocks.dash.isFetching = false;
    mocks.refresh.isPending = false;
    mocks.refresh.mutate.mockReset();
    mocks.utils.dashboard.get.invalidate.mockReset();
  });

  it("renders the OLD data on initial mount (no skeleton flash)", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("decision-table-stub")).toBeTruthy();
  });

  it("shows the SKELETON on initial load (isLoading=true, no data)", () => {
    mocks.dash.data = undefined;
    mocks.dash.isLoading = true;
    render(<Dashboard />);
    // No table stub rendered — the Skeleton path takes over.
    expect(screen.queryByTestId("decision-table-stub")).toBeNull();
  });

  it("keeps showing the OLD data while a refetch is in flight (isFetching=true, isLoading=false)", () => {
    mocks.dash.isFetching = true;
    render(<Dashboard />);
    // The OLD data is still there — the table stub is present.
    expect(screen.getByTestId("decision-table-stub")).toBeTruthy();
  });

  it("shows the refreshing banner only when refresh.isPending is true (Part A UX)", () => {
    mocks.refresh.isPending = false;
    const { rerender } = render(<Dashboard />);
    expect(screen.queryByTestId("refresh-in-flight-banner")).toBeNull();

    // Mark the refresh as pending and re-render. The banner appears.
    mocks.refresh.isPending = true;
    rerender(<Dashboard />);
    expect(screen.getByTestId("refresh-in-flight-banner")).toBeTruthy();
    // The OLD data is still rendered behind the banner.
    expect(screen.getByTestId("decision-table-stub")).toBeTruthy();
  });

  it("preserves the OLD data on refresh error (not wiped)", () => {
    render(<Dashboard />);
    // Simulate the failure path: dash.data still has the old snapshot
    // (React Query's keepPreviousData behavior), and dash.error is set.
    mocks.dash.isError = true;
    mocks.dash.error = new Error("refresh failed (background refetch)");
    render(<Dashboard />);
    // Asserting the production intent: OLD data is preserved on error.
    // If this fails, the gating logic regressed — tighten the gating or
    // add keepPreviousData to the query options.
    expect(screen.getByTestId("decision-table-stub")).toBeTruthy();
  });

  it("clicking the refresh button triggers the mutation (and onSuccess invalidates the cache)", async () => {
    render(<Dashboard />);
    const refreshBtn = screen.getByRole("button", { name: /تحديث/ });
    refreshBtn.click();
    expect(mocks.refresh.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh.mutate).toHaveBeenCalledWith({ adAccountId: 100 });
    await waitFor(() => {
      expect(mocks.utils.dashboard.get.invalidate).toHaveBeenCalled();
    });
  });
});
