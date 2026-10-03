CREATE TABLE `buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`name` text NOT NULL,
	`is_protected` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buckets_sheet_id_unique` ON `buckets` (`sheet_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `buckets_protected_default_unique` ON `buckets` (`sheet_id`) WHERE "buckets"."is_protected" = 1;--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`name` text NOT NULL,
	`is_protected` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_sheet_id_unique` ON `categories` (`sheet_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_protected_default_unique` ON `categories` (`sheet_id`) WHERE "categories"."is_protected" = 1;--> statement-breakpoint
CREATE TABLE `sheet_members` (
	`sheet_id` text NOT NULL,
	`user_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	PRIMARY KEY(`sheet_id`, `user_id`),
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sheet_members_user_idx` ON `sheet_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `sheets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sheets_owner_idx` ON `sheets` (`owner_id`);--> statement-breakpoint
CREATE TRIGGER sheet_members_exclude_owner_insert BEFORE INSERT ON sheet_members
WHEN NEW.user_id = (SELECT owner_id FROM sheets WHERE id = NEW.sheet_id)
BEGIN SELECT RAISE(ABORT, 'Owners are not sheet members'); END;
--> statement-breakpoint
CREATE TRIGGER sheet_members_exclude_owner_update BEFORE UPDATE ON sheet_members
WHEN NEW.user_id = (SELECT owner_id FROM sheets WHERE id = NEW.sheet_id)
BEGIN SELECT RAISE(ABORT, 'Owners are not sheet members'); END;
