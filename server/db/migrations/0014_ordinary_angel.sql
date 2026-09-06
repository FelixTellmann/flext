CREATE TABLE `ActivityBucket` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`bucketStart` datetime(3) NOT NULL,
	`project` varchar(191) NOT NULL,
	`share` decimal(5,4) NOT NULL,
	`seconds` int NOT NULL,
	CONSTRAINT `ActivityBucket_id` PRIMARY KEY(`id`),
	CONSTRAINT `ActivityBucket_bucketStart_project_key` UNIQUE(`bucketStart`,`project`)
);
--> statement-breakpoint
CREATE TABLE `WakaHeartbeat` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`sourceId` varchar(191) NOT NULL,
	`project` varchar(191),
	`language` varchar(191),
	`entity` text,
	`isWrite` boolean NOT NULL DEFAULT false,
	`occurredAt` datetime(3) NOT NULL,
	CONSTRAINT `WakaHeartbeat_id` PRIMARY KEY(`id`),
	CONSTRAINT `WakaHeartbeat_sourceId_key` UNIQUE(`sourceId`)
);
--> statement-breakpoint
CREATE INDEX `WakaHeartbeat_occurredAt_idx` ON `WakaHeartbeat` (`occurredAt`);