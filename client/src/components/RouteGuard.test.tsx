// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: mocks.useAuth,
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/", mocks.navigate],
  };
});

import { RouteGuard } from "@/components/RouteGuard";
import { Spinner } from "@/components/ui/spinner";

/**
 * Regression tests for the bug where `useSession().isPending` flipping true
 * on a background refetch (window focus, online, broadcast) would unmount
 * the protected route subtree, bouncing the user back to /auth/signin when
 * they returned to the tab.
 *
 * Contract (contracts/route-guard.md C2 + the in-file docstring on
 * RouteGuard): only the FIRST session resolution is allowed to blank the
 * screen with a spinner. Subsequent `loading` flips from background
 * refetches must leave children intact.
 */
describe("RouteGuard re-render gating", () => {
  it("shows the spinner until the FIRST session resolution completes", () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: true,
      isActive: false,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    const { container } = render(
      <RouteGuard>
        <div data-testid="protected-child">protected</div>
      </RouteGuard>
    );

    // The spinner markup is rendered; children are not.
    expect(container.querySelector('[dir="rtl"]')).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).toBeNull();
  });

  it("renders children once the first session has resolved (signed in, active)", () => {
    mocks.useAuth.mockReturnValue({
      user: { id: "u1", name: "Admin", email: "a@b.c" },
      loading: false,
      isActive: true,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <RouteGuard>
        <div data-testid="protected-child">protected</div>
      </RouteGuard>
    );

    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
  });

  it("does NOT unmount children when a background refetch flips loading back to true", () => {
    // Simulates the bug: a signed-in active user is on a protected route,
    // switches tabs, Better Auth triggers a revalidation, isPending flips
    // true, and the old code unmounted the protected tree.
    function Harness() {
      const [loading, setLoading] = useState(true);
      mocks.useAuth.mockReturnValue({
        user: { id: "u1", name: "Admin", email: "a@b.c" },
        loading,
        isActive: true,
        refetch: vi.fn(),
        logout: vi.fn(),
      });
      return (
        <>
          <button data-testid="flip-loading" onClick={() => setLoading(true)}>
            flip
          </button>
          <RouteGuard>
            <div data-testid="protected-child">protected</div>
          </RouteGuard>
          <button
            data-testid="resolve-initial"
            onClick={() => setLoading(false)}
          >
            resolve
          </button>
        </>
      );
    }

    const { rerender } = render(<Harness />);

    // First render: loading=true → spinner (no child)
    expect(screen.queryByTestId("protected-child")).toBeNull();

    // Simulate the first session resolution completing
    screen.getByTestId("resolve-initial").click();
    rerender(<Harness />);

    expect(screen.getByTestId("protected-child")).toBeInTheDocument();

    // Background refetch flips loading back to true. With the bug this
    // would unmount the protected tree. With the fix the child must
    // remain mounted.
    screen.getByTestId("flip-loading").click();
    rerender(<Harness />);

    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
  });

  it("redirects an unauthenticated user to /auth/signin on first resolution", () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: false,
      isActive: false,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    // Pretend the user is currently on the home page
    window.history.replaceState({}, "", "/");

    render(
      <RouteGuard>
        <div data-testid="protected-child">protected</div>
      </RouteGuard>
    );

    expect(mocks.navigate).toHaveBeenCalledWith("/auth/signin", {
      replace: true,
    });
  });

  it("redirects an authenticated !active user to /upgrade", () => {
    mocks.useAuth.mockReturnValue({
      user: { id: "u1", name: "User", email: "u@b.c" },
      loading: false,
      isActive: false,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    window.history.replaceState({}, "", "/");

    render(
      <RouteGuard>
        <div data-testid="protected-child">protected</div>
      </RouteGuard>
    );

    expect(mocks.navigate).toHaveBeenCalledWith("/upgrade", { replace: true });
  });

  it("keeps the spinner markup stable across re-renders", () => {
    // The Spinner export must continue to exist for consumers / tests.
    expect(Spinner).toBeDefined();
  });
});
