ALTER TABLE `researchSessions` ADD `lifecyclePhase` varchar(64);--> statement-breakpoint
ALTER TABLE `researchSessions` ADD `lifecycleProgress` int;--> statement-breakpoint
ALTER TABLE `researchSessions` ADD `lifecycleMessage` text;