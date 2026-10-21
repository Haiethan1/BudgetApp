CREATE TABLE `debt_tracking_requests` (
	`id` text NOT NULL,
	`sheet_id` text NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_tracking_request_unique` ON `debt_tracking_requests` (`sheet_id`,`id`);--> statement-breakpoint
ALTER TABLE `buckets` ADD `repayment_recipient` text;