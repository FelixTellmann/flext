ALTER TABLE `MailboxObservedAddress` MODIFY COLUMN `address` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `Message` MODIFY COLUMN `messageId` varchar(512);--> statement-breakpoint
ALTER TABLE `Message` MODIFY COLUMN `threadKey` varchar(512);--> statement-breakpoint
ALTER TABLE `Message` MODIFY COLUMN `fromAddress` varchar(320);--> statement-breakpoint
ALTER TABLE `Message` MODIFY COLUMN `fromDomain` varchar(253);--> statement-breakpoint
ALTER TABLE `Message` MODIFY COLUMN `fromName` varchar(320);--> statement-breakpoint
ALTER TABLE `Message` MODIFY COLUMN `listId` varchar(320);--> statement-breakpoint
ALTER TABLE `Sender` MODIFY COLUMN `address` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `Sender` MODIFY COLUMN `domain` varchar(253) NOT NULL;--> statement-breakpoint
ALTER TABLE `Sender` MODIFY COLUMN `displayName` varchar(320);