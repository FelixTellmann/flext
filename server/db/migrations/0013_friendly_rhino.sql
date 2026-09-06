CREATE TABLE `PersonalArea` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`name` varchar(191) NOT NULL,
	`mode` varchar(191) NOT NULL DEFAULT 'always_on',
	`softFloorHours` int,
	`sortOrder` int NOT NULL DEFAULT 0,
	`archivedAt` datetime(3),
	CONSTRAINT `PersonalArea_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `PersonalProject` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`areaId` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`wakaProject` varchar(191),
	`sortOrder` int NOT NULL DEFAULT 0,
	`archivedAt` datetime(3),
	CONSTRAINT `PersonalProject_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `PersonalTask` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`areaId` varchar(191),
	`projectId` varchar(191),
	`title` varchar(512) NOT NULL,
	`notes` text,
	`state` varchar(191) NOT NULL DEFAULT 'inbox',
	`whenDate` datetime(3),
	`deadline` datetime(3),
	`planWeek` varchar(16),
	`poolOrder` int NOT NULL DEFAULT 0,
	`deferralCount` int NOT NULL DEFAULT 0,
	`estimateMinutes` int,
	`focus` boolean NOT NULL DEFAULT false,
	`completedAt` datetime(3),
	`cancelledAt` datetime(3),
	CONSTRAINT `PersonalTask_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `PersonalProject_areaId_idx` ON `PersonalProject` (`areaId`);--> statement-breakpoint
CREATE INDEX `PersonalTask_state_whenDate_idx` ON `PersonalTask` (`state`,`whenDate`);--> statement-breakpoint
CREATE INDEX `PersonalTask_planWeek_poolOrder_idx` ON `PersonalTask` (`planWeek`,`poolOrder`);