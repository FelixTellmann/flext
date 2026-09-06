CREATE TABLE `FilingBinding` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`mailboxId` varchar(191) NOT NULL,
	`logicalPath` varchar(191) NOT NULL,
	`folder` varchar(191) NOT NULL,
	CONSTRAINT `FilingBinding_id` PRIMARY KEY(`id`),
	CONSTRAINT `FilingBinding_mailboxId_logicalPath_key` UNIQUE(`mailboxId`,`logicalPath`)
);
--> statement-breakpoint
ALTER TABLE `Action` ADD `targetPath` varchar(191);