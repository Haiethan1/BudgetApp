CREATE TABLE `budget_defaults` (
	`sheet_id` text NOT NULL,
	`category_id` text NOT NULL,
	`limit` integer,
	`version` integer NOT NULL,
	PRIMARY KEY(`sheet_id`, `category_id`),
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`category_id`) REFERENCES `categories`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_defaults_limit" CHECK("budget_defaults"."limit" IS NULL OR (typeof("budget_defaults"."limit") = 'integer' AND "budget_defaults"."limit" >= 0 AND "budget_defaults"."limit" <= 9007199254740991)),
	CONSTRAINT "budget_defaults_version" CHECK(typeof("budget_defaults"."version") = 'integer' AND "budget_defaults"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE `budgets` ADD `inherits_default` integer DEFAULT false NOT NULL;