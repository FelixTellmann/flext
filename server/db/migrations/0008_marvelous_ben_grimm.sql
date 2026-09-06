ALTER TABLE `Action` ADD `rescuedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `SenderPolicy` ADD `autonomyPromotedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `SyncRun` ADD `note` text;--> statement-breakpoint
CREATE INDEX `Action_mailboxId_status_appliedAt_idx` ON `Action` (`mailboxId`,`status`,`appliedAt`);