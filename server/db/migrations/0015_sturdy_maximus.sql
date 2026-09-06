CREATE TABLE `PersonalReview` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`planWeek` varchar(16) NOT NULL,
	`openedAt` datetime(3) NOT NULL,
	`completedAt` datetime(3),
	`somedaySweptAt` datetime(3),
	`note` text,
	CONSTRAINT `PersonalReview_id` PRIMARY KEY(`id`),
	CONSTRAINT `PersonalReview_planWeek_key` UNIQUE(`planWeek`)
);
--> statement-breakpoint
CREATE TABLE `PersonalTaskDeferral` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`taskId` varchar(191) NOT NULL,
	`fromDate` datetime(3),
	`toDate` datetime(3),
	`reason` varchar(512),
	CONSTRAINT `PersonalTaskDeferral_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `PersonalTaskDeferral_taskId_idx` ON `PersonalTaskDeferral` (`taskId`);