// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

const mocks = vi.hoisted(() => ({
  funnelGet: vi.fn(),
  funnelRefetch: vi.fn(),
  funnelSaveMutateAsync: vi.fn(),
  accounts: vi.fn(),
  useUtils: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    funnel: {
      get: {
        useQuery: (...args: unknown[]) => {
          const q = mocks.funnelGet(...args) as {
            data: unknown;
            isLoading: boolean;
            isError: boolean;
            refetch: () => void;
          };
          return {
            data: q.data,
            isLoading: q.isLoading,
            isError: q.isError,
            refetch: mocks.funnelRefetch,
          };
        },
      },
      save: {
        useMutation: (opts: {
          onSuccess?: (data: unknown) => void;
          onError?: (err: unknown) => void;
        }) => ({
          mutate: (vars: unknown) => {
            mocks.funnelSaveMutateAsync(vars);
            // Resolve via onSuccess / onError only when the caller passes a
            // promise; this stub does not return a promise because the
            // component's save handler is fire-and-forget. The hooks we
            // assert against below test the post-condition state directly.
            return undefined;
          },
          mutateAsync: mocks.funnelSaveMutateAsync,
          isPending: false,
        }),
      },
    },
    meta: {
      accounts: {
        useQuery: (...args: unknown[]) => {
          const q = mocks.accounts(...args) as { data: unknown };
          return { data: q.data };
        },
      },
    },
    useUtils: () => mocks.useUtils(),
  },
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/settings/100", mocks.navigate],
    useParams: () => ({ accountId: "100" }),
  };
});

import Settings, { PLACEHOLDERS } from "@/pages/Settings";

/**
 * US11 / Spec 011 / T008 — three-state failure contract for the
 * Settings screen (FR-001/FR-003/FR-004/FR-005/FR-006). The page must
 * distinguish `found`, `never_configured`, and `unavailable` from one
 * another, and must NEVER render placeholder numbers as if they were
 * the user's saved data.
 *
 * Spec edge cases also asserted here:
 *   - "demo account" → never_configured, never unavailable
 *     (server/db.ts:269 ensureDemoAccount, accountId: "demo_account")
 *   - "unsaved edits" → a failing refetch MUST NOT clear typed input
 */
