import { useState } from "react";
import { Facebook } from "lucide-react";
import type { FacebookPageDisplay } from "@shared/qarar";

/**
 * Spec 013 — Facebook Pages card. Display-only (FR-020).
 *
 * Renders a list of the Facebook Pages the connected user manages, with
 * the page's profile picture, name, and follower count. Designed to sit
 * above the ad account picker on the Meta connection screen.
 *
 * Conditional rendering (FR-002): the component returns `null` when the
 * list is empty — no heading, no empty-state box, no placeholder.
 *
 * Truncation (FR-008, FR-008a): at most 5 Pages render initially; an
 * "عرض الكل" expander reveals the remainder in place when the user has
 * more than 5. With 5 or fewer Pages, no expander is shown.
 *
 * Follower count (FR-005, FR-006): `null` → omit the line entirely;
 * `0` → render as a real zero. Numerals live inside `.num` so they
 * render left-to-right inside the right-to-left layout (FR-006).
 *
 * Profile picture (FR-004): the picture URL is rendered directly with
 * an `onError` fallback to a neutral placeholder — Meta CDN URLs can
 * expire between syncs, and a broken image is never allowed to break
 * the row.
 *
 * Long names: truncate to a single line via CSS ellipsis; the full
 * name stays reachable via the `title` attribute (spec Edge Cases
 * "Very long Page names").
 */
const MAX_VISIBLE = 5;

function formatFollowers(n: number): string {
  // Locale-aware thousands grouping (English digits, but rendered LTR
  // by `.num` so the visual outcome is identical inside the RTL layout).
  return n.toLocaleString("en-US");
}

function PageAvatar({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div
        data-testid="pages-avatar-placeholder"
        aria-label={alt}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Facebook className="h-5 w-5" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="h-10 w-10 shrink-0 rounded-full bg-muted object-cover"
      onError={() => setErrored(true)}
    />
  );
}

export function FacebookPagesCard({ pages }: { pages: FacebookPageDisplay[] }) {
  // FR-002: hide the section entirely when there is nothing to render.
  if (pages.length === 0) return null;

  const [expanded, setExpanded] = useState(false);
  const hasMore = pages.length > MAX_VISIBLE;
  const visible = expanded ? pages : pages.slice(0, MAX_VISIBLE);

  return (
    <div
      data-testid="facebook-pages-card"
      className="rounded-xl border border-border/60 bg-card text-card-foreground shadow-sm"
    >
      <div className="px-6 pt-6">
        <h2 className="font-bold">صفحاتك على فيسبوك</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          للتأكد إنك وصّلت حساب ميتا الصحيح — هذه الصفحات اللي تديرها منه.
        </p>
      </div>
      <ul
        data-testid="facebook-pages-list"
        className="space-y-2 px-6 pb-6 pt-4"
      >
        {visible.map(p => (
          <li
            key={p.pageId}
            data-testid="facebook-page-row"
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <PageAvatar
                src={p.pictureUrl}
                alt={p.name ?? `صفحة ${p.pageId}`}
              />
              <div className="min-w-0">
                <div
                  className="truncate font-medium"
                  title={p.name ?? p.pageId}
                >
                  {p.name ?? p.pageId}
                </div>
                {p.followersCount !== null && (
                  <div className="num text-xs text-muted-foreground">
                    {formatFollowers(p.followersCount)} متابع
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="border-t border-border/60 px-6 py-3">
          <button
            type="button"
            data-testid="facebook-pages-toggle"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? "عرض أقل" : "عرض الكل"}
          </button>
        </div>
      )}
    </div>
  );
}