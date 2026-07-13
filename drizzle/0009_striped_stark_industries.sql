ALTER TABLE `audit_log` MODIFY COLUMN `event_type` enum('signup','login','logout','email_verified','password_reset_requested','password_reset_completed','password_changed','login_failed','account_created','identity_email_merged','funnel_settings_unavailable') NOT NULL;--> statement-breakpoint
ALTER TABLE `user` MODIFY COLUMN `ghl_contact_id` varchar(64);--> statement-breakpoint
ALTER TABLE `adAccounts` ADD `funnelConfiguredAt` timestamp;--> statement-breakpoint
ALTER TABLE `funnelSettings` ADD `metaAccountId` varchar(64);--> statement-breakpoint
ALTER TABLE `funnelSettings` ADD CONSTRAINT `uq_funnelSettings_user_account` UNIQUE(`userId`,`adAccountId`);--> statement-breakpoint
CREATE INDEX `user_ghlContactId_idx` ON `user` (`ghl_contact_id`);