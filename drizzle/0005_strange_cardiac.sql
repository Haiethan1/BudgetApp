CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`account_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`mapping` text NOT NULL,
	`file_hash` text NOT NULL,
	`mapping_hash` text NOT NULL,
	`state` text DEFAULT 'review' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`snapshot` text NOT NULL,
	`result` text,
	`creator_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`committed_at` integer,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sheet_id`,`account_id`,`profile_id`) REFERENCES `import_profiles`(`sheet_id`,`account_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_sheet_id` ON `import_batches` (`sheet_id`,`id`);--> statement-breakpoint
CREATE INDEX `import_batches_repeat` ON `import_batches` (`sheet_id`,`account_id`,`profile_id`,`file_hash`,`mapping_hash`,`state`);--> statement-breakpoint
CREATE TABLE `import_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`mapping` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`account_id`) REFERENCES `financial_accounts`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_profiles_scope_id` ON `import_profiles` (`sheet_id`,`account_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_profiles_name` ON `import_profiles` (`account_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`source_row` integer NOT NULL,
	`original` text NOT NULL,
	`source` text,
	`proposed` text,
	`errors` text NOT NULL,
	`matching` text NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`kind_reviewed` integer DEFAULT false NOT NULL,
	`transaction_id` text,
	FOREIGN KEY (`sheet_id`,`batch_id`) REFERENCES `import_batches`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`transaction_id`) REFERENCES `transactions`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_rows_position` ON `import_rows` (`batch_id`,`source_row`);
--> statement-breakpoint
CREATE TRIGGER import_rows_original_immutable BEFORE UPDATE OF original,source_row,batch_id,sheet_id ON import_rows BEGIN SELECT RAISE(ABORT, 'Import original identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_rows_source_immutable BEFORE UPDATE OF source ON import_rows WHEN OLD.source IS NOT NULL AND NEW.source IS NOT OLD.source BEGIN SELECT RAISE(ABORT, 'Import normalized identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_rows_committed_immutable BEFORE UPDATE ON import_rows WHEN EXISTS (SELECT 1 FROM import_batches WHERE id=OLD.batch_id AND state='committed') BEGIN SELECT RAISE(ABORT, 'Committed import is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_batches_identity_immutable BEFORE UPDATE OF sheet_id,account_id,profile_id,mapping,file_hash,mapping_hash,creator_id ON import_batches BEGIN SELECT RAISE(ABORT, 'Import batch identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_batches_committed_immutable BEFORE UPDATE ON import_batches WHEN OLD.state='committed' BEGIN SELECT RAISE(ABORT, 'Committed import is immutable'); END;
