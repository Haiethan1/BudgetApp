CREATE TEMP TABLE me_default_targets AS
SELECT s.id AS sheet_id, COALESCE(
  (SELECT b.id FROM buckets b WHERE b.sheet_id=s.id AND lower(trim(b.name))='me' ORDER BY b.is_archived,b.id LIMIT 1),
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
) AS bucket_id
FROM sheets s WHERE EXISTS (SELECT 1 FROM buckets b WHERE b.sheet_id=s.id AND b.is_protected=1 AND b.name='Unassigned');
--> statement-breakpoint
UPDATE buckets SET is_protected=0,is_archived=1
WHERE sheet_id IN (SELECT sheet_id FROM me_default_targets) AND is_protected=1;
--> statement-breakpoint
INSERT INTO buckets (id,sheet_id,name,is_protected)
SELECT bucket_id,sheet_id,'Me',1 FROM me_default_targets t WHERE NOT EXISTS (SELECT 1 FROM buckets b WHERE b.id=t.bucket_id);
--> statement-breakpoint
UPDATE buckets SET is_protected=1,is_archived=0,track_repayment=0,tracking_version=tracking_version+1
WHERE id IN (SELECT bucket_id FROM me_default_targets);
--> statement-breakpoint
DROP TABLE me_default_targets;