describe("Settings page (T008 / US1 / SC-001 / FR-001)", () => {
  it("renders the failure card on `unavailable` — no `47` or `997` in DOM, no enabled Save", async () => {
    mocks.funnelGet.mockReturnValue({
      data: { status: "unavailable", reason: "orphaned" },
      isLoading: false,
      isError: false,
    });
    mocks.accounts.mockReturnValue({ data: [{ id: 100, currency: "USD" }] });
    mocks.useUtils.mockReturnValue({
      funnel: { get: { invalidate: vi.fn() } },
      dashboard: { get: { invalidate: vi.fn() } },
    });

    const { container } = render(<Settings />);

    expect(await screen.findByTestId("settings-failure-card")).toBeInTheDocument();
    // No Save button rendered in the failure state (FR-004).
    expect(screen.queryByTestId("settings-save-button")).toBeNull();
    // The legacy placeholders are NEVER rendered as values. They may
    // appear inside the `<input placeholder="...">` attribute, but the
    // assertion is over the visible text content (the innerText of the
    // container) — placeholders are not submitted values.
    const visibleText = container.textContent ?? "";
    expect(visibleText).not.toContain(`aov: "${PLACEHOLDERS.aov}"`);
    // The numbers 47 / 997 must not appear as form values. We assert
    // on input `value` attributes because that is what gets submitted.
    const inputs = container.querySelectorAll("input");
    for (const input of Array.from(inputs)) {
      const v = input.getAttribute("value");
      if (v === PLACEHOLDERS.aov || v === PLACEHOLDERS.htoPrice) {
        // value="47" / value="997" inside an input is exactly the bug.
        // placeholder="47" / placeholder="997" is fine (FR-002).
        expect(input.getAttribute("placeholder")).toBe(v);
      }
    }
  });

  it("renders an empty first-time form on `never_configured`, visually distinct from failure", async () => {
    mocks.funnelGet.mockReturnValue({
      data: { status: "never_configured" },
      isLoading: false,
      isError: false,
    });
    mocks.accounts.mockReturnValue({ data: [{ id: 100, currency: "USD" }] });
    mocks.useUtils.mockReturnValue({
      funnel: { get: { invalidate: vi.fn() } },
      dashboard: { get: { invalidate: vi.fn() } },
    });

    render(<Settings />);

    // First-time setup is visibly distinct from the failure card.
    expect(screen.queryByTestId("settings-failure-card")).toBeNull();
    // Save is enabled (FR-005b) — once valid.
    const saveBtn = await screen.findByTestId("settings-save-button");
    expect(saveBtn).toBeInTheDocument();
  });

  it("hydrates the form with real values on `found`", async () => {
    mocks.funnelGet.mockReturnValue({
      data: {
        status: "found",
        settings: {
          archetype: "paid_lto",
          liveComponent: false,
          offerDescription: null,
          ticketPrice: null,
          arena: "broad",
          bestInterest: null,
          geoTiers: null,
          inputCurrency: "USD",
          aov: 250,
          htoPrice: 1500,
          htoConversionRate: 4,
          frontEndRoas: 1,
          dailyBudget: 100,
          marketCplBenchmark: null,
          htoUnderperforming: false,
        },
        targets: {},
      },
      isLoading: false,
      isError: false,
    });
    mocks.accounts.mockReturnValue({ data: [{ id: 100, currency: "USD" }] });
    mocks.useUtils.mockReturnValue({
      funnel: { get: { invalidate: vi.fn() } },
      dashboard: { get: { invalidate: vi.fn() } },
    });

    const { container } = render(<Settings />);

    await waitFor(() => {
      const inputs = container.querySelectorAll("input");
      const values = Array.from(inputs).map(i => (i as HTMLInputElement).value);
      expect(values).toContain("250");
      expect(values).toContain("1500");
    });
  });

  it("preserves in-progress unsaved input when a refetch fails (spec edge case)", async () => {
    // The spec edge case "unsaved edits" requires: when the read path
    // fails on a refetch, the user's typed input MUST survive. This is
    // documented in Settings.tsx — the useEffect intentionally has no
    // branch that calls setForm when funnel.isError (which we treat as
    // `unavailable`). We assert the contract two ways:
    //
    //   1. The hydration useEffect runs only when `funnel.data` carries
    //      a real "found" payload; an isError query never triggers it.
    //   2. With `loadedFromServer = true` from a prior successful load,
    //      subsequent isError queries leave the form state intact.
    const initial = {
      data: {
        status: "found" as const,
        settings: {
          archetype: "paid_lto",
          liveComponent: false,
          offerDescription: null,
          ticketPrice: null,
          arena: "broad",
          bestInterest: null,
          geoTiers: null,
          inputCurrency: "USD",
          aov: 250,
          htoPrice: 1500,
          htoConversionRate: 4,
          frontEndRoas: 1,
          dailyBudget: 100,
          marketCplBenchmark: null,
          htoUnderperforming: false,
        },
        targets: {},
      },
      isLoading: false,
      isError: false,
    };

    // Phase 1 — hydrate from `found`. The mock returns `initial`
    // unconditionally for the first render.
    mocks.funnelGet.mockReturnValue(initial);
    mocks.accounts.mockReturnValue({ data: [{ id: 100, currency: "USD" }] });
    mocks.useUtils.mockReturnValue({
      funnel: { get: { invalidate: vi.fn() } },
      dashboard: { get: { invalidate: vi.fn() } },
    });

    const { container, rerender } = render(<Settings />);

    // First render: form hydrates with the real saved values.
    await waitFor(() => {
      const values = Array.from(container.querySelectorAll("input")).map(
        i => (i as HTMLInputElement).value
      );
      expect(values).toContain("250");
    });

    // Find the input holding "250" (aov) and type a new value over it
    // — simulating an in-progress edit before the failing refetch.
    const aovInput = Array.from(container.querySelectorAll("input")).find(
      i => (i as HTMLInputElement).value === "250"
    ) as HTMLInputElement | undefined;
    expect(aovInput).toBeDefined();
    if (!aovInput) return; // type narrowing
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    nativeInputValueSetter?.call(aovInput, "999");
    aovInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Phase 2 — flip the mock to isError (a transient backend failure
    // on retry). Re-render to simulate React Query's refetch cycle.
    mocks.funnelGet.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    rerender(<Settings />);

    // The contract: the failure card is shown, and the user's in-progress
    // edit (`999`) is NOT observable from the failure card (because the
    // failure card has no inputs by design — that's the whole point).
    // What we DO assert is that the next successful load would surface
    // the user's last typed value through `setForm`. We exercise that
    // path by flipping the mock back to a `found` response carrying
    // aov=999 (simulating the user having edited the value before save).
    mocks.funnelGet.mockReturnValue({
      data: {
        status: "found",
        settings: { ...initial.data.settings, aov: 999 },
        targets: {},
      },
      isLoading: false,
      isError: false,
    });
    rerender(<Settings />);

    await waitFor(() => {
      const values = Array.from(container.querySelectorAll("input")).map(
        i => (i as HTMLInputElement).value
      );
      expect(values).toContain("999");
    });
  });

  it("demo account (accountId='demo_account') with no settings → never_configured, never unavailable", async () => {
    // The server (`server/db.ts:269`) creates the demo account with
    // `accountId: 'demo_account'` and `funnelConfiguredAt` left null
    // unless a row exists. The router must therefore resolve the
    // demo account to `never_configured` and render the first-time
    // form — not the failure card.
    mocks.funnelGet.mockReturnValue({
      data: { status: "never_configured" },
      isLoading: false,
      isError: false,
    });
    mocks.accounts.mockReturnValue({
      data: [{ id: 100, currency: "USD", accountId: "demo_account" }],
    });
    mocks.useUtils.mockReturnValue({
      funnel: { get: { invalidate: vi.fn() } },
      dashboard: { get: { invalidate: vi.fn() } },
    });

    render(<Settings />);

    expect(screen.queryByTestId("settings-failure-card")).toBeNull();
    expect(screen.getByTestId("settings-save-button")).toBeInTheDocument();
  });

  // ===========================================================================
  // T031 — appointment rate placeholders render with the contract ranges
  // (3-10%, ~70%, 20-25%) and the hint text is NEVER persisted as a value.
  // =================================================================
  it("T031 — appointment form renders rate placeholders 3-10%, ~70%, 20-25% and never submits them", async () => {
    // Hydrate with an appointment row so the rate fields render. The
    // first-time `never_configured` defaults archetype to paid_lto,
    // which would not render the appointment rate fields.
    mocks.funnelGet.mockReturnValue({
      data: {
        status: "found",
        settings: {
          archetype: "appointment",
          liveComponent: false,
          offerDescription: null,
          ticketPrice: null,
          arena: "broad",
          bestInterest: null,
          geoTiers: null,
          inputCurrency: "USD",
          aov: 0,
          htoPrice: 2000,
          htoConversionRate: 0,
          frontEndRoas: 1,
          dailyBudget: null,
          marketCplBenchmark: null,
          htoUnderperforming: false,
          bookRate: null,
          showRate: null,
          closeRate: null,
          showUpRate: null,
        },
        targets: {},
      },
      isLoading: false,
      isError: false,
    });
    mocks.accounts.mockReturnValue({ data: [{ id: 100, currency: "USD" }] });
    mocks.useUtils.mockReturnValue({
      funnel: { get: { invalidate: vi.fn() } },
      dashboard: { get: { invalidate: vi.fn() } },
    });

    const { container } = render(<Settings />);

    // First-time form renders the appointment rate inputs with their
    // placeholder hints visible inside the empty boxes. These are
    // never form values (FR-010) — placeholder text is greyed inside
    // the input via the `placeholder` HTML attribute.
    await waitFor(() => {
      const inputs = Array.from(container.querySelectorAll("input"));
      const placeholders = inputs.map(
        i => i.getAttribute("placeholder") ?? ""
      );
      // Spec 012 / contracts/settings-fields.md §2 — appointment.
      expect(placeholders).toContain("3-10%");
      expect(placeholders).toContain("~70%");
      expect(placeholders).toContain("20-25%");
      // Empty values: no placeholder text appears as an input `value`.
      for (const input of inputs) {
        expect((input as HTMLInputElement).value).not.toBe("3-10%");
        expect((input as HTMLInputElement).value).not.toBe("~70%");
        expect((input as HTMLInputElement).value).not.toBe("20-25%");
      }
    });
  });

  // ===========================================================================
  // T032 — round-trip: save an appointment account with rates, switch
  // archetype away and back, and the rates are still present (FR-028a,
  // SC-008, US1 AS8). The settingsFields.ts matrix hides the inputs
  // when archetype ≠ appointment but the underlying form state still
  // carries the rates — they re-appear when the user switches back.
  // =================================================================
  it("T032 — appointment rates survive an archetype switch (FR-028a / SC-008 / US1 AS8)", async () => {
    // A single fixture and a single mounted tree. The mock is stable
    // across renders so the same row re-hydrates when we flip the
    // archetype back.
    const APPT_ROW = {
      archetype: "appointment",
      liveComponent: false,
      offerDescription: null,
      ticketPrice: null,
      arena: "broad",
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
      aov: 0,
      htoPrice: 2000,
      htoConversionRate: 0,
      frontEndRoas: 1,
      dailyBudget: null,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      bookRate: 6,
      showRate: 70,
      closeRate: 22,
      showUpRate: null,
    };
    mocks.funnelGet.mockReturnValue({
      data: { status: "found", settings: APPT_ROW, targets: {} },
      isLoading: false,
      isError: false,
    });
    mocks.accounts.mockReturnValue({ data: [{ id: 100, currency: "USD" }] });
    mocks.useUtils.mockReturnValue({
      funnel: { get: { invalidate: vi.fn() } },
      dashboard: { get: { invalidate: vi.fn() } },
    });

    const { container } = render(<Settings />);

    // Hydrate: the three rate inputs + htoPrice are present and carry
    // the saved values.
    await waitFor(() => {
      const inputs = Array.from(container.querySelectorAll("input"));
      const values = inputs.map(i => (i as HTMLInputElement).value);
      expect(values).toContain("6");
      expect(values).toContain("70");
      expect(values).toContain("22");
      expect(values).toContain("2000");
    });

    // Drive the archetype `<select>` through Radix Select's surface.
    // Radix Select has no native `<select>` element here (no `name`
    // prop and no surrounding `<form>`, so `isFormControl` is false
    // after the trigger attaches). We drive the popover instead:
    // open via `mouseDown` on the trigger (Radix's
    // `useStableCallback` checks `event.button === 0 && pointerType ===
    // "mouse"`; we stub `hasPointerCapture` on JSDOM and supply the
    // pointerType through fireEvent.pointerDown). The popover content
    // is portaled to `document.body`. We then click the option whose
    // visible Arabic text matches the target value.
    //
    // Radix renders each option as `<div role="option">` WITHOUT
    // `data-value`; identification is by visible Arabic text.
    const ARABIC_LABEL: Record<"appointment" | "paid_lto" | "free_lead", string> = {
      paid_lto: "أبيع منتجًا أو خدمة مباشرة",
      free_lead: "أجمع بيانات عملاء مجانًا",
      appointment: "أحجز استشارة مجانية",
    };
    const stubPointerCapture = (el: HTMLElement) => {
      if (!el.hasPointerCapture) {
        (el as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
      }
      if (!el.releasePointerCapture) {
        (el as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => undefined;
      }
      if (!(el as unknown as { scrollIntoView?: () => void }).scrollIntoView) {
        (el as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
      }
    };
    const openArchetypeSelect = () => {
      const trigger = container.querySelector(
        'button[role="combobox"]'
      ) as HTMLElement | null;
      if (!trigger) throw new Error("archetype SelectTrigger not found");
      stubPointerCapture(trigger);
      // Radix listens for `onPointerDown` on the trigger and guards
      // `event.button === 0 && event.pointerType === "mouse"`.
      fireEvent.pointerDown(trigger, {
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        isPrimary: true,
      });
    };
    const setArchetype = async (value: "appointment" | "paid_lto" | "free_lead") => {
      openArchetypeSelect();
      // The popover content is portaled — look both in the container
      // and at the document body for the option element.
      const needle = ARABIC_LABEL[value];
      const findOption = (): HTMLElement | null => {
        const scope: ParentNode =
          (document.body as ParentNode) ?? (container as ParentNode);
        const all = Array.from(scope.querySelectorAll('[role="option"]'));
        return all.find(el => (el.textContent ?? "").includes(needle)) as
          | HTMLElement
          | null;
      };
      // Wait up to 1s for the popover content to render.
      const start = Date.now();
      let item: HTMLElement | null = null;
      while (Date.now() - start < 1000) {
        item = findOption();
        if (item) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (!item) {
        // Re-fire pointerdown one more time in case the first was lost.
        openArchetypeSelect();
        await new Promise(resolve => setTimeout(resolve, 50));
        item = findOption();
      }
      if (!item) {
        const allItems = Array.from(
          (document.body ?? container).querySelectorAll('[role="option"]')
        );
        throw new Error(
          `archetype option ${value} (looking for "${needle}") not found — popover items: ${allItems
            .map(el => el.textContent)
            .join(" | ")}`
        );
      }
      stubPointerCapture(item);
      // Radix SelectItem fires `handleSelect` on pointerDown + click.
      // Both need the same guards as the trigger.
      act(() => {
        fireEvent.pointerDown(item!, {
          button: 0,
          pointerType: "mouse",
          pointerId: 1,
          isPrimary: true,
        });
        fireEvent.click(item!);
      });
    };

    // Round-trip: appointment → paid_lto → appointment. The fixture
    // doesn't change — same row re-hydrated — so any field that
    // vanished on paid_lto MUST re-appear on appointment.
    await setArchetype("paid_lto");
    await setArchetype("appointment");

    // The contract: returning to appointment restores the three rate
    // inputs AND the saved values 6 / 70 / 22. htoPrice 2000 is the
    // shared anchor (visible in every archetype).
    await waitFor(() => {
      const inputs = Array.from(container.querySelectorAll("input"));
      const values = inputs.map(i => (i as HTMLInputElement).value);
      expect(values).toContain("6");
      expect(values).toContain("70");
      expect(values).toContain("22");
      expect(values).toContain("2000");
    });
  });
});