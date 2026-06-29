/**
 * GHL Webhook — POST /api/webhooks/ghl
 *
 * Phase C external trigger that flips a user's `subscriptionStatus` when GHL
 * signals a payment/tag/cancel/void/delete event. Self-contained Express router
 * mounted in `server/_core/index.ts` BEFORE the global `express.json()` parser
 * so the raw body is preserved for signature verification (FR-002).
 *
 * Standing constraints:
 *  - 401 only on signature failure (no DB access on that path — FR-005).
 *  - Always 200 for known-safe events so GHL does not retry (FR-020).
 *  - At most one `user` row written per call, resolved by unique email (FR-018).
 *  - All handler logic wrapped in try/catch — no unhandled crashes (FR-022).
 */

import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { user } from "../drizzle/schema";
import {
  generatePasswordResetToken,
  buildPasswordResetUrl,
} from "./passwordReset";

/**
 * Resolve the Better Auth server context lazily. Using a dynamic import keeps
 * `server/ghl-webhook.ts` importable in tests that do not have
 * `DATABASE_URL` configured (the auth module instantiates a Drizzle handle
 * at module load). Production callers pay one dynamic-import cost per call.
 */
async function getAuthContext() {
  const { auth } = await import("./auth");
  return auth.$context;
}

/**
 * Random, never-exposed temporary password (≥32 chars, ≥192 bits of entropy).
 * Used solely to satisfy Better Auth's credential row at provisioning time —
 * the buyer immediately replaces it via the set-password link. Internal-only;
 * never logged or returned (R-003 / FR-002).
 */
export function generateTempPassword(): string {
  return crypto.randomBytes(24).toString("base64url"); // 32 chars, URL-safe
}

/**
 * Detect a unique-email (or otherwise race-recoverable) constraint violation
 * across MySQL/ORM error shapes. Used by provisionUserFromGhl to fold a
 * concurrent duplicate into the existing-user path (R-008 / FR-013).
 */
export function isUniqueEmailRaceError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: string; errno?: number; sqlState?: string; message?: string };
  const code = String(anyErr.code ?? "");
  const errno = Number(anyErr.errno ?? 0);
  const sqlState = String(anyErr.sqlState ?? "");
  const msg = String(anyErr.message ?? "");
  if (code === "ER_DUP_ENTRY" || errno === 1062) return true;
  if (sqlState === "23000" && /duplicate/i.test(msg)) return true;
  if (/UNIQUE|duplicate/i.test(msg) && /email/i.test(msg)) return true;
  return false;
}

/**
 * Provision a new active, email-verified Better Auth account for the buyer
 * (FR-001 / FR-001a / FR-002 / FR-005). Uses the Better Auth server context
 * to hash the temp password, create the user with `emailVerified: true`,
 * link a `credential` account, and write `subscriptionStatus: "active"` plus
 * `ghlContactId` when provided (R-001). Race-safe: on a unique-email
 * constraint violation the existing user is re-resolved and returned with
 * `created: false` so the caller falls through to the existing-user path
 * (R-008 / FR-013).
 */
export async function provisionUserFromGhl(input: {
  email: string;
  name: string;
  contactId: string | null;
}): Promise<{ userId: string; created: boolean }> {
  const email = (input.email ?? "").trim().toLowerCase();
  const name = (input.name ?? "").trim() || email || "user";
  const contactId = input.contactId ?? null;

  const ctx = await getAuthContext();
  const tempPassword = generateTempPassword();
  const hashed = await ctx.password.hash(tempPassword);

  let createdUserId: string;
  try {
    const created = await ctx.internalAdapter.createUser({
      email,
      name,
      emailVerified: true,
    } as unknown as Parameters<typeof ctx.internalAdapter.createUser>[0]);
    createdUserId = (created as { id: string }).id;
  } catch (err) {
    if (isUniqueEmailRaceError(err)) {
      const rows = await (await getDb())!
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      if (rows[0]) return { userId: rows[0].id, created: false };
    }
    throw err;
  }

  await ctx.internalAdapter.linkAccount({
    userId: createdUserId,
    providerId: "credential",
    accountId: createdUserId,
    password: hashed,
  } as unknown as Parameters<typeof ctx.internalAdapter.linkAccount>[0]);

  await ctx.internalAdapter.updateUser(createdUserId, {
    subscriptionStatus: "active",
    ...(contactId ? { ghlContactId: contactId } : {}),
  } as unknown as Parameters<typeof ctx.internalAdapter.updateUser>[1]);

  return { userId: createdUserId, created: true };
}

const ACTIVE_TAG_DEFAULT = "qarar-active";

const ACTIVATE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "InvoicePaid",
  "PaymentReceived",
  "OrderSubmitted",
]);

const DEACTIVATE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "InvoiceVoided",
  "SubscriptionCancelled",
  "ContactDeleted",
]);

