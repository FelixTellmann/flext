CREATE TABLE `Account` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`userId` varchar(191) NOT NULL,
	`type` varchar(191) NOT NULL,
	`provider` varchar(191) NOT NULL,
	`providerAccountId` varchar(191) NOT NULL,
	`refreshToken` text,
	`refreshTokenExpiresIn` int,
	`accessToken` text,
	`expiresAt` int,
	`tokenType` varchar(191),
	`scope` varchar(191),
	`idToken` text,
	`sessionState` varchar(191),
	`oauthTokenSecret` varchar(191),
	`oauthToken` varchar(191),
	CONSTRAINT `Account_id` PRIMARY KEY(`id`),
	CONSTRAINT `Account_provider_providerAccountId_key` UNIQUE(`provider`,`providerAccountId`)
);
--> statement-breakpoint
CREATE TABLE `Books` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`read` boolean NOT NULL DEFAULT false,
	`published` boolean NOT NULL DEFAULT false,
	`name` varchar(191) NOT NULL,
	`asin` varchar(191),
	`isbn10` varchar(191),
	`author` varchar(191),
	`author_url` varchar(191),
	`image` varchar(191),
	`url` varchar(191),
	`rating` float NOT NULL DEFAULT 0,
	`votes` int NOT NULL DEFAULT 0,
	CONSTRAINT `Books_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `Mailbox` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`label` varchar(191) NOT NULL,
	`host` varchar(191) NOT NULL,
	`port` int NOT NULL DEFAULT 993,
	`username` varchar(191) NOT NULL,
	`flavor` varchar(191) NOT NULL DEFAULT 'generic',
	`accountIndex` int,
	`credentialCiphertext` text NOT NULL,
	`credentialIv` varchar(191) NOT NULL,
	`credentialAuthTag` varchar(191) NOT NULL,
	`credentialKeyVersion` int NOT NULL DEFAULT 1,
	`tlsPolicy` varchar(191) NOT NULL DEFAULT 'strict',
	`pinnedSpki` text,
	`identityAddresses` text,
	`hierarchyDelimiter` varchar(191),
	`canonicalFolder` varchar(191),
	`sentFolders` text,
	`trashRetentionDays` int,
	`enabled` boolean NOT NULL DEFAULT true,
	`backfilledAt` datetime(3),
	`lastError` text,
	`lastErrorAt` datetime(3),
	CONSTRAINT `Mailbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `Mailbox_host_username_key` UNIQUE(`host`,`username`)
);
--> statement-breakpoint
CREATE TABLE `MailboxCursor` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`mailboxId` varchar(191) NOT NULL,
	`folder` varchar(191) NOT NULL,
	`kind` varchar(191) NOT NULL DEFAULT 'messages',
	`uidValidity` varchar(191) NOT NULL,
	`lastSeenUid` int NOT NULL DEFAULT 0,
	`highestModseq` varchar(191),
	`lastSyncAt` datetime(3),
	`lastReconcileAt` datetime(3),
	CONSTRAINT `MailboxCursor_id` PRIMARY KEY(`id`),
	CONSTRAINT `MailboxCursor_mailboxId_folder_kind_key` UNIQUE(`mailboxId`,`folder`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `MailboxObservedAddress` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`mailboxId` varchar(191) NOT NULL,
	`address` varchar(191) NOT NULL,
	`sourceHeader` varchar(191) NOT NULL,
	`occurrences` int NOT NULL DEFAULT 0,
	`firstSeenAt` datetime(3),
	`lastSeenAt` datetime(3),
	CONSTRAINT `MailboxObservedAddress_id` PRIMARY KEY(`id`),
	CONSTRAINT `MailboxObservedAddress_mailboxId_address_sourceHeader_key` UNIQUE(`mailboxId`,`address`,`sourceHeader`)
);
--> statement-breakpoint
CREATE TABLE `Message` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`mailboxId` varchar(191) NOT NULL,
	`folder` varchar(191) NOT NULL,
	`uid` int NOT NULL,
	`uidValidity` varchar(191) NOT NULL,
	`gmMsgid` varchar(191),
	`gmThrid` varchar(191),
	`messageId` varchar(191),
	`threadKey` varchar(191),
	`senderId` varchar(191),
	`fromAddress` varchar(191),
	`fromDomain` varchar(191),
	`fromName` varchar(191),
	`toMe` boolean NOT NULL DEFAULT false,
	`ccMe` boolean NOT NULL DEFAULT false,
	`subject` text,
	`sentAt` datetime(3),
	`internalDate` datetime(3) NOT NULL,
	`size` int,
	`hasAttachment` boolean NOT NULL DEFAULT false,
	`listId` varchar(191),
	`listUnsubscribe` text,
	`precedence` varchar(191),
	`autoSubmitted` varchar(191),
	`dkimAligned` boolean,
	`isSeen` boolean NOT NULL DEFAULT false,
	`isFlagged` boolean NOT NULL DEFAULT false,
	`labels` text,
	`openedAt` datetime(3),
	`disappearedAt` datetime(3),
	CONSTRAINT `Message_id` PRIMARY KEY(`id`),
	CONSTRAINT `Message_mailboxId_folder_uidValidity_uid_key` UNIQUE(`mailboxId`,`folder`,`uidValidity`,`uid`),
	CONSTRAINT `Message_mailboxId_gmMsgid_key` UNIQUE(`mailboxId`,`gmMsgid`)
);
--> statement-breakpoint
CREATE TABLE `Sender` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`address` varchar(191) NOT NULL,
	`domain` varchar(191) NOT NULL,
	`displayName` varchar(191),
	`messageCount` int NOT NULL DEFAULT 0,
	`myReplyCount` int NOT NULL DEFAULT 0,
	`firstSeenAt` datetime(3),
	`lastSeenAt` datetime(3),
	CONSTRAINT `Sender_id` PRIMARY KEY(`id`),
	CONSTRAINT `Sender_address_key` UNIQUE(`address`)
);
--> statement-breakpoint
CREATE TABLE `Session` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`sessionToken` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`expires` datetime(3) NOT NULL,
	CONSTRAINT `Session_id` PRIMARY KEY(`id`),
	CONSTRAINT `Session_sessionToken_key` UNIQUE(`sessionToken`)
);
--> statement-breakpoint
CREATE TABLE `SyncRun` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`mailboxId` varchar(191) NOT NULL,
	`kind` varchar(191) NOT NULL,
	`status` varchar(191) NOT NULL DEFAULT 'running',
	`startedAt` datetime(3) NOT NULL,
	`finishedAt` datetime(3),
	`foldersSynced` int NOT NULL DEFAULT 0,
	`messagesNew` int NOT NULL DEFAULT 0,
	`messagesUpdated` int NOT NULL DEFAULT 0,
	`messagesVanished` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	CONSTRAINT `SyncRun_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `User` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`name` varchar(191),
	`email` varchar(191),
	`emailVerified` datetime(3),
	`password` varchar(191),
	`image` varchar(191),
	`registeredAt` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
	`acceptMarketing` boolean DEFAULT true,
	CONSTRAINT `User_id` PRIMARY KEY(`id`),
	CONSTRAINT `User_email_key` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `VerificationToken` (
	`identifier` varchar(191) NOT NULL,
	`token` varchar(191) NOT NULL,
	`expires` datetime(3) NOT NULL,
	CONSTRAINT `VerificationToken_token_key` UNIQUE(`token`),
	CONSTRAINT `VerificationToken_identifier_token_key` UNIQUE(`identifier`,`token`)
);
--> statement-breakpoint
CREATE INDEX `Message_mailboxId_messageId_idx` ON `Message` (`mailboxId`,`messageId`);--> statement-breakpoint
CREATE INDEX `Message_senderId_idx` ON `Message` (`senderId`);--> statement-breakpoint
CREATE INDEX `Sender_domain_idx` ON `Sender` (`domain`);--> statement-breakpoint
CREATE INDEX `SyncRun_mailboxId_startedAt_idx` ON `SyncRun` (`mailboxId`,`startedAt`);