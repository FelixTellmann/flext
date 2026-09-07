CREATE TABLE `PersonalAntiGoal` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`areaId` varchar(191) NOT NULL,
	`cycleId` varchar(191),
	`constraintText` varchar(191) NOT NULL,
	`status` varchar(191) NOT NULL DEFAULT 'holding',
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `PersonalAntiGoal_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `PersonalCycle` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`areaId` varchar(191) NOT NULL,
	`number` int NOT NULL,
	`startsOn` date NOT NULL,
	`endsOn` date NOT NULL,
	`suspendedAt` datetime(3),
	`resumedAt` datetime(3),
	`note` varchar(512),
	CONSTRAINT `PersonalCycle_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `PersonalGoal` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`areaId` varchar(191) NOT NULL,
	`slug` varchar(191),
	`title` varchar(191) NOT NULL,
	`kind` varchar(191) NOT NULL,
	`metric` varchar(191) NOT NULL,
	`direction` varchar(191) NOT NULL DEFAULT 'up',
	`baseline` decimal(12,2),
	`target` decimal(12,2),
	`unit` varchar(191),
	`startsOn` date,
	`dueOn` date,
	`status` varchar(191) NOT NULL DEFAULT 'active',
	`cycleId` varchar(191),
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `PersonalGoal_id` PRIMARY KEY(`id`),
	CONSTRAINT `PersonalGoal_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `PersonalGoalProgress` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`goalId` varchar(191) NOT NULL,
	`recordedOn` date NOT NULL,
	`value` decimal(12,2) NOT NULL,
	`note` varchar(512),
	CONSTRAINT `PersonalGoalProgress_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `PersonalPractice` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`areaId` varchar(191) NOT NULL,
	`goalId` varchar(191),
	`name` varchar(191) NOT NULL,
	`freqNum` int NOT NULL,
	`freqDen` int NOT NULL,
	`trigger` json,
	`retiredAt` datetime(3),
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `PersonalPractice_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `PersonalPracticeEntry` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`practiceId` varchar(191) NOT NULL,
	`occurredOn` date NOT NULL,
	`status` varchar(191) NOT NULL,
	`note` varchar(512),
	CONSTRAINT `PersonalPracticeEntry_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `PersonalReview` ADD `plannedCount` int;--> statement-breakpoint
ALTER TABLE `PersonalReview` ADD `completedCount` int;--> statement-breakpoint
ALTER TABLE `PersonalTask` ADD `goalId` varchar(191);--> statement-breakpoint
CREATE INDEX `PersonalAntiGoal_areaId_idx` ON `PersonalAntiGoal` (`areaId`);--> statement-breakpoint
CREATE INDEX `PersonalCycle_areaId_idx` ON `PersonalCycle` (`areaId`);--> statement-breakpoint
CREATE INDEX `PersonalGoal_areaId_idx` ON `PersonalGoal` (`areaId`);--> statement-breakpoint
CREATE INDEX `PersonalGoalProgress_goalId_recordedOn_idx` ON `PersonalGoalProgress` (`goalId`,`recordedOn`);--> statement-breakpoint
CREATE INDEX `PersonalPractice_areaId_idx` ON `PersonalPractice` (`areaId`);--> statement-breakpoint
CREATE INDEX `PersonalPractice_goalId_idx` ON `PersonalPractice` (`goalId`);--> statement-breakpoint
CREATE INDEX `PersonalPracticeEntry_practiceId_occurredOn_idx` ON `PersonalPracticeEntry` (`practiceId`,`occurredOn`);--> statement-breakpoint
CREATE INDEX `PersonalTask_goalId_idx` ON `PersonalTask` (`goalId`);--> statement-breakpoint
INSERT INTO PersonalSetting (`key`, value, updatedAt) VALUES ('execution_benchmark','85',NOW(3));