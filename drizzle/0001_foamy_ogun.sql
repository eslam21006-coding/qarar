CREATE TABLE `actionChecks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`adAccountId` int NOT NULL,
	`actionKey` varchar(128) NOT NULL,
	`done` boolean NOT NULL DEFAULT false,
	`day` varchar(10) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `actionChecks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `adAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`connectionId` int,
	`accountId` varchar(64) NOT NULL,
	`name` text,
	`currency` varchar(8) DEFAULT 'USD',
	`accountStatus` int,
	`selected` boolean NOT NULL DEFAULT false,
	`isDemo` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `funnelSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`adAccountId` int NOT NULL,
	`archetype` enum('paid_lto','free_lead','direct_call') NOT NULL DEFAULT 'paid_lto',
	`liveComponent` boolean NOT NULL DEFAULT false,
	`offerDescription` text,
	`ticketPrice` double DEFAULT 0,
	`aov` double NOT NULL DEFAULT 0,
	`htoPrice` double NOT NULL DEFAULT 0,
	`htoConversionRate` double NOT NULL DEFAULT 0,
	`frontEndRoas` double NOT NULL DEFAULT 1,
	`dailyBudget` double DEFAULT 0,
	`marketCplBenchmark` double,
	`arena` enum('interests','broad') NOT NULL DEFAULT 'broad',
	`bestInterest` text,
	`geoTiers` json,
	`lastReviewedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `funnelSettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metaConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fbUserId` varchar(64),
	`fbUserName` text,
	`encryptedToken` text NOT NULL,
	`tokenExpiresAt` timestamp,
	`scopes` text,
	`status` enum('active','expired','revoked') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `metaConnections_id` PRIMARY KEY(`id`),
	CONSTRAINT `metaConnections_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`adAccountId` int NOT NULL,
	`payload` json,
	`status` enum('pending','ready','error') NOT NULL DEFAULT 'ready',
	`errorMessage` text,
	`fetchedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `snapshots_id` PRIMARY KEY(`id`)
);
