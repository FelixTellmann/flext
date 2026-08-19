CREATE TABLE `Action` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`messageId` varchar(191) NOT NULL,
	`senderPolicyId` varchar(191),
	`kind` varchar(191) NOT NULL,
	`status` varchar(191) NOT NULL DEFAULT 'shadow',
	`fromStateJson` text,
	`toStateJson` text,
	`runId` varchar(191) NOT NULL,
	`decidedAt` datetime(3),
	`appliedAt` datetime(3),
	`error` text,
	CONSTRAINT `Action_id` PRIMARY KEY(`id`),
	CONSTRAINT `Action_messageId_kind_runId_key` UNIQUE(`messageId`,`kind`,`runId`)
);
--> statement-breakpoint
CREATE TABLE `NeverTouchRule` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`kind` varchar(191) NOT NULL,
	`value` varchar(512) NOT NULL,
	`note` text,
	CONSTRAINT `NeverTouchRule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `SenderPolicy` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`scope` varchar(191) NOT NULL,
	`value` varchar(320) NOT NULL,
	`action` varchar(191) NOT NULL,
	`client` varchar(191),
	`topic` varchar(191),
	`autonomy` varchar(191) NOT NULL DEFAULT 'shadow',
	`source` varchar(191) NOT NULL,
	`suspendedAt` datetime(3),
	`suspensionReason` text,
	CONSTRAINT `SenderPolicy_id` PRIMARY KEY(`id`),
	CONSTRAINT `SenderPolicy_scope_value_key` UNIQUE(`scope`,`value`)
);
--> statement-breakpoint
CREATE TABLE `SenderSuppression` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`senderAddress` varchar(320) NOT NULL,
	`reason` text NOT NULL,
	CONSTRAINT `SenderSuppression_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ThreadState` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`threadKey` varchar(512) NOT NULL,
	`mailboxId` varchar(191) NOT NULL,
	`state` varchar(191) NOT NULL DEFAULT 'open',
	`snoozedUntil` datetime(3),
	CONSTRAINT `ThreadState_id` PRIMARY KEY(`id`),
	CONSTRAINT `ThreadState_mailboxId_threadKey_key` UNIQUE(`mailboxId`,`threadKey`)
);
--> statement-breakpoint
CREATE INDEX `Action_status_decidedAt_idx` ON `Action` (`status`,`decidedAt`);--> statement-breakpoint
CREATE INDEX `Action_senderPolicyId_idx` ON `Action` (`senderPolicyId`);--> statement-breakpoint
CREATE INDEX `ThreadState_state_snoozedUntil_idx` ON `ThreadState` (`state`,`snoozedUntil`);