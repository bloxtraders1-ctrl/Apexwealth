DROP TRIGGER manual_transition_guard;
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
 SELECT CASE WHEN NEW.status IN ('approved','sent','completed') AND (NEW.tx IS NULL OR NEW.transfer_index IS NULL)
  THEN RAISE(ABORT,'manual transfer required') END;
 SELECT CASE WHEN NEW.status IN ('approved','completed') AND
  COALESCE(NEW.confirmations,-1)<(SELECT minimum_confirmations FROM manual_quotes WHERE id=NEW.id)
  THEN RAISE(ABORT,'manual confirmations required') END;
 SELECT CASE WHEN NEW.status='approved' AND COALESCE(NEW.credit,0)<>NEW.amount
  THEN RAISE(ABORT,'manual credit mismatch') END;
 SELECT CASE WHEN NEW.status='approved' AND NEW.network='base' AND EXISTS(SELECT 1 FROM receipts WHERE tx=NEW.tx)
  THEN RAISE(ABORT,'manual transfer already recorded by vault') END;
END;
