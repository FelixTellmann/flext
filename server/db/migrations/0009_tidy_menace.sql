ALTER TABLE `Mailbox` ADD `dwellSettledDays` int DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `dwellSuspendedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `dwellSuspensionReason` text;