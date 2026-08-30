ALTER TABLE `Mailbox` ADD `dwellDeclineCount` int DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `Mailbox` ADD `dwellNeedsActionDeclineCount` int DEFAULT 6 NOT NULL;