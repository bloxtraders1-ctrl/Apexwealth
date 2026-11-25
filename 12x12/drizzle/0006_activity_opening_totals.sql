CREATE VIEW confirmed_cashier_activity AS
 SELECT 'investment' AS kind, amount, created, id FROM receipts WHERE stage='active'
 UNION ALL
 SELECT 'payout', amount, created, id FROM withdrawals WHERE stage='paid'
 UNION ALL
 SELECT 'investment', amount*10000, updated, id FROM manual_payments WHERE status='approved'
 UNION ALL
 SELECT 'payout', amount*10000, updated, id FROM manual_payments WHERE status='completed';
--> statement-breakpoint
CREATE TABLE activity_opening_totals (
 id INTEGER PRIMARY KEY CHECK(id=1),
 deposited INTEGER NOT NULL CHECK(deposited>=0),
 paid_out INTEGER NOT NULL CHECK(paid_out>=0),
 recorded_deposited INTEGER NOT NULL CHECK(recorded_deposited>=0),
 recorded_paid_out INTEGER NOT NULL CHECK(recorded_paid_out>=0),
 imported_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO activity_opening_totals (id,deposited,paid_out,recorded_deposited,recorded_paid_out,imported_at)
 SELECT 1,356651250000,324849650000,
 COALESCE(SUM(CASE WHEN kind='investment' THEN amount ELSE 0 END),0),
 COALESCE(SUM(CASE WHEN kind='payout' THEN amount ELSE 0 END),0),
 unixepoch()
 FROM confirmed_cashier_activity;
