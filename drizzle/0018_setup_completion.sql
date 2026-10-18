ALTER TABLE `sheets` ADD `setup_completed` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE sheets SET setup_completed=1 WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.sheet_id=sheets.id);
