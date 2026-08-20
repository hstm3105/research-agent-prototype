CREATE TABLE `researchCitations` (
	`id` varchar(48) NOT NULL,
	`findingId` varchar(48) NOT NULL,
	`sourceId` varchar(48) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `researchCitations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `researchCitations` ADD CONSTRAINT `researchCitations_findingId_researchFindings_id_fk` FOREIGN KEY (`findingId`) REFERENCES `researchFindings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `researchCitations` ADD CONSTRAINT `researchCitations_sourceId_researchSources_id_fk` FOREIGN KEY (`sourceId`) REFERENCES `researchSources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `researchCitations_finding_idx` ON `researchCitations` (`findingId`);--> statement-breakpoint
CREATE INDEX `researchCitations_source_idx` ON `researchCitations` (`sourceId`);