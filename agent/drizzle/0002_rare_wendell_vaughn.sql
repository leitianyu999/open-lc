CREATE TABLE `temp_file_cleanup_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	`total_candidates` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`attempted` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`orphan` integer DEFAULT 0 NOT NULL,
	`waiting_for_expiry` integer DEFAULT 0 NOT NULL,
	`first_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `temp_file_cleanup_runs_started_idx` ON `temp_file_cleanup_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `temp_file_cleanup_runs_status_idx` ON `temp_file_cleanup_runs` (`status`);