# Contract: `funnel.get` / `funnel.save`

**Feature**: `specs/011-settings-data-integrity` · Surface: tRPC (`server/routers.ts:208-250`)

## `funnel.get` — breaking change to the response shape

### Today

```ts
// server/routers.ts:211-225
get: activeProcedure
  .input(z.object({ adAccountId: z.number() }))
  .query(async ({ ctx, input }) => {
    const account = await requireAccount(ctx.user.id, input.adAccountId);
    const f = await db.getFunnel(ctx.user.id, input.adAccountId);
    if (!f) return { settings: null, targets: null };   // ← two causes, one shape
    return { settings: f, targets: deriveTargets(...) };
  }),
```

`{ settings: null }` is returned both when the user has never configured the account and when their
row exists but could not be found. **The client cannot distinguish them, so it guesses — and guesses
wrong, destructively.** That is the bug.

### After — a discriminated union

```ts
type FunnelGetResult =
  | { status: "found";            settings: FunnelSettings; targets: Targets }
  | { status: "never_configured" }
  | { status: "unavailable";      reason: "orphaned" | "identity_drift" | "unknown" }
```

| `status` | Meaning | Client behaviour |
|---|---|---|
| `found` | A real saved row (direct hit, or recovered via `metaAccountId` and self-healed) | Hydrate the form. Save enabled. |
| `never_configured` | No row, and `adAccounts.funnelConfiguredAt` is null — genuinely first-time | Empty first-time form. **No economics values pre-filled.** Save enabled. |
| `unavailable` | No row, but the account *was* configured before, or a sibling identity holds settings | **Failure state.** Render no economics values. Save **disabled**. Offer Retry, and an explicit "start fresh" confirmation. |

A thrown tRPC error (infrastructure failure) is treated by the client exactly as `unavailable`.

**Requirements**: FR-001, FR-003, FR-004, FR-010.

### Resolution order (server)

1. `getFunnel(userId, adAccountId)` — the existing indexed lookup. Hit → `found`.
2. Miss → look up by `(userId, metaAccountId)` where `metaAccountId` is the stable id of the account
   being viewed. Hit → **re-point the row's `adAccountId` to the current internal id** and return
   `found`. The orphan heals itself; the user sees nothing. (FR-031, FR-032)
3. Miss → if `adAccounts.funnelConfiguredAt` is null **and** no sibling identity (a different `user`
   row with the same `ghlContactId`) owns settings → `never_configured`.
4. Otherwise → `unavailable`, with `reason` set from whichever probe fired. Emit the structured log
   and the bounded audit record (FR-024, FR-025, FR-026).

Steps 2–4 run **only on the miss path**. The happy path is unchanged: one indexed read.

---

## `funnel.save` — new fresh-start guard

### Input

`funnelInputSchema` gains one field:

```ts
freshStart: z.boolean().optional().default(false)
```

The client sets `freshStart: true` **only** when the user reached the form through the explicit
"start fresh" confirmation from the `unavailable` state.

### Behaviour

| `freshStart` | Existing row at write time? | Result |
|---|---|---|
| `false` | — | Normal upsert (the existing path). |
| `true` | **no** | Insert. This is a legitimate fresh start. |
| `true` | **yes** | **REFUSED.** Do not write. Return `{ status: "found", settings: <existing>, targets }` so the client shows the user the data it just found. |

The third row is the whole point. It means a transient load failure — the user clicking "start
fresh" in good faith while their real record was merely unreachable — **cannot** destroy that
record. The check happens at write time, not load time, so it closes the race.

**Requirements**: FR-005, FR-006.

### Side effects

- On the first successful save for an account, set `adAccounts.funnelConfiguredAt` (FR-001).
- Always write `funnelSettings.metaAccountId` from the account already in hand (FR-031).
- The write itself is a single atomic `INSERT … ON DUPLICATE KEY UPDATE` under the composite unique
  key — not the current read-then-write (`server/db.ts:313-336`), which can interleave (FR-022).

---

## Client contract (`Settings.tsx`)

The `DEFAULTS` object (`Settings.tsx:43-59`) **must no longer be the initial form state.** Today
`useState<FormState>(DEFAULTS)` seeds `aov: "47"` and `htoPrice: "997"` before any data arrives, and
the hydrate effect (`:85-122`) leaves them in place whenever `settings` is null.

| State | Rendering |
|---|---|
| loading | Existing skeleton (`Settings.tsx:176-183`) — unchanged. |
| `found` | Hydrate from the server row (existing Path B, `:100-121`). |
| `never_configured` | Empty form. Numbers may appear as **greyed placeholder hints only** — never as values, never submitted unless typed (spec Assumptions). |
| `unavailable` | Failure card: simple-Arabic explanation, Retry, and a "start fresh" confirmation. **No economics fields rendered.** Save absent. |

Save is enabled only when `status === "found"`, or `status === "never_configured"`, or the user has
explicitly confirmed a fresh start. Never in the bare `unavailable` state (FR-004).

**Copy**: simple Modern Standard Arabic; numerals render LTR via `.num` inside the RTL layout
(Constitution III).
