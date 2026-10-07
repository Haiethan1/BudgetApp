CREATE TABLE `budgets` (
	`sheet_id` text NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`limit` integer,
	`version` integer NOT NULL,
	PRIMARY KEY(`sheet_id`, `category_id`, `month`),
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`,`category_id`) REFERENCES `categories`(`sheet_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budgets_limit" CHECK("budgets"."limit" IS NULL OR (typeof("budgets"."limit") = 'integer' AND "budgets"."limit" >= 0 AND "budgets"."limit" <= 9007199254740991)),
	CONSTRAINT "budgets_version" CHECK(typeof("budgets"."version") = 'integer' AND "budgets"."version" > 0),
	CONSTRAINT "budgets_month" CHECK("budgets"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr("budgets"."month", 1, 4) != '0000' AND substr("budgets"."month", 6, 2) BETWEEN '01' AND '12')
);
