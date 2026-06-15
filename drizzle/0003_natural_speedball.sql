CREATE TABLE `verdictHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`adAccountId` int NOT NULL,
	`objectId` varchar(64) NOT NULL,
	`objectName` text,
	`level` enum('campaign','adset','ad') NOT NULL,
	`verdict` varchar(16) NOT NULL,
	`rule` varchar(8) NOT NULL,
	`cpa` double,
	`spend3d` double,
	`ctrLink` double,
	`evaluatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verdictHistory_id` PRIMARY KEY(`id`)
);
