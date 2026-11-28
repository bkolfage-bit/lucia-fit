-- Admin dashboard: blocked days/times table.
-- Apply to the Railway MySQL database BEFORE the admin-dashboard code deploys:
--   mysql "$DATABASE_URL" < db/blocked_slots.sql
-- Run once (CREATE INDEX has no IF NOT EXISTS in MySQL).

CREATE TABLE IF NOT EXISTS `blocked_slots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`block_date` varchar(10) NOT NULL,
	`start_time` varchar(5),
	`reason` varchar(200),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `blocked_slots_id` PRIMARY KEY(`id`)
);

CREATE INDEX `blocked_slots_date_idx` ON `blocked_slots` (`block_date`);
