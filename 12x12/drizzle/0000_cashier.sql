CREATE TABLE receipts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payout TEXT NOT NULL, amount INTEGER NOT NULL, referrer TEXT NOT NULL, receiver TEXT NOT NULL UNIQUE, factory TEXT NOT NULL, vault TEXT NOT NULL, created INTEGER NOT NULL, tx TEXT UNIQUE, stage TEXT NOT NULL DEFAULT 'created');
--> statement-breakpoint
CREATE INDEX receipt_user ON receipts(user_id,created);
--> statement-breakpoint
CREATE UNIQUE INDEX outstanding_receipt ON receipts(user_id) WHERE stage IN ('created','review');
--> statement-breakpoint
CREATE TABLE withdrawals (id TEXT PRIMARY KEY, receipt TEXT NOT NULL REFERENCES receipts(id), amount INTEGER NOT NULL, created INTEGER NOT NULL, stage TEXT NOT NULL DEFAULT 'review');
--> statement-breakpoint
CREATE UNIQUE INDEX one_pending_withdrawal ON withdrawals(receipt) WHERE stage='review';
