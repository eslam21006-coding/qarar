# Quickstart & Validation: GHL Auto-Provisioning (Batch 5)

A run/validation guide proving the feature works end-to-end. Implementation
details live in [plan.md](./plan.md), [research.md](./research.md),
[data-model.md](./data-model.md), and
[contracts/ghl-webhook-autoprovision.md](./contracts/ghl-webhook-autoprovision.md).

## Prerequisites

- Node + project deps installed (`pnpm install`).
- For unit/integration tests: nothing extra — `getDb()` and the Better Auth
  provisioner are mocked (see `server/ghl-webhook.test.ts` style).
- For a manual local run: a reachable MySQL via `DATABASE_URL`, and
  `BETTER_AUTH_URL` set (e.g. `http://localhost:3000` locally,
  `https://app.adqarar.com` in prod). Leave `GHL_WEBHOOK_SECRET` unset locally
  to skip signature verification.

## Automated validation (primary)

```bash
pnpm exec vitest run server/ghl-webhook.test.ts   # feature + regression suite
pnpm run check                                     # zero TypeScript errors
pnpm test                                          # full suite stays green
```

**Expected**: all existing GHL webhook tests pass unchanged (plus the additive
`newUser:false` on existing-user responses), and the new auto-provision tests
pass. `pnpm run check` reports no errors.

### Scenarios the tests must cover (maps to spec acceptance criteria)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `InvoicePaid`, unknown email, valid signature | provisions one active+verified user; `200 { ok, status:"active", newUser:true, setPasswordUrl }` |
| 2 | `ContactTagUpdate` adds active tag, unknown email | same as #1 |
| 3 | Activating event, **known** email | `200 { ok, status:"active", newUser:false }`, **no** `setPasswordUrl`; no new user |
| 4 | Two identical activating events, same unknown email | provision called once; second resolves to existing (`newUser:false`); one account total |
| 5 | Deactivating event, unknown email | `200 { ignored:true, reason:"user not found" }`; provision **not** called |
| 6 | `extractName` table (contact.name / first+last / name / first+last / email-prefix) | correct non-empty name each shape |
| 7 | Empty/null email | `200 { ignored:true, reason:"no email" }`; no provision |
| 8 | Token generation throws after user created | `200 { ok, status:"active", newUser:true }` (no URL) |
| 9 | Temp password generator | returns ≥ 32 chars, random |
| 10 | Account creation throws (non-race DB error) | `500 { error }` |

## Manual end-to-end (local, optional)

1. Start the server: `npm run dev` (or the project's dev command).
2. Fire an activating webhook for a brand-new email (no signature needed locally):

   ```bash
   curl -i -X POST http://localhost:3000/api/webhooks/ghl \
     -H "Content-Type: application/json" \
     -d '{"type":"InvoicePaid","email":"newbuyer@example.com","contact":{"name":"New Buyer"}}'
   ```

   **Expected**: `200` with
   `{ "ok": true, "status": "active", "newUser": true, "setPasswordUrl": "http://localhost:3000/auth/reset-password?token=…" }`.
   Server logs `[GHL Webhook] Created new user: newbuyer@example.com` and
   `[GHL Webhook] Set-password URL generated for: newbuyer@example.com`.

3. Open the `setPasswordUrl` in a browser → set a password on the Arabic
   reset-password page → submit. **Expected**: success, redirect to sign-in.
4. Sign in with that email + the new password. **Expected**: dashboard loads
   immediately (account is active + email-verified). This validates the R-006
   reset-password fix.
5. Re-fire the same webhook (step 2). **Expected**: `200 { ok, status:"active",
   newUser:false }`, **no** `setPasswordUrl`, and **no** duplicate account.
6. Fire a deactivating event for an unknown email:

   ```bash
   curl -i -X POST http://localhost:3000/api/webhooks/ghl \
     -H "Content-Type: application/json" \
     -d '{"type":"SubscriptionCancelled","email":"nobody@example.com"}'
   ```

   **Expected**: `200 { ignored:true, reason:"user not found" }`; no account created.

## Production smoke (founder, post-deploy — from spec)

1. Deploy to Manus.
2. In GHL, create a test contact with a brand-new email.
3. Fire a test `InvoicePaid` webhook to `/api/webhooks/ghl`.
4. Confirm the response contains `setPasswordUrl`.
5. Open it → set a password.
6. Log in at `app.adqarar.com` → dashboard visible.
7. Configure the GHL automation to email the `setPasswordUrl` to the buyer.

## Done = green

- All scenarios 1–10 pass; `npm run check` clean; full `npm test` green.
- Manual local flow reaches the dashboard after setting a password.
- No engine, client, or schema changes in the diff.
