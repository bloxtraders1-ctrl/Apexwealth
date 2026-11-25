ALTER TABLE receipts ADD COLUMN plan_id INTEGER NOT NULL DEFAULT 1 CHECK(plan_id BETWEEN 1 AND 3);
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE INDEX receipt_referral ON receipts(referrer COLLATE NOCASE,stage,user_id);
