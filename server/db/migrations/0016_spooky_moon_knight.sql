CREATE TABLE `AttentionSession` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`startedAt` datetime(3) NOT NULL,
	`endedAt` datetime(3) NOT NULL,
	`seenTransitions` int NOT NULL DEFAULT 0,
	`flagChanges` int NOT NULL DEFAULT 0,
	`repliesSent` int NOT NULL DEFAULT 0,
	`evidenceMailboxIds` text,
	CONSTRAINT `AttentionSession_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `AttentionSession_startedAt_idx` ON `AttentionSession` (`startedAt`);