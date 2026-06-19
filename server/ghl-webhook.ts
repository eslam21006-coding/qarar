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
        res.status(200).json({ ignored: true, reason: "user not found" });
        return;
      }
      res.status(200).json({ ok: true, status });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[GHL Webhook] DB error ${message}`);
      res.status(500).json({ error: message });
    }
  }
);
