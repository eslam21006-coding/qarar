#!/usr/bin/env node
// Regenerate drizzle/0009_snapshot.json from drizzle/0008_snapshot.json
// by applying the four schema changes that ship in 0009.
//
// This is the deterministic equivalent of what `drizzle-kit generate`
// would produce — except it sidesteps the interactive prompts in
// non-TTY environments (PowerShell, CI, piped shells) by editing the
// snapshot directly.
//
// USAGE:
//   node scripts/regenerate-0009-snapshot.mjs
//
// IDEMPOTENT: regenerates the same file every time.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = resolve(here, "..", "drizzle");
const prevPath = resolve(drizzleDir, "meta", "0008_snapshot.json");
const outPath = resolve(drizzleDir, "meta", "0009_snapshot.json");

const snap = JSON.parse(readFileSync(prevPath, "utf8"));

// Bump the top-level id, prevId points to the previous migration's id.
snap.id = randomUUID();
snap.prevId = snap.id;
const prevId = "dd3d75ba-c3eb-46ab-ba31-16b536c46fc1"; // 0008's id
snap.prevId = prevId;

// --- Change 1: audit_log.event_type enum gains two values ----------------
// In the squashed snapshot the enum's members are NOT a separate `col.enum`
// array — they live inside the `type` string, e.g.
//   "type": "enum('signup',...,'account_created')".
// So we append the two new values to that string (idempotently). The earlier
// `Array.isArray(col.enum)` form was a silent no-op and left the snapshot's
// enum stale, which made `drizzle-kit generate` emit a phantom MODIFY.
for (const def of Object.values(snap.tables)) {
  if (def.name !== "audit_log") continue;
  for (const col of Object.values(def.columns)) {
    if (col.name !== "event_type") continue;
    if (typeof col.type !== "string" || !col.type.startsWith("enum(")) continue;
    for (const v of ["identity_email_merged", "funnel_settings_unavailable"]) {
      if (!col.type.includes(`'${v}'`)) {
        // insert before the closing ")" of enum(...)
        col.type = col.type.replace(/\)$/, `,'${v}')`);
      }
    }
  }
}

// --- Change 2: user.ghl_contact_id text -> varchar(64) -------------------
// Note: in the squashed snapshot, varchar(N) is encoded as the single
// string type "varchar(N)" — there is no separate `size` field.
for (const def of Object.values(snap.tables)) {
  if (def.name !== "user") continue;
  for (const col of Object.values(def.columns)) {
    if (col.name !== "ghl_contact_id") continue;
    col.type = "varchar(64)";
  }
}

// --- Change 3: adAccounts.funnelConfiguredAt (new column) ----------------
// drizzle-kit keys a table's `columns` map BY COLUMN NAME (see every
// other entry: "id", "userId", ...). Keying by anything else (e.g. a
// numeric id) makes `drizzle-kit generate` treat the name-keyed schema
// column as a brand-new ADD *and* the mis-keyed snapshot column as a
// stale DROP — producing a phantom ADD-then-DROP migration. So the key
// MUST equal the column name.
for (const def of Object.values(snap.tables)) {
  if (def.name !== "adAccounts") continue;
  def.columns["funnelConfiguredAt"] = {
    name: "funnelConfiguredAt",
    type: "timestamp",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  };
  // Also add to compositePrimaryKeys check — no PK here, skip.
  break;
}

// --- Change 4: funnelSettings.metaAccountId (new column) ---------------
// Note: in the squashed snapshot, varchar(N) is encoded as the single
// string type "varchar(N)". Key by column name (see Change 3).
for (const def of Object.values(snap.tables)) {
  if (def.name !== "funnelSettings") continue;
  def.columns["metaAccountId"] = {
    name: "metaAccountId",
    type: "varchar(64)",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  };
  break;
}

// NOTE: we DO NOT add user_ghlContactId_idx here. drizzle-kit's
// push script (the one the schema produces) creates that index as
// part of the `CREATE INDEX user_ghlContactId_idx ON user ...`
// statement that the schema file's `index("user_ghlContactId_idx")
// .on(table.ghlContactId)` declares. Drizzle-kit's snapshot
// representation includes indexes in the table's `indexes` object,
// so we must add it here too — otherwise `drizzle-kit check` will
// report a drift between the schema's index declaration and the
// snapshot.
for (const def of Object.values(snap.tables)) {
  if (def.name !== "user") continue;
  def.indexes = def.indexes || {};
  def.indexes["user_ghlContactId_idx"] = {
    name: "user_ghlContactId_idx",
    columns: ["ghl_contact_id"],
    isUnique: false,
  };
  break;
}

writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n", "utf8");
console.log(`[regenerate-0009-snapshot] wrote ${outPath}`);
console.log(`[regenerate-0009-snapshot] new id = ${snap.id}`);
console.log(`[regenerate-0009-snapshot] prevId = ${snap.prevId}`);