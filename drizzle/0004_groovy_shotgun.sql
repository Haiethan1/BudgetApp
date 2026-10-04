CREATE TABLE `splits` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text NOT NULL,
	`bucket_id` text NOT NULL,
	`amount` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`sheet_id`,`transaction_id`) REFERENCES `transactions`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`category_id`) REFERENCES `categories`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sheet_id`,`bucket_id`) REFERENCES `buckets`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "splits_amount" CHECK(typeof("splits"."amount") = 'integer' AND "splits"."amount" != 0 AND abs("splits"."amount") <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `splits_transaction_position` ON `splits` (`transaction_id`,`position`);--> statement-breakpoint
CREATE TABLE `transaction_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source_profile` text NOT NULL,
	`source_id` text,
	`date` text NOT NULL,
	`payee` text NOT NULL,
	`amount` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`,`transaction_id`) REFERENCES `transactions`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`account_id`) REFERENCES `financial_accounts`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_sources_identity_idx` ON `transaction_sources` (`sheet_id`,`account_id`,`source_profile`,`source_id`);--> statement-breakpoint
CREATE INDEX `transaction_sources_fingerprint_idx` ON `transaction_sources` (`sheet_id`,`account_id`,`source_profile`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`payee` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`creator_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sheet_id`,`account_id`) REFERENCES `financial_accounts`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_amount" CHECK(typeof("transactions"."amount") = 'integer' AND "transactions"."amount" != 0 AND abs("transactions"."amount") <= 9007199254740991),
	CONSTRAINT "transactions_kind_sign" CHECK(("transactions"."kind" = 'expense' AND "transactions"."amount" < 0) OR ("transactions"."kind" IN ('refund', 'income') AND "transactions"."amount" > 0) OR "transactions"."kind" = 'transfer'),
	CONSTRAINT "transactions_version" CHECK("transactions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_sheet_id_unique` ON `transactions` (`sheet_id`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_sheet_date_idx` ON `transactions` (`sheet_id`,`date`,`id`);--> statement-breakpoint
CREATE TRIGGER transaction_sources_immutable BEFORE UPDATE ON transaction_sources BEGIN SELECT RAISE(ABORT, 'Transaction source identity is immutable'); END;
