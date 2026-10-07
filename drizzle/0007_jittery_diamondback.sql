CREATE TABLE `sharing_rate_limits` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sheet_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`inviter_id` text NOT NULL,
	`invitee_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invitee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sheet_invites_state_check" CHECK("sheet_invites"."state" IN ('pending', 'accepted', 'declined', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sheet_invites_pending_unique` ON `sheet_invites` (`sheet_id`,`invitee_id`) WHERE "sheet_invites"."state" = 'pending';--> statement-breakpoint
CREATE INDEX `sheet_invites_recipient_idx` ON `sheet_invites` (`invitee_id`);