export type SubscriptionStatus = "active" | "inactive";

export type Classification =
  | { action: "activate" }
  | { action: "deactivate" }
  | { action: "ignore"; reason: string };

/**
 * Verify the `x-ghl-signature` header against HMAC-SHA256(rawBody, secret).
 * Returns `true` (skip) when `secret` is unset/empty (FR-006). Returns `false`
 * on missing header, malformed hex, or length/computed mismatch. Uses
 * `crypto.timingSafeEqual` over equal-length buffers to avoid timing oracles
 * (FR-004 / FR-005).
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret) return true;
  if (typeof header !== "string" || header.length === 0) return false;

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  let expectedBuf: Buffer;
  let headerBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHex, "hex");
    headerBuf = Buffer.from(header, "hex");
  } catch {
    return false;
  }

  if (expectedBuf.length !== headerBuf.length) return false;
  if (expectedBuf.length === 0) return false;
  return crypto.timingSafeEqual(expectedBuf, headerBuf);
}

/**
 * First-present lookup of the customer email across known GHL payload shapes,
 * then normalized with `.trim().toLowerCase()` (FR-007 / FR-009). Returns
 * `null` when no non-empty string is found (FR-008).
 */
export function extractEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const candidates: unknown[] = [
    b.email,
    (b.contact as Record<string, unknown> | undefined)?.email,
    (b.invoice as Record<string, unknown> | undefined) &&
      ((b.invoice as Record<string, unknown>).contact as Record<string, unknown> | undefined)
        ?.email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * First-present lookup of the GHL contact id across known payload shapes
 * (FR-010). Returns `null` when no non-empty string is found. The id is
 * optional — when absent, `ghlContactId` is left unchanged on the user row
 * (FR-011).
 */
export function extractContactId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const contact = b.contact as Record<string, unknown> | undefined;
  const invoice = b.invoice as Record<string, unknown> | undefined;
  // Order per contracts/ghl-webhook.md: body.id → body.contactId →
  // body.contact.id → body.invoice.contactId.
  const candidates: unknown[] = [b.id, b.contactId, contact?.id, invoice?.contactId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function joinNonEmpty(parts: unknown[]): string | null {
  const joined = parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return joined.length > 0 ? joined : null;
}

function normalizeName(s: string | null): string | null {
  if (s === null) return null;
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Pure (no I/O) extractor for a non-empty display name from a GHL payload
 * (FR-004 / R-007). Precedence:
 *   contact.name → contact.firstName + contact.lastName →
 *   top-level name → top-level firstName + lastName → email prefix.
 * Whitespace is collapsed; never returns empty — when all candidates are
 * missing the email prefix is used, and if even that is empty the full
 * email is returned as the final fallback.
 */
export function extractName(body: unknown, email: string): string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const contact = (b.contact && typeof b.contact === "object"
    ? b.contact
    : {}) as Record<string, unknown>;

  const fromContactName = normalizeName(
    typeof contact.name === "string" ? contact.name : null
  );
  const fromContactSplit = joinNonEmpty([contact.firstName, contact.lastName]);
  const fromTopName = normalizeName(typeof b.name === "string" ? b.name : null);
  const fromTopSplit = joinNonEmpty([b.firstName, b.lastName]);

  for (const candidate of [fromContactName, fromContactSplit, fromTopName, fromTopSplit]) {
    if (candidate && candidate.length > 0) return candidate;
  }

  const normalizedEmail = (email ?? "").trim();
  const atIndex = normalizedEmail.indexOf("@");
  const prefix = atIndex > 0 ? normalizedEmail.slice(0, atIndex).trim() : "";
  if (prefix.length > 0) return prefix;
  return normalizedEmail.length > 0 ? normalizedEmail : "user";
}

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === "string");
}

/**
 * Pure event classifier (R4). Reads `body.type` and applies the FR-012/FR-013
 * rules. `OpportunityStatusUpdate` with `status !== "won"` and any unknown type
 * return `{ action: "ignore", reason }`. The active tag name is passed in so
 * the function stays pure and testable (FR-014).
 */
export function classifyEvent(body: unknown, activeTag: string): Classification {
  if (!body || typeof body !== "object") {
    return { action: "ignore", reason: "unknown type: undefined" };
  }
  const b = body as Record<string, unknown>;
  const type = typeof b.type === "string" ? b.type : null;

  if (type === "ContactTagUpdate") {
    const added = asStringArray(b.addedTags);
    const tags = asStringArray(b.tags);
    const removed = asStringArray(b.removedTags);
    if (added.includes(activeTag) || (added.length === 0 && tags.includes(activeTag))) {
      return { action: "activate" };
    }
    if (removed.includes(activeTag)) {
      return { action: "deactivate" };
    }
    return { action: "ignore", reason: `unknown type: ${type}` };
  }

  if (type === "OpportunityStatusUpdate") {
    if (b.status === "won") return { action: "activate" };
    return { action: "ignore", reason: "opportunity not won" };
  }

  if (type && ACTIVATE_EVENT_TYPES.has(type)) return { action: "activate" };
  if (type && DEACTIVATE_EVENT_TYPES.has(type)) return { action: "deactivate" };

  return { action: "ignore", reason: `unknown type: ${type}` };
}

