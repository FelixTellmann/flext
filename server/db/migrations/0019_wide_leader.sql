ALTER TABLE `Mailbox` ADD `firstContactAutonomy` varchar(191) DEFAULT 'shadow' NOT NULL;--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `firstContactAutonomySetAt` datetime(3);--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `settledSweepAutonomy` varchar(191) DEFAULT 'shadow' NOT NULL;--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `settledSweepAutonomySetAt` datetime(3);--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `declinedSweepAutonomy` varchar(191) DEFAULT 'shadow' NOT NULL;--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `declinedSweepAutonomySetAt` datetime(3);--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `firstContactSuspendedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `firstContactSuspensionReason` text;