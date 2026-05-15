CREATE TABLE `account_health_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`status` text NOT NULL,
	`code` text,
	`message` text NOT NULL,
	`deterministic` integer DEFAULT false NOT NULL,
	`login_valid` integer,
	`bdstoken_valid` integer,
	`is_svip` integer,
	`quota_total_bytes` integer,
	`quota_used_bytes` integer,
	`quota_free_bytes` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_health_checks_account_created_idx` ON `account_health_checks` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_health_checks_created_idx` ON `account_health_checks` (`created_at`);--> statement-breakpoint
CREATE TABLE `account_status_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`old_status` text,
	`new_status` text NOT NULL,
	`old_reason` text,
	`new_reason` text,
	`source` text NOT NULL,
	`code` text,
	`message` text NOT NULL,
	`actor_user_id` integer,
	`parse_job_id` integer,
	`parse_record_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `account_status_events_account_created_idx` ON `account_status_events` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_token_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`parse_job_id` integer,
	`trigger` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`code` text,
	`message` text NOT NULL,
	`access_token_usable_before` integer,
	`access_token_usable_after` integer,
	`token_expires_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_token_events_account_created_idx` ON `account_token_events` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_token_events_created_idx` ON `account_token_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `baidu_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`cookie` text NOT NULL,
	`owner_user_id` integer,
	`credential_source` text DEFAULT 'cookie' NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`token_expires_at` integer,
	`open_platform_driver` text,
	`open_platform_client_key` text,
	`open_platform_secret_key` text,
	`open_platform_server_use` integer,
	`uk` text,
	`baidu_name` text,
	`vip_type` text DEFAULT 'unknown' NOT NULL,
	`weight` integer DEFAULT 100 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`disabled_source` text,
	`health_status` text,
	`health_message` text,
	`health_checked_at` integer,
	`login_valid` integer,
	`bdstoken_valid` integer,
	`is_svip` integer,
	`quota_total_bytes` integer,
	`quota_used_bytes` integer,
	`quota_free_bytes` integer,
	`health_consecutive_failures` integer DEFAULT 0 NOT NULL,
	`health_last_error_code` text,
	`token_status` text,
	`token_checked_at` integer,
	`token_message` text,
	`token_last_error_code` text,
	`token_last_refreshed_at` integer,
	`locked_until` integer,
	`cooldown_until` integer,
	`last_used_at` integer,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_failure_code` text,
	`created_by_user_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `baidu_accounts_status_idx` ON `baidu_accounts` (`status`);--> statement-breakpoint
CREATE INDEX `baidu_accounts_owner_idx` ON `baidu_accounts` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `baidu_accounts_uk_unique` ON `baidu_accounts` (`uk`) WHERE "baidu_accounts"."uk" IS NOT NULL AND "baidu_accounts"."uk" != '';--> statement-breakpoint
CREATE TABLE `baidu_temp_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parse_record_id` integer,
	`parse_job_id` integer,
	`account_id` integer,
	`temp_dir` text NOT NULL,
	`path` text NOT NULL,
	`fs_id` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`parse_record_id`) REFERENCES `parse_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parse_job_id`) REFERENCES `parse_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `baidu_temp_files_status_idx` ON `baidu_temp_files` (`status`);--> statement-breakpoint
CREATE INDEX `baidu_temp_files_account_idx` ON `baidu_temp_files` (`account_id`);--> statement-breakpoint
CREATE TABLE `broker_run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text,
	`task_id` text,
	`participation_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'info' NOT NULL,
	`code` text,
	`message` text NOT NULL,
	`details` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `broker_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broker_run_events_run_created_idx` ON `broker_run_events` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `broker_run_events_task_created_idx` ON `broker_run_events` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `broker_run_events_created_idx` ON `broker_run_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `broker_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`participation_id` text,
	`status` text NOT NULL,
	`failure_code` text,
	`message` text DEFAULT '' NOT NULL,
	`provider` text,
	`file_id` text,
	`file_name` text,
	`file_size_bytes` integer,
	`local_parse_record_id` integer,
	`next_poll_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`local_parse_record_id`) REFERENCES `parse_records`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `broker_runs_task_idx` ON `broker_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `broker_runs_participation_idx` ON `broker_runs` (`participation_id`);--> statement-breakpoint
CREATE INDEX `broker_runs_status_updated_idx` ON `broker_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `parse_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parse_record_id` integer,
	`parse_job_id` integer,
	`user_id` integer NOT NULL,
	`account_id` integer,
	`fs_id` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`message` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`parse_record_id`) REFERENCES `parse_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `parse_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parse_record_id` integer,
	`parse_job_id` integer,
	`account_id` integer,
	`temp_file_id` integer,
	`type` text NOT NULL,
	`status` text DEFAULT 'info' NOT NULL,
	`code` text,
	`message` text NOT NULL,
	`details` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`parse_record_id`) REFERENCES `parse_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parse_job_id`) REFERENCES `parse_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`temp_file_id`) REFERENCES `baidu_temp_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `parse_events_record_idx` ON `parse_events` (`parse_record_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `parse_events_job_idx` ON `parse_events` (`parse_job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `parse_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`parse_record_id` integer,
	`account_id` integer,
	`share_url` text NOT NULL,
	`share_surl` text NOT NULL,
	`pwd` text,
	`dir` text DEFAULT '/' NOT NULL,
	`fs_id` text NOT NULL,
	`filename` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`md5` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`queue_seq` integer NOT NULL,
	`route` text,
	`credential_source` text DEFAULT 'cookie' NOT NULL,
	`parse_route` text,
	`account_owner_user_id` integer,
	`result_url` text,
	`result_ua` text,
	`link_expires_at` integer,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parse_record_id`) REFERENCES `parse_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `parse_jobs_status_seq_idx` ON `parse_jobs` (`status`,`queue_seq`);--> statement-breakpoint
CREATE INDEX `parse_jobs_user_created_idx` ON `parse_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `parse_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`account_id` integer,
	`account_owner_user_id` integer,
	`share_surl` text NOT NULL,
	`share_url` text,
	`pwd` text,
	`dir` text,
	`fs_id` text NOT NULL,
	`filename` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`md5` text,
	`status` text NOT NULL,
	`route` text,
	`credential_source` text DEFAULT 'cookie' NOT NULL,
	`parse_route` text,
	`result_url` text,
	`result_ua` text,
	`link_expires_at` integer,
	`error_message` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `baidu_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `parse_records_user_created_idx` ON `parse_records` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `parse_records_status_idx` ON `parse_records` (`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
