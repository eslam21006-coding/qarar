// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FacebookPagesCard } from "@/components/FacebookPagesCard";
import type { FacebookPageDisplay } from "@shared/qarar";

/**
 * Spec 013 / T014 — FacebookPagesCard rendering rules.
 *
 *   - FR-002: render nothing when the list is empty (no heading,
 *     no empty-state box, no placeholder).
 *   - FR-008, FR-008a: cap at 5 with an "عرض الكل" expander; no
 *     expander when there are 5 or fewer Pages.
 *   - FR-005: `followersCount: null` omits the follower line; `0`
 *     renders a real zero (not blank).
 *   - FR-004 / SC-002: missing `pictureUrl` falls back to a
 *     placeholder without breaking the row.
 *   - T029: demo account shows no Pages section.
 */
describe("FacebookPagesCard (T014 / US1 / FR-002/FR-004/FR-005/FR-008/FR-008a)", () => {
  it("renders nothing for an empty list (FR-002)", () => {
    const { container } = render(<FacebookPagesCard pages={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("facebook-pages-card")).toBeNull();
    expect(screen.queryByTestId("facebook-pages-list")).toBeNull();
  });

  it("renders nothing for demo mode — demo is a synthetic account with no Pages (T029)", () => {
    // Demo mode passes an empty list to the card (the parent Home
    // screen never calls `meta.pages` for demo accounts). The card
    // itself is the gate: any list, regardless of source, that is
    // empty renders `null`.
    const { container } = render(<FacebookPagesCard pages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders at most 5 Pages initially with an expander when there are more (FR-008)", () => {
    const pages: FacebookPageDisplay[] = Array.from({ length: 7 }, (_, i) => ({
      pageId: `p${i}`,
      name: `Page ${i}`,
      pictureUrl: null,
      followersCount: i * 10,
    }));
    render(<FacebookPagesCard pages={pages} />);
    expect(screen.getAllByTestId("facebook-page-row").length).toBe(5);
    expect(screen.getByTestId("facebook-pages-toggle")).toBeInTheDocument();
  });

  it("expanding reveals the remainder in place", () => {
    const pages: FacebookPageDisplay[] = Array.from({ length: 7 }, (_, i) => ({
      pageId: `p${i}`,
      name: `Page ${i}`,
      pictureUrl: null,
      followersCount: i * 10,
    }));
    render(<FacebookPagesCard pages={pages} />);
    expect(screen.getAllByTestId("facebook-page-row").length).toBe(5);
    fireEvent.click(screen.getByTestId("facebook-pages-toggle"));
    expect(screen.getAllByTestId("facebook-page-row").length).toBe(7);
  });

  it("does NOT show an expander at 5 or fewer Pages (FR-008a)", () => {
    const pages: FacebookPageDisplay[] = Array.from({ length: 5 }, (_, i) => ({
      pageId: `p${i}`,
      name: `Page ${i}`,
      pictureUrl: null,
      followersCount: i * 10,
    }));
    render(<FacebookPagesCard pages={pages} />);
    expect(screen.getAllByTestId("facebook-page-row").length).toBe(5);
    expect(screen.queryByTestId("facebook-pages-toggle")).toBeNull();

    // Also no expander with 1 page.
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "only",
            name: "Only Page",
            pictureUrl: null,
            followersCount: 1,
          },
        ]}
      />
    );
    expect(screen.queryByTestId("facebook-pages-toggle")).toBeNull();
  });

  it("omits the follower line when followersCount is null (FR-005)", () => {
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "p1",
            name: "Page One",
            pictureUrl: null,
            followersCount: null,
          },
        ]}
      />
    );
    expect(screen.queryByText(/متابع/)).toBeNull();
    expect(screen.getByText("Page One")).toBeInTheDocument();
  });

  it("renders a real zero when followersCount is 0 (FR-005, Edge Cases)", () => {
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "p2",
            name: "Zero Page",
            pictureUrl: null,
            followersCount: 0,
          },
        ]}
      />
    );
    // "0" must appear as visible text — distinct from "unavailable"
    // (which omits the line entirely).
    expect(screen.getByText(/0 متابع/)).toBeInTheDocument();
  });

  it("falls back to a placeholder avatar when pictureUrl is missing (FR-004 / SC-002)", () => {
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "p3",
            name: "No Pic",
            pictureUrl: null,
            followersCount: 5,
          },
        ]}
      />
    );
    expect(screen.getByTestId("pages-avatar-placeholder")).toBeInTheDocument();
    // Row still shows name + followers.
    expect(screen.getByText("No Pic")).toBeInTheDocument();
    expect(screen.getByText(/5 متابع/)).toBeInTheDocument();
  });

  it("swaps in the placeholder when an image fails to load (FR-004)", () => {
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "p4",
            name: "Bad URL",
            pictureUrl: "https://example.invalid/x.jpg",
            followersCount: 12,
          },
        ]}
      />
    );
    // Initially the <img> renders; trigger onError and verify the
    // placeholder takes over.
    const img = document.querySelector("img");
    expect(img).toBeTruthy();
    expect(screen.queryByTestId("pages-avatar-placeholder")).toBeNull();
    fireEvent.error(img!);
    expect(screen.getByTestId("pages-avatar-placeholder")).toBeInTheDocument();
    // Row text is unchanged.
    expect(screen.getByText("Bad URL")).toBeInTheDocument();
    expect(screen.getByText(/12 متابع/)).toBeInTheDocument();
  });

  it("formats follower counts with thousands separators and renders them via .num (FR-006)", () => {
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "p5",
            name: "Big Page",
            pictureUrl: null,
            followersCount: 1234567,
          },
        ]}
      />
    );
    const followerText = screen.getByText(/متابع/);
    expect(followerText.textContent).toContain("1,234,567");
    // .num class wraps digits in an LTR monospace context inside the
    // RTL layout. Confirm the class is applied to the line.
    expect(followerText.className).toContain("num");
  });

  it("long names truncate to a single line via ellipsis but stay reachable in title + aria-label (spec Edge Cases)", () => {
    const longName = "A".repeat(200);
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "p6",
            name: longName,
            pictureUrl: null,
            followersCount: 1,
          },
        ]}
      />
    );
    // Mouse / hover path: native title tooltip.
    const nameEl = screen.getByTitle(longName);
    expect(nameEl).toBeInTheDocument();
    // Keyboard / screen-reader path: aria-label on the (non-focusable)
    // div. `title` alone would not be reachable for keyboard or touch
    // users — CodeRabbit review fix (a11y).
    expect(nameEl.getAttribute("aria-label")).toBe(longName);
    // The `truncate` Tailwind class applies the CSS ellipsis. We
    // assert on the class list rather than computed style so the test
    // is environment-agnostic.
    expect(nameEl.className).toContain("truncate");
  });

  it("uses the pageId as a fallback when name is null", () => {
    render(
      <FacebookPagesCard
        pages={[
          {
            pageId: "1234567890",
            name: null,
            pictureUrl: null,
            followersCount: 1,
          },
        ]}
      />
    );
    // SC-002 — no listed Page renders as a blank or broken row. With
    // a null name the pageId becomes the visible label.
    expect(screen.getByText("1234567890")).toBeInTheDocument();
  });
});