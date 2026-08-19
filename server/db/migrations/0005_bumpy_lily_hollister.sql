ALTER TABLE `Action` ADD `mailboxId` varchar(191);--> statement-breakpoint
CREATE INDEX `Action_mailboxId_status_idx` ON `Action` (`mailboxId`,`status`);