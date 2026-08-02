ALTER TABLE `funnelSettings` ADD `bookRate` double;--> statement-breakpoint
ALTER TABLE `funnelSettings` ADD `showRate` double;--> statement-breakpoint
ALTER TABLE `funnelSettings` ADD `showUpRate` double;--> statement-breakpoint
ALTER TABLE `funnelSettings` ADD `closeRate` double;--> statement-breakpoint
ALTER TABLE `funnelSettings` MODIFY COLUMN `archetype` enum('paid_lto','free_lead','appointment','webinar') NOT NULL DEFAULT 'paid_lto';