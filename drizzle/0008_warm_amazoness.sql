CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`email` varchar(255),
	`event_type` enum('signup','login','logout','email_verified','password_reset_requested','password_reset_completed','password_changed','login_failed','account_created') NOT NULL,
	`status` enum('success','failed') NOT NULL DEFAULT 'success',
	`ip_address` text,
	`user_agent` text,
	`details` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_limit_log` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`action` varchar(64) NOT NULL,
	`request_count` int NOT NULL DEFAULT 1,
	`window_start` timestamp(3) NOT NULL DEFAULT (now()),
	`window_end` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `rate_limit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_userId_idx` ON `audit_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_log_email_idx` ON `audit_log` (`email`);--> statement-breakpoint
CREATE INDEX `audit_log_eventType_idx` ON `audit_log` (`event_type`);--> statement-breakpoint
CREATE INDEX `audit_log_createdAt_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `rate_limit_email_action_idx` ON `rate_limit_log` (`email`,`action`);--> statement-breakpoint
CREATE INDEX `rate_limit_windowEnd_idx` ON `rate_limit_log` (`window_end`);