CREATE TABLE `researchExports` (
	`id` varchar(48) NOT NULL,
	`sessionId` varchar(48) NOT NULL,
	`format` enum('markdown','html') NOT NULL,
	`storageKey` varchar(1024) NOT NULL,
	`storageUrl` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `researchExports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `researchFindings` (
	`id` varchar(48) NOT NULL,
	`sessionId` varchar(48) NOT NULL,
	`stepId` varchar(48),
	`ordinal` int NOT NULL,
	`title` varchar(500) NOT NULL,
	`claim` text NOT NULL,
	`evidence` text NOT NULL,
	`citationSourceIdsJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `researchFindings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `researchSessions` (
	`id` varchar(48) NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`query` text NOT NULL,
	`researchGoal` text,
	`intent` varchar(80),
	`outputFormat` enum('report','summary','comparison','timeline','qa') NOT NULL DEFAULT 'report',
	`status` enum('draft','awaiting_clarification','planning','researching','complete','failed') NOT NULL DEFAULT 'draft',
	`clarifyingQuestion` text,
	`planJson` text,
	`finalOutput` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `researchSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `researchSources` (
	`id` varchar(48) NOT NULL,
	`sessionId` varchar(48) NOT NULL,
	`stepId` varchar(48),
	`sourceType` enum('web','model') NOT NULL DEFAULT 'web',
	`title` varchar(500) NOT NULL,
	`url` text NOT NULL,
	`publisher` varchar(255),
	`excerpt` text,
	`retrievedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `researchSources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `researchSteps` (
	`id` varchar(48) NOT NULL,
	`sessionId` varchar(48) NOT NULL,
	`ordinal` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`searchQuery` text NOT NULL,
	`status` enum('pending','active','complete','skipped','failed') NOT NULL DEFAULT 'pending',
	`startedAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `researchSteps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `researchExports` ADD CONSTRAINT `researchExports_sessionId_researchSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `researchSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchFindings` ADD CONSTRAINT `researchFindings_sessionId_researchSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `researchSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchFindings` ADD CONSTRAINT `researchFindings_stepId_researchSteps_id_fk` FOREIGN KEY (`stepId`) REFERENCES `researchSteps`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchSessions` ADD CONSTRAINT `researchSessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchSources` ADD CONSTRAINT `researchSources_sessionId_researchSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `researchSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchSources` ADD CONSTRAINT `researchSources_stepId_researchSteps_id_fk` FOREIGN KEY (`stepId`) REFERENCES `researchSteps`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchSteps` ADD CONSTRAINT `researchSteps_sessionId_researchSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `researchSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `researchExports_session_idx` ON `researchExports` (`sessionId`);--> statement-breakpoint
CREATE INDEX `researchFindings_session_ordinal_idx` ON `researchFindings` (`sessionId`,`ordinal`);--> statement-breakpoint
CREATE INDEX `researchSessions_user_updated_idx` ON `researchSessions` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `researchSources_session_idx` ON `researchSources` (`sessionId`);--> statement-breakpoint
CREATE INDEX `researchSteps_session_ordinal_idx` ON `researchSteps` (`sessionId`,`ordinal`);