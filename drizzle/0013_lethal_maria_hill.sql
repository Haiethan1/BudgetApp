CREATE TABLE `budget_default_changes` (
	`sheet_id` text NOT NULL,
	`category_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`limit` integer,
	`version` integer NOT NULL,
	PRIMARY KEY(`sheet_id`, `category_id`, `version`),
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`category_id`) REFERENCES `categories`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_default_changes_limit" CHECK("budget_default_changes"."limit" IS NULL OR (typeof("budget_default_changes"."limit") = 'integer' AND "budget_default_changes"."limit" >= 0 AND "budget_default_changes"."limit" <= 9007199254740991)),
	CONSTRAINT "budget_default_changes_version" CHECK(typeof("budget_default_changes"."version") = 'integer' AND "budget_default_changes"."version" > 0),
	CONSTRAINT "budget_default_changes_date" CHECK("budget_default_changes"."effective_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr("budget_default_changes"."effective_from", 1, 4) != '0000' AND substr("budget_default_changes"."effective_from", 6, 2) BETWEEN '01' AND '12')
);
--> statement-breakpoint
INSERT INTO budget_default_changes (sheet_id, category_id, effective_from, "limit", version)
SELECT sheet_id, category_id, '0001-01-01', "limit", version FROM budget_defaults;
