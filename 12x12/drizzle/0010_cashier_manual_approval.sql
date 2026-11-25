DROP TRIGGER IF EXISTS manual_transition_guard;
--> statement-breakpoint
CREATE TRIGGER manual_transition_guard BEFORE UPDATE ON manual_payments
BEGIN
 SELECT CASE WHEN NOT (
  (OLD.kind='deposit' AND OLD.status='pending' AND NEW.status IN ('approved','rejected')) OR
  (OLD.kind='withdrawal' AND (
    (OLD.status='pending' AND NEW.status IN ('processing','broadcasting','rejected','cancelled')) OR
    (OLD.status='processing' AND NEW.status IN ('broadcasting','rejected')) OR
    (OLD.status='broadcasting' AND NEW.status='sent') OR
    (OLD.status='sent' AND NEW.status='completed')
  ))
 ) THEN RAISE(ABORT,'manual invalid transition') END;
 SELECT CASE WHEN NEW.status IN ('approved','sent','completed') AND (NEW.tx IS NULL OR length(NEW.tx)=0)
  THEN RAISE(ABORT,'manual transfer required') END;
 SELECT CASE WHEN NEW.status='approved' AND NEW.transfer_index IS NULL AND
  (NEW.confirmations IS NOT NULL OR COALESCE(json_extract(NEW.evidence,'$.verification'),'')<>'manual')
  THEN RAISE(ABORT,'manual approval evidence required') END;
 SELECT CASE WHEN NEW.status IN ('sent','completed') AND NEW.transfer_index IS NULL
  THEN RAISE(ABORT,'manual transfer required') END;
 SELECT CASE WHEN (NEW.status='completed' OR (NEW.status='approved' AND NEW.transfer_index IS NOT NULL)) AND
  COALESCE(NEW.confirmations,-1)<MAX(1,(SELECT minimum_confirmations FROM manual_quotes WHERE id=NEW.id))
  THEN RAISE(ABORT,'manual confirmations required') END;
 SELECT CASE WHEN NEW.status='approved' AND COALESCE(NEW.credit,0)<>NEW.amount
  THEN RAISE(ABORT,'manual credit mismatch') END;
 SELECT CASE WHEN NEW.status='approved' AND NEW.network='base' AND EXISTS(SELECT 1 FROM receipts WHERE tx=NEW.tx)
  THEN RAISE(ABORT,'manual transfer already recorded by vault') END;
 -- A manual approval has no output index, so it reserves the entire network/hash pair.
 SELECT CASE WHEN NEW.status IN ('approved','sent','completed') AND EXISTS(
  SELECT 1 FROM manual_payments p
  WHERE p.id<>NEW.id AND p.network=NEW.network AND p.tx=NEW.tx
   AND p.status IN ('approved','sent','completed')
   AND (NEW.transfer_index IS NULL OR p.transfer_index IS NULL)
 ) THEN RAISE(ABORT,'manual hash already recorded') END;
END;
--> statement-breakpoint
DROP VIEW IF EXISTS confirmed_cashier_activity;
--> statement-breakpoint
CREATE VIEW confirmed_cashier_activity AS
 SELECT 'investment' AS kind, amount, created, id FROM receipts WHERE stage='active'
 UNION ALL
 SELECT 'payout', amount, created, id FROM withdrawals WHERE stage='paid'
 UNION ALL
 SELECT 'investment', amount*10000, updated, id FROM manual_payments WHERE status='approved' AND confirmations IS NOT NULL
 UNION ALL
 SELECT 'payout', amount*10000, updated, id FROM manual_payments WHERE status='completed';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS manual_approved_hash ON manual_payments(network,tx)
 WHERE status='approved' AND transfer_index IS NULL;
