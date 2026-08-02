CREATE TABLE `facebookPages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` varchar(36) NOT NULL,
	`connectionId` int,
	`pageId` varchar(64) NOT NULL,
	`name` text,
	`pictureUrl` text,
	`followersCount` int,
	`syncedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `facebookPages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_facebookPages_user_page` UNIQUE(`userId`,`pageId`)
);
--> statement-breakpoint
ALTER TABLE `metaConnections` ADD `pagesNoticeDismissedAt` timestamp;