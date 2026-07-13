-- US11 / Spec 011 — settings data integrity, additive only.
-- Hand-written (drizzle-kit generation requires DATABASE_URL which is
-- unset in this environment; matches the schema additions declared in
-- drizzle/schema.ts and drizzle/auth-schema.ts).
--
-- Reviewed against scripts/apply-migrations.mjs:27-38 TiDB rewrite rules:
--   - no DEFAULT (now()) — funnelConfiguredAt has NO default
--   - no DEFAULT on TEXT columns — metaAccountId is varchar(64) so a
--     default is fine but we keep it nullable so existing rows survive
--   - audit_log.event_type MODIFY uses the existing string-typed column
--
-- ⚠️  T037 (unique index) is INTENTIONALLY OMITTED from this file. It
-- cannot be applied while duplicate `(userId, adAccountId)` rows
-- exist on the table — it will fail on production. The diagnostic
-- (T023) → repair (T033) → verify-clean (T034) sequence must
-- complete BEFORE the unique index migration runs. The index will
-- be created as a separate migration once SC-006 is verified.

ALTER TABLE `funnelSettings` ADD COLUMN `metaAccountId` varchar(64);--> statement-breakpoint
ALTER TABLE `adAccounts` ADD COLUMN `funnelConfiguredAt` timestamp;--> statement-breakpoint
CREATE INDEX `user_ghlContactId_idx` ON `user` (`ghl_contact_id`);--> statement-breakpoint
ALTER TABLE `audit_log` MODIFY COLUMN `event_type` enum('signup','login','logout','email_verified','password_reset_requested','password_reset_completed','password_changed','login_failed','account_created','identity_email_merged','funnel_settings_unavailable') NOT NULL;