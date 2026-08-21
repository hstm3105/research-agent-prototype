CREATE TABLE `researchRecommendationOptions` (
	`id` varchar(48) NOT NULL,
	`sessionId` varchar(48) NOT NULL,
	`rank` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`summary` text NOT NULL,
	`strengthsJson` text NOT NULL,
	`caveatsJson` text NOT NULL,
	`evidenceJson` text NOT NULL,
	`citationSourceIdsJson` text NOT NULL,
	`criteriaJson` text NOT NULL,
	`selectionAdvice` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `researchRecommendationOptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `researchRecommendationOptions` ADD CONSTRAINT `researchRecommendationOptions_sessionId_researchSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `researchSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `researchRecommendationOptions_session_rank_idx` ON `researchRecommendationOptions` (`sessionId`,`rank`);