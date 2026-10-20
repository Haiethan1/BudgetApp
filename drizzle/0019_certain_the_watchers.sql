CREATE TABLE `ledger_requests` (
	`id` text NOT NULL,
	`sheet_id` text NOT NULL,
	`hash` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_requests_sheet_id_unique` ON `ledger_requests` (`sheet_id`,`id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `notes` text DEFAULT '' NOT NULL;