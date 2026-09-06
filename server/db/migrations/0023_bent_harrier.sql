CREATE TABLE `PersonalProjectWakaName` (
	`id` varchar(191) NOT NULL DEFAULT (UUID()),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL,
	`projectId` varchar(191) NOT NULL,
	`wakaName` varchar(191) NOT NULL,
	CONSTRAINT `PersonalProjectWakaName_id` PRIMARY KEY(`id`),
	CONSTRAINT `PersonalProjectWakaName_wakaName_key` UNIQUE(`wakaName`)
);
--> statement-breakpoint
CREATE TABLE `PersonalSetting` (
	`key` varchar(191) NOT NULL,
	`value` varchar(191) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `PersonalSetting_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `PersonalArea` ADD `slug` varchar(191);--> statement-breakpoint
ALTER TABLE `PersonalProject` ADD `mode` varchar(191);--> statement-breakpoint
ALTER TABLE `PersonalProject` ADD `softFloorHours` int;--> statement-breakpoint
ALTER TABLE `PersonalProject` ADD `paletteSlot` tinyint;--> statement-breakpoint
ALTER TABLE `PersonalArea` ADD CONSTRAINT `PersonalArea_slug_key` UNIQUE(`slug`);--> statement-breakpoint
CREATE INDEX `PersonalProjectWakaName_projectId_idx` ON `PersonalProjectWakaName` (`projectId`);--> statement-breakpoint
INSERT INTO PersonalProjectWakaName (id, createdAt, updatedAt, projectId, wakaName) SELECT UUID(), NOW(3), NOW(3), id, wakaProject FROM PersonalProject WHERE wakaProject IS NOT NULL;--> statement-breakpoint
ALTER TABLE `PersonalProject` DROP COLUMN `wakaProject`;--> statement-breakpoint
INSERT INTO PersonalSetting (`key`, value, updatedAt) VALUES ('deferral_limit','3',NOW(3)),('someday_age_days','30',NOW(3));--> statement-breakpoint
UPDATE PersonalArea SET slug = LOWER(REPLACE(REPLACE(REPLACE(name,' & ','-'),' ','-'),'--','-')) WHERE slug IS NULL;