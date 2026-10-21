CREATE TABLE `payment_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`name` text NOT NULL,
	`category_id` text NOT NULL,
	`expected` integer NOT NULL,
	`due_date` text NOT NULL,
	`recurrence` integer NOT NULL,
	`anchor_day` integer NOT NULL,
	`created_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`matched_transaction_id` text,
	`active_transaction_id` text,
	`source_version` integer,
	`matched_amount` integer,
	`matched_date` text,
	`matched_payee` text,
	`next_plan_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`category_id`) REFERENCES `categories`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_plans_expected" CHECK(typeof("payment_plans"."expected") = 'integer' AND "payment_plans"."expected" > 0 AND "payment_plans"."expected" <= 9007199254740991),
	CONSTRAINT "payment_plans_recurrence" CHECK("payment_plans"."recurrence" IN (0, 1, 6, 12)),
	CONSTRAINT "payment_plans_anchor" CHECK("payment_plans"."anchor_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_plans_sheet_id` ON `payment_plans` (`sheet_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_plans_active_source` ON `payment_plans` (`sheet_id`,`active_transaction_id`);--> statement-breakpoint
CREATE TABLE `plan_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`category_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`sheet_id`,`plan_id`) REFERENCES `payment_plans`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_adjustments_amount" CHECK(typeof("plan_adjustments"."amount") = 'integer' AND abs("plan_adjustments"."amount") <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `plan_contributions` (
	`sheet_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`category_id` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`sheet_id`,`plan_id`) REFERENCES `payment_plans`(`sheet_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_contributions_amount" CHECK(typeof("plan_contributions"."amount") = 'integer' AND "plan_contributions"."amount" >= 0 AND "plan_contributions"."amount" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_contributions_period` ON `plan_contributions` (`plan_id`,`period_from`);--> statement-breakpoint
CREATE TABLE `plan_requests` (
	`sheet_id` text NOT NULL,
	`id` text NOT NULL,
	`hash` text NOT NULL,
	`result_id` text NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_requests_identity` ON `plan_requests` (`sheet_id`,`id`);