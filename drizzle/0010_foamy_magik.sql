CREATE TABLE `googleWorkspaceConnections` (
	`userId` int NOT NULL,
	`refreshTokenCiphertext` text NOT NULL,
	`accessTokenCiphertext` text,
	`accessTokenExpiresAt` timestamp,
	`scope` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `googleWorkspaceConnections_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `googleWorkspaceExports` (
	`id` varchar(48) NOT NULL,
	`sessionId` varchar(48) NOT NULL,
	`userId` int NOT NULL,
	`destination` enum('google_doc','google_sheet','google_slides') NOT NULL,
	`fileId` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `googleWorkspaceExports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `googleWorkspaceConnections` ADD CONSTRAINT `googleWorkspaceConnections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `googleWorkspaceExports` ADD CONSTRAINT `googleWorkspaceExports_sessionId_researchSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `researchSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `googleWorkspaceExports` ADD CONSTRAINT `googleWorkspaceExports_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `googleWorkspaceExports_session_idx` ON `googleWorkspaceExports` (`sessionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `googleWorkspaceExports_user_idx` ON `googleWorkspaceExports` (`userId`,`createdAt`);