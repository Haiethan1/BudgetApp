CREATE TABLE `financial_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_accounts_sheet_id_unique` ON `financial_accounts` (`sheet_id`,`id`);