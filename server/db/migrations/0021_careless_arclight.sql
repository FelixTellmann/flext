CREATE TABLE `UnsubscribeAttempt` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`senderAddress` varchar(320) NOT NULL,
	`mailboxId` varchar(191),
	`method` varchar(191) NOT NULL,
	`status` varchar(191) NOT NULL,
	`responseCode` int,
	`error` text,
	`attemptedAt` datetime(3) NOT NULL,
	CONSTRAINT `UnsubscribeAttempt_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `Message` ADD `listUnsubscribePost` varchar(191);--> statement-breakpoint
CREATE INDEX `UnsubscribeAttempt_senderAddress_attemptedAt_idx` ON `UnsubscribeAttempt` (`senderAddress`,`attemptedAt`);