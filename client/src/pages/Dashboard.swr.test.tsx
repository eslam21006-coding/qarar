// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";

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
  // Spec 015 / T073 — the stub owns a level state like the real table, so a
  // test can switch campaign / ad set / ad and prove the summary counters
  // do not move with the view (FR-030d).
  DecisionTable: () => {
    const [level, setLevel] = useState("campaign");
    return createElement(
      "div",
      { "data-testid": "decision-table-stub", "data-level": level },
      "table",
      ...["campaign", "adset", "ad"].map(l =>
        createElement(
          "button",
          { key: l, "data-testid": `level-${l}`, onClick: () => setLevel(l) },
          l
        )
      )
    );
  },
  SeriesObj: class {},
}));
vi.mock("@/components/TodayActions", () => ({
  TodayActions: () => null,
}));
vi.mock("@/components/PromotionList", () => ({
  PromotionList: () => null,
}));
// NOTE: there is deliberately no `DiagnosisSection` mock here.
// `DiagnosisSection` is defined inside `@/pages/Dashboard` itself — the
// module under test — so it cannot be stubbed from outside. An earlier
// `vi.mock("@/components/DiagnosisSection", ...)` pointed at a path that
// has never existed and was silently inert (self-review F6). The real
// component renders; `DiagnosisSection.test.tsx` covers it directly.

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
    const { rerender } = render(<Dashboard />);
    // Simulate the failure path: dash.data still has the old snapshot
    // (React Query's keepPreviousData behavior), and dash.error is set.
    mocks.dash.isError = true;
    mocks.dash.error = new Error("refresh failed (background refetch)");
    // Re-render the SAME instance (not a second mount) so the assertion
    // reflects the error-state render, not a stale first table left in the
    // DOM. With the gate fixed to `!dash.data`, the cached table survives.
    rerender(<Dashboard />);
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

// ===========================================================================
// Spec 012 / SC-021 / FR-019c — the target tile MUST NOT render "∞"
// (money()'s silent default for null/undefined inputs) when
// unitTarget is null. The tile must render "—" as the Arabic phrase
// sentinel. We snapshot the rendered text content of the container to
// catch any literal "∞" that might leak through the chain of
// `value={money(…)}`-style call sites on Dashboard.tsx.
// ===========================================================================

describe("Dashboard (spec 012) — no '∞' rendering on null targets (SC-021)", () => {
  beforeEach(() => {
    mocks.dash.data = undefined;
    mocks.dash.isLoading = true;
    mocks.dash.isError = false;
    mocks.dash.error = null;
    mocks.dash.isFetching = false;
    mocks.refresh.isPending = false;
    mocks.refresh.mutate.mockReset();
    mocks.utils.dashboard.get.invalidate.mockReset();
  });

  function makeSnapshotWithUnitTarget(unitTarget: number | null) {
    return {
      ...READY_SNAPSHOT,
      result: { ...READY_SNAPSHOT.result, targets: { unitTarget } },
    };
  }

  it("unitTarget=null → target tile renders 'لم يتحدد بعد' (FR-019b), the rendered DOM contains no '∞'", () => {
    mocks.dash.data = makeSnapshotWithUnitTarget(null);
    mocks.dash.isLoading = false;
    const { container } = render(<Dashboard />);
    // SC-021 / FR-019c — when `unitTarget === null` the target tile
    // must render "—" as the explicit Arabic "not yet determined"
    // sentinel. We assert this at TWO levels:
    //   (a) the rendered DOM as a whole contains no "∞" (the
    //       money() default we must never leak), and
    //   (b) the closest enclosing div of the target label contains
    //       the "لم يتحدد بعد" phrase (FR-019b) — proving the value
    //       sibling rendered the explicit "not yet determined" copy
    //       rather than falling through to `money(null)` (which is "∞").
    const allText = container.textContent ?? "";
    expect(
      allText.includes("∞"),
      `rendered DOM contained "∞": ${allText}`
    ).toBe(false);

    // (b) Climb from the target-label node to its containing div.
    // The Stat component (Dashboard.tsx) wraps label + value in a
    // single <div class="min-w-[84px] shrink-0"> — the assertion
    // narrows the phrase check to that exact tile rather than the
    // whole document (where other stats render "—"). Use
    // .parentElement (not .closest("div")) because the label node
    // itself is a div — closest() would return it.
    const labelEl = Array.from(container.querySelectorAll("div")).find(el =>
      (el.textContent ?? "").trim() === "هدف تكلفة العميل"
    );
    expect(
      labelEl,
      "target-tile label 'هدف تكلفة العميل' not found"
    ).toBeTruthy();
    const tileRoot = labelEl?.parentElement;
    expect(
      tileRoot,
      "target tile has no enclosing parent element"
    ).toBeTruthy();
    const tileText = tileRoot?.textContent ?? "";
    expect(tileText).toContain("لم يتحدد بعد");
    expect(tileText).not.toContain("∞");
    expect(tileText).toContain("هدف تكلفة العميل");
  });

  it("unitTarget=42 → target tile renders a money-formatted number, still no '∞'", () => {
    mocks.dash.data = makeSnapshotWithUnitTarget(42);
    mocks.dash.isLoading = false;
    const { container } = render(<Dashboard />);
    const allText = container.textContent ?? "";
    expect(
      allText.includes("∞"),
      `rendered DOM contained "∞": ${allText}`
    ).toBe(false);
    // Money-formatted 42 with currency "$" → "$42". The exact rendering
    // is money()/num()/pct()-driven; we only assert "∞"-never-rendered.
    expect(allText).toContain("$42");
  });
});

// ===========================================================================
// Spec 015 / US8 (T073, FR-030a, FR-030d) — the red counter shows the split
// "للإيقاف: {N} مجموعة · {M} إعلان" from the summary, hides a zero part, and
// never moves when the table changes level.
// ===========================================================================
describe("Dashboard — split kill counter (spec 015 / US8)", () => {
  function withCounts(kill_adsets: number, kill_ads: number) {
    mocks.dash.data = {
      ...READY_SNAPSHOT,
      result: {
        ...READY_SNAPSHOT.result,
        summary: {
          ...READY_SNAPSHOT.result.summary,
          // counts.kill still includes a campaign row and must NOT be shown.
          counts: { kill: kill_adsets + kill_ads + 1, watch: 0, continue: 0, rescue: 0, too_early: 0 },
          kill_adsets,
          kill_ads,
        },
      },
    };
    mocks.dash.isLoading = false;
    mocks.dash.isError = false;
    mocks.dash.isFetching = false;
    mocks.refresh.isPending = false;
  }

  it("renders N مجموعة · M إعلان from the summary split, not counts.kill", () => {
    withCounts(2, 3);
    render(<Dashboard />);
    const counter = screen.getByTestId("kill-counter");
    // Self-review M2 — number–noun agreement: 2 → dual, 3–10 → plural.
    expect(counter.textContent).toContain("مجموعتان · 3 إعلانات");
    expect(counter.textContent).toContain("للإيقاف");
    expect(counter.textContent).not.toContain("6");
    // The numeral renders LTR in `.num`.
    expect(counter.querySelector(".num")?.textContent).toBe("3");
  });

  it("M2 — 11+ takes the singular tamyiz: 11 مجموعة · 25 إعلانًا", () => {
    withCounts(11, 25);
    render(<Dashboard />);
    expect(screen.getByTestId("kill-counter").textContent).toContain("11 مجموعة · 25 إعلانًا");
  });

  it("hides a zero part", () => {
    withCounts(0, 3);
    render(<Dashboard />);
    const text = screen.getByTestId("kill-counter").textContent ?? "";
    expect(text).toContain("3 إعلانات");
    expect(text).not.toContain("مجموعة");
  });

  it("both parts zero ⇒ reads as an all-clear 0", () => {
    withCounts(0, 0);
    render(<Dashboard />);
    const text = screen.getByTestId("kill-counter").textContent ?? "";
    expect(text).toContain("0");
    expect(text).not.toContain("مجموعة");
    expect(text).not.toContain("إعلان");
  });

  it("T073 — switching the table between campaign, ad-set and ad level changes neither counter", () => {
    withCounts(2, 3);
    render(<Dashboard />);
    const before = screen.getByTestId("kill-counter").textContent;
    for (const level of ["adset", "ad", "campaign"]) {
      fireEvent.click(screen.getByTestId(`level-${level}`));
      expect(screen.getByTestId("decision-table-stub").getAttribute("data-level")).toBe(level);
      expect(screen.getByTestId("kill-counter").textContent).toBe(before);
    }
  });
});

// ===========================================================================
// Spec 015 / US1 (FR-005, quickstart V3) — the settings-mismatch warning card
// renders at the top of the dashboard and links to Settings; it is absent
// when the flag is false.
// ===========================================================================
describe("Dashboard — settings-mismatch card (spec 015 / FR-005)", () => {
  function withFlag(settings_mismatch: boolean) {
    mocks.dash.data = {
      ...READY_SNAPSHOT,
      result: {
        ...READY_SNAPSHOT.result,
        summary: { ...READY_SNAPSHOT.result.summary, settings_mismatch },
      },
    };
    mocks.dash.isLoading = false;
    mocks.dash.isError = false;
    mocks.dash.isFetching = false;
    mocks.refresh.isPending = false;
  }

  it("flag true ⇒ the card shows, with a link to /settings/{accountId}", () => {
    withFlag(true);
    render(<Dashboard />);
    const link = screen.getByText("راجع نوع الفانل في الإعدادات");
    expect(link.closest("a")?.getAttribute("href")).toBe("/settings/100");
    expect(screen.getByText(/إعدادات الفانل تعدّ نوعًا من النتائج لا تسجله حملاتك/)).toBeTruthy();
  });

  it("flag false ⇒ no card", () => {
    withFlag(false);
    render(<Dashboard />);
    expect(screen.queryByText("راجع نوع الفانل في الإعدادات")).toBeNull();
  });
});
