CREATE TABLE `debt_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`debt_id` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`,`debt_id`) REFERENCES `debts`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `debt_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`debt_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`replaces` text,
	`replacement_amount` integer,
	`date` text NOT NULL,
	`comment` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`,`debt_id`) REFERENCES `debts`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "debt_payment_amount" CHECK(typeof("debt_payments"."amount") = 'integer' AND abs("debt_payments"."amount") <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `debt_requests` (
	`id` text NOT NULL,
	`sheet_id` text NOT NULL,
	`hash` text NOT NULL,
	`debt_id` text NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_request_unique` ON `debt_requests` (`sheet_id`,`id`);--> statement-breakpoint
CREATE TABLE `debt_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`debt_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`position` integer NOT NULL,
	`original_version` integer NOT NULL,
	`accepted_version` integer NOT NULL,
	`amount` integer NOT NULL,
	`original_amount` integer NOT NULL,
	`payee` text NOT NULL,
	`date` text NOT NULL,
	`bucket_id` text NOT NULL,
	`bucket_name` text NOT NULL,
	FOREIGN KEY (`sheet_id`,`debt_id`) REFERENCES `debts`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_source_exclusive` ON `debt_sources` (`sheet_id`,`transaction_id`,`position`);--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`description` text NOT NULL,
	`debtor` text NOT NULL,
	`recipient` text,
	`total` integer NOT NULL,
	`legacy` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`grouped_into` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "debts_total" CHECK(typeof("debts"."total") = 'integer' AND abs("debts"."total") <= 9007199254740991 AND "debts"."total" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debts_sheet_id_unique` ON `debts` (`sheet_id`,`id`);--> statement-breakpoint
CREATE INDEX `debts_sheet_updated` ON `debts` (`sheet_id`,`updated_at`);--> statement-breakpoint
INSERT INTO debts (id,sheet_id,description,debtor,recipient,total,legacy,version,created_at,updated_at)
SELECT s.id,t.sheet_id,t.payee,b.name,NULL,-s.amount,1,1,t.created_at,t.updated_at
FROM splits s JOIN transactions t ON t.id=s.transaction_id JOIN buckets b ON b.id=s.bucket_id
WHERE b.track_repayment=1 AND t.kind='expense' AND t.deleted_at IS NULL;
--> statement-breakpoint
INSERT INTO debt_sources (id,sheet_id,debt_id,transaction_id,position,original_version,accepted_version,amount,original_amount,payee,date,bucket_id,bucket_name)
SELECT s.id,t.sheet_id,s.id,t.id,s.position,t.version,t.version,-s.amount,-s.amount,t.payee,t.date,b.id,b.name
FROM splits s JOIN transactions t ON t.id=s.transaction_id JOIN buckets b ON b.id=s.bucket_id JOIN debts d ON d.id=s.id;
--> statement-breakpoint
INSERT INTO debt_payments (id,sheet_id,debt_id,kind,amount,date,comment,reason,created_at)
SELECT s.id,t.sheet_id,s.id,'opening',-s.amount,t.repayment_date,t.repayment_comment,'Migrated whole-expense settlement',t.updated_at
FROM splits s JOIN transactions t ON t.id=s.transaction_id JOIN debts d ON d.id=s.id WHERE t.repayment_date IS NOT NULL;
--> statement-breakpoint
INSERT INTO debt_changes (id,sheet_id,debt_id,description,created_at)
SELECT s.id,t.sheet_id,s.id,'Migrated tracked allocation. Recipient needs clarification. Legacy comment: ' || t.repayment_comment,t.updated_at
FROM splits s JOIN transactions t ON t.id=s.transaction_id JOIN debts d ON d.id=s.id;

--> statement-breakpoint
CREATE TABLE `debt_legacy_metadata` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`date` text,
	`comment` text NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
INSERT INTO debt_legacy_metadata (transaction_id,sheet_id,date,comment) SELECT id,sheet_id,repayment_date,repayment_comment FROM transactions WHERE repayment_date IS NOT NULL OR repayment_comment != '';

