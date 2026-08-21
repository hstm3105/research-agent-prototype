CREATE TABLE `providerRateLimits` (
	`providerKey` varchar(96) NOT NULL,
	`nextAllowedAtMs` bigint NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `providerRateLimits_providerKey` PRIMARY KEY(`providerKey`)
);
