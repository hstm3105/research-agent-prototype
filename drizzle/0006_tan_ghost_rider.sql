CREATE TABLE `researchShareLinks` (
	`id` varchar(48) NOT NULL,
	`sessionId` varchar(48) NOT NULL,
	`ownerId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	CONSTRAINT `researchShareLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `researchShareLinks_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `researchSessions` ADD `broadenedFromSessionId` varchar(48);--> statement-breakpoint
ALTER TABLE `researchSources` ADD `qualityScore` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `researchSources` ADD `qualitySignalsJson` text;--> statement-breakpoint
ALTER TABLE `researchSources` ADD `citationCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `researchShareLinks` ADD CONSTRAINT `researchShareLinks_sessionId_researchSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `researchSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchShareLinks` ADD CONSTRAINT `researchShareLinks_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `researchShareLinks_owner_session_idx` ON `researchShareLinks` (`ownerId`,`sessionId`);--> statement-breakpoint
CREATE INDEX `researchShareLinks_session_revoked_idx` ON `researchShareLinks` (`sessionId`,`revokedAt`);--> statement-breakpoint
CREATE INDEX `researchSessions_broadened_from_idx` ON `researchSessions` (`broadenedFromSessionId`);--> statement-breakpoint
CREATE INDEX `researchSources_session_quality_idx` ON `researchSources` (`sessionId`,`qualityScore`);