/**
 * Resolve the user row by normalized email and apply a single-row update
 * setting `subscriptionStatus` (and `ghlContactId` when provided). Returns
 * `"updated"` when exactly one row was modified, `"not_found"` when the
 * email did not match (FR-019). Throws when no DB handle is available so the
 * caller maps that to `500 { error }` (FR-022).
 */
export async function setUserSubscriptionByEmail(
  email: string,
  status: SubscriptionStatus,
  contactId?: string | null
): Promise<"updated" | "not_found"> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalized))
    .limit(1);
  if (!rows[0]) return "not_found";
  const set: Record<string, unknown> = { subscriptionStatus: status };
  if (contactId) set.ghlContactId = contactId;
  await db.update(user).set(set).where(eq(user.id, rows[0].id));
  return "updated";
}

export const ghlWebhookRouter = express.Router();

/**
 * Single route — `POST /`. `express.raw({ type: "application/json" })` is
 * route-scoped so only this path receives `req.body` as a Buffer; every other
 * route keeps using the global JSON parser (FR-002 / FR-003).
 */
ghlWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const rawBody = req.body as Buffer;
      const secret = process.env.GHL_WEBHOOK_SECRET;
      const sigHeader = req.header("x-ghl-signature");

      if (!verifySignature(rawBody, sigHeader, secret)) {
        console.warn("[GHL Webhook] Signature mismatch — rejected");
        res.status(401).send("");
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        // Malformed JSON after signature passes is an unexpected error path
        // (spec edge case) → 500; never crash the process.
        console.error("[GHL Webhook] DB error malformed_json");
        res.status(500).json({ error: "malformed_json" });
        return;
      }

      const email = extractEmail(body);
      const type =
        body && typeof body === "object" && typeof (body as Record<string, unknown>).type === "string"
          ? ((body as Record<string, unknown>).type as string)
          : "?";
      // FR-023: log type and email exactly once per call. The `-` sentinel
      // keeps the line format stable when no email was extractable.
      console.log(`[GHL Webhook] type=${type} email=${email ?? "-"}`);

      const activeTag = process.env.GHL_ACTIVE_TAG || ACTIVE_TAG_DEFAULT;
      const classification = classifyEvent(body, activeTag);
      if (classification.action === "ignore") {
        res.status(200).json({ ignored: true, reason: classification.reason });
        return;
      }

      if (!email) {
        res.status(200).json({ ignored: true, reason: "no email" });
        return;
      }

      const contactId = extractContactId(body);
      const status: SubscriptionStatus =
        classification.action === "activate" ? "active" : "inactive";
      const result = await setUserSubscriptionByEmail(email, status, contactId);
      if (result === "not_found") {
        // ── Batch 5: not-found branch splits by action (FR-010 / FR-008) ──
        if (classification.action === "deactivate") {
          // Never provision on deactivating events (FR-010).
          res.status(200).json({ ignored: true, reason: "user not found" });
          return;
        }
        // Activate + unknown email → auto-provision (FR-001).
        const provision = await provisionUserFromGhl({
          email,
          name: extractName(body, email),
          contactId,
        });
        if (!provision.created) {
          // Race-recovery path (R-008 / FR-013): the user now exists — fall
          // through to the existing-user activation path so the row's
          // subscriptionStatus is ensured "active".
          await setUserSubscriptionByEmail(email, "active", contactId);
          res.status(200).json({ ok: true, status: "active", newUser: false });
          return;
        }
        console.log(`[GHL Webhook] Created new user: ${email}`);
        // FR-015 — token generation failure must not lose the activation.
        try {
          const token = await generatePasswordResetToken(
            email,
            72 * 60 * 60 * 1000
          );
          const setPasswordUrl = buildPasswordResetUrl(token);
          console.log(
            `[GHL Webhook] Set-password URL generated for: ${email}`
          );
          res
            .status(200)
            .json({ ok: true, status: "active", newUser: true, setPasswordUrl });
          return;
        } catch (tokenErr: unknown) {
          const tokenMsg =
            tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
          console.error(`[GHL Webhook] DB error ${tokenMsg}`);
          res.status(200).json({ ok: true, status: "active", newUser: true });
          return;
        }
      }
      res.status(200).json({ ok: true, status, newUser: false });
    } catch (e: unknown) {
      // Log the full internal message for operators, but return a generic
      // safe string to the caller — never echo DB / infra internals to an
      // external webhook source.
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[GHL Webhook] DB error ${message}`);
      res.status(500).json({ error: "internal_error" });
    }
  }
);
