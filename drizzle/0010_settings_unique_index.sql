-- US11 / Spec 011 — T037 unique index migration (GATED ON T034).
--
-- ⚠️  DO NOT APPLY THIS MIGRATION BEFORE THE REPAIR (T033) HAS BEEN
-- RUN AND THE POST-REPAIR DIAGNOSTIC (T034) HAS RETURNED CLEAN.
-- The unique index CANNOT be created while duplicate rows exist on
-- `funnelSettings` for the same `(userId, adAccountId)` pair — it
-- will fail on production with a "Duplicate entry" error.
--
-- Migration sequencing (plan.md → Migration Sequencing):
--   1. Apply 0009_settings_data_integrity.sql   (additive columns)
--   2. Run scripts/backfill-settings-integrity.ts  (idempotent backfill)
--   3. Run scripts/diagnose-settings.ts --all    (T023 — record findings)
--   4. Run scripts/repair-settings.ts --all --commit  (T033)
--   5. Run scripts/diagnose-settings.ts --all    (T034 — verify clean)
--   6. APPLY THIS FILE                          (T037 — unique index)
--
-- Reviewed against scripts/apply-migrations.mjs:27-38 TiDB rewrite rules:
-- no DEFAULT (now()), no DEFAULT on TEXT — neither applies here.

CREATE UNIQUE INDEX `uq_funnelSettings_user_account` ON `funnelSettings` (`userId`, `adAccountId`);