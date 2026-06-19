ALTER TABLE `actionChecks` MODIFY COLUMN `userId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `adAccounts` MODIFY COLUMN `userId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `funnelSettings` MODIFY COLUMN `userId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `metaConnections` MODIFY COLUMN `userId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `snapshots` MODIFY COLUMN `userId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `verdictHistory` MODIFY COLUMN `userId` varchar(36) NOT NULL;