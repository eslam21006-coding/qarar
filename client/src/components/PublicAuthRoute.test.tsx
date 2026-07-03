// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";

// Hoisted mocks (vi.mock is hoisted, so these vars must be defined via vi.hoisted)
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
    useLocation: () => ["/auth/signin", mocks.navigate],
  };
});

import { PublicAuthRoute } from "@/components/PublicAuthRoute";

/**
 * Regression tests for the bug where `useSession().isPending` flipping true
 * on a background refetch (window focus, online, broadcast) would unmount
 * the public auth subtree, wiping in-progress form state.
 *
 * Contract (contracts/route-guard.md C2 + the in-file docstring on
 * PublicAuthRoute): only the FIRST session resolution is allowed to blank
 * the screen. Subsequent `loading` flips from background refetches must
 * leave children intact.
 */
describe("PublicAuthRoute re-render gating", () => {
  it("blanks the screen until the FIRST session resolution completes", () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: true,
      isActive: false,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    const { container } = render(
      <PublicAuthRoute>
        <div data-testid="signin-child">signin</div>
      </PublicAuthRoute>
    );

    expect(screen.queryByTestId("signin-child")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("renders children once the first session has resolved", () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: false,
      isActive: false,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <PublicAuthRoute>
        <div data-testid="signin-child">signin</div>
      </PublicAuthRoute>
    );

    expect(screen.getByTestId("signin-child")).toBeInTheDocument();
  });

  it("does NOT unmount children when a background refetch flips loading back to true", () => {
    // Simulates the user typing in /auth/signin, switching tabs, then
    // returning: Better Auth triggers a revalidation, isPending flips true,
    // and the bug unmounted <SignIn />. With the fix, children stay mounted.
    function Harness() {
      const [loading, setLoading] = useState(true);
      mocks.useAuth.mockReturnValue({
        user: null,
        loading,
        isActive: false,
        refetch: vi.fn(),
        logout: vi.fn(),
      });
      return (
        <>
          <button data-testid="flip-loading" onClick={() => setLoading(true)}>
            flip
          </button>
          <PublicAuthRoute>
            <div data-testid="signin-child">signin</div>
          </PublicAuthRoute>
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

    // First render: loading=true → blank
    expect(screen.queryByTestId("signin-child")).toBeNull();

    // Simulate the first session resolution completing
    screen.getByTestId("resolve-initial").click();
    rerender(<Harness />);

    expect(screen.getByTestId("signin-child")).toBeInTheDocument();

    // Background refetch flips loading back to true (signed-out users have
    // data === null, so Better Auth's onRequest sets isPending=true again).
    // With the bug this would unmount <SignIn />. With the fix the child
    // must remain mounted so form state survives the tab switch.
    screen.getByTestId("flip-loading").click();
    rerender(<Harness />);

    expect(screen.getByTestId("signin-child")).toBeInTheDocument();
  });

  it("redirects an authenticated active user to / on first resolution", () => {
    mocks.useAuth.mockReturnValue({
      user: { id: "u1", name: "Admin", email: "a@b.c" },
      loading: false,
      isActive: true,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <PublicAuthRoute>
        <div data-testid="signin-child">signin</div>
      </PublicAuthRoute>
    );

    expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(screen.queryByTestId("signin-child")).toBeNull();
  });

  it("redirects an authenticated !active user to /upgrade on first resolution", () => {
    mocks.useAuth.mockReturnValue({
      user: { id: "u1", name: "User", email: "u@b.c" },
      loading: false,
      isActive: false,
      refetch: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <PublicAuthRoute>
        <div data-testid="signin-child">signin</div>
      </PublicAuthRoute>
    );

    expect(mocks.navigate).toHaveBeenCalledWith("/upgrade", { replace: true });
    expect(screen.queryByTestId("signin-child")).toBeNull();
  });
});
