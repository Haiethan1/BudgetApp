ALTER TABLE `buckets` ADD `track_repayment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `buckets` ADD `tracking_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `repayment_date` text CONSTRAINT `transactions_repayment_kind` CHECK (`repayment_date` IS NULL OR (`kind` = 'expense' AND `repayment_date` >= `date`));--> statement-breakpoint
ALTER TABLE `transactions` ADD `repayment_comment` text DEFAULT '' NOT NULL;
