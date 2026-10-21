ALTER TABLE sheets ADD cycle_baseline_day integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE sheets SET cycle_baseline_day = cycle_start_day;
--> statement-breakpoint
CREATE TABLE cycle_changes (
 sheet_id text NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
 version integer NOT NULL,
 transition_from text NOT NULL,
 recurring_from text NOT NULL,
 start_day integer NOT NULL CONSTRAINT cycle_changes_day CHECK(start_day BETWEEN 1 AND 31),
 PRIMARY KEY(sheet_id, version)
);
--> statement-breakpoint
CREATE TABLE budgets_periods (
 sheet_id text NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
 category_id text NOT NULL,
 month text NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(month,1,4) != '0000' AND substr(month,6,2) BETWEEN '01' AND '12'),
 "limit" integer CHECK("limit" IS NULL OR (typeof("limit") = 'integer' AND "limit" >= 0 AND "limit" <= 9007199254740991)),
 version integer NOT NULL CHECK(typeof(version) = 'integer' AND version > 0),
 inherits_default integer NOT NULL DEFAULT false,
 PRIMARY KEY(sheet_id, category_id, month),
 FOREIGN KEY(sheet_id,category_id) REFERENCES categories(sheet_id,id)
);
--> statement-breakpoint
INSERT INTO budgets_periods SELECT b.sheet_id, b.category_id,
 b.month || '-' || printf('%02d', min(s.cycle_start_day,
 CASE substr(b.month,6,2)
 WHEN '02' THEN CASE WHEN CAST(substr(b.month,1,4) AS integer) % 4 = 0 AND (CAST(substr(b.month,1,4) AS integer) % 100 != 0 OR CAST(substr(b.month,1,4) AS integer) % 400 = 0) THEN 29 ELSE 28 END
 WHEN '04' THEN 30 WHEN '06' THEN 30 WHEN '09' THEN 30 WHEN '11' THEN 30 ELSE 31 END)),
 b."limit", b.version, b.inherits_default FROM budgets b JOIN sheets s ON s.id = b.sheet_id;
--> statement-breakpoint
DROP TABLE budgets;
--> statement-breakpoint
ALTER TABLE budgets_periods RENAME TO budgets;
