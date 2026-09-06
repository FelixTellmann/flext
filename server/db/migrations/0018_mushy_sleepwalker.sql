ALTER TABLE `Mailbox` ADD `authFailureCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `SyncRun` ADD `seenTransitions` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `SyncRun` ADD `flagChanges` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `SyncRun` ADD `repliesSent` int DEFAULT 0 NOT NULL;