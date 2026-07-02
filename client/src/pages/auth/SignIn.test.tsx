// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    useLocation: () => ["/auth/signin", mocks.navigate],
  };
});

import SignIn from "@/pages/auth/SignIn";

/**
 * Regression tests for the bug where a successful sign-in appeared to
 * stall because:
 *
 *   1. SignIn uses raw `fetch('/api/auth/sign-in/email', ...)` so it can
 *      surface the 429 retry-after body Better Auth's client swallows.
 *   2. The Better Auth client-side session atom was therefore never
 *      notified about the new cookie, so `useSession()` kept reporting
 *      `data: null`.
 *   3. PublicAuthRoute (the gate around <SignIn />) only fires its
 *      redirect effect when `user` flips truthy — and that never
 *      happened automatically, so the post-login navigation looked
 *      delayed/indefinite.
 *
 * Fix: SignIn must call `useAuth().refetch()` after a successful response
 * and await it before navigating. The test below pins that contract.
 */
describe("SignIn post-login navigation", () => {
  let originalFetch: typeof fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("calls refetch() and navigates to / within a bounded time after a successful sign-in", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: false,
      isActive: false,
      refetch,
      logout: vi.fn(),
    });

    // SignIn does two fetches: /api/auth/check-email then /api/auth/sign-in/email
    fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/api/auth/check-email")) {
        return Promise.resolve(mockJsonResponse({ exists: true }));
      }
      if (url.endsWith("/api/auth/sign-in/email")) {
        return Promise.resolve(mockJsonResponse({ ok: true }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SignIn />);

    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "correct horse battery staple" },
    });

    fireEvent.click(screen.getByRole("button", { name: /دخول/ }));

    // After a successful response, refetch must be awaited before
    // navigation. Within a bounded number of microtask flushes the
    // navigate("/") call must have fired.
    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("does not navigate on a 429 (rate limited) response", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: false,
      isActive: false,
      refetch,
      logout: vi.fn(),
    });

    fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/api/auth/check-email")) {
        return Promise.resolve(mockJsonResponse({ exists: true }));
      }
      if (url.endsWith("/api/auth/sign-in/email")) {
        return Promise.resolve(
          mockJsonResponse({ retryAfter: Date.now() + 60_000 }, 429)
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SignIn />);

    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "wrong" },
    });

    fireEvent.click(screen.getByRole("button", { name: /دخول|محظور/ }));

    await waitFor(() => {
      // The rate-limit banner copy is shown
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refetch).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows the Arabic 'no account' message and does not refetch when email is unknown", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: false,
      isActive: false,
      refetch,
      logout: vi.fn(),
    });

    fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/api/auth/check-email")) {
        return Promise.resolve(mockJsonResponse({ exists: false }));
      }
      return Promise.reject(new Error(`Should not be called: ${url}`));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SignIn />);

    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "anything" },
    });

    fireEvent.click(screen.getByRole("button", { name: /دخول/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/لا يوجد حساب بهذا البريد الإلكتروني/)
      ).toBeInTheDocument();
    });
    expect(refetch).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
