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
    (OLD.status='broadcasting' AND NEW.status='completed' AND json_extract(NEW.evidence,'$.verification') IS 'cashier') OR
    (OLD.status='sent' AND NEW.status='completed')
  ))
 ) THEN RAISE(ABORT,'manual invalid transition') END;
 SELECT CASE WHEN NEW.status IN ('approved','sent','completed') AND (NEW.tx IS NULL OR length(NEW.tx)=0)
  THEN RAISE(ABORT,'manual transfer required') END;
 SELECT CASE WHEN NEW.status='approved' AND NEW.transfer_index IS NULL AND
  (NEW.confirmations IS NOT NULL OR COALESCE(json_extract(NEW.evidence,'$.verification'),'') NOT IN ('manual','cashier'))
  THEN RAISE(ABORT,'manual approval evidence required') END;
 SELECT CASE WHEN NEW.status='completed' AND json_extract(NEW.evidence,'$.verification')='cashier'
  AND (json_extract(NEW.evidence,'$.decision') IS NOT 'sent' OR NEW.confirmations IS NOT NULL
   OR (OLD.status='sent' AND (NEW.tx IS NOT OLD.tx OR NEW.transfer_index IS NOT OLD.transfer_index))
   OR (OLD.status='broadcasting' AND NEW.transfer_index IS NOT NULL))
  THEN RAISE(ABORT,'manual transfer required') END;
 SELECT CASE WHEN NEW.transfer_index IS NULL AND (
   NEW.status='sent' OR (NEW.status='completed' AND json_extract(NEW.evidence,'$.verification') IS NOT 'cashier')
  )
  THEN RAISE(ABORT,'manual transfer required') END;
 SELECT CASE WHEN (NEW.status='completed' OR (NEW.status='approved' AND NEW.transfer_index IS NOT NULL)) AND
  COALESCE(json_extract(NEW.evidence,'$.verification'),'')<>'cashier' AND
  COALESCE(NEW.confirmations,-1)<MAX(1,(SELECT minimum_confirmations FROM manual_quotes WHERE id=NEW.id))
  THEN RAISE(ABORT,'manual confirmations required') END;
 SELECT CASE WHEN NEW.status='approved' AND COALESCE(NEW.credit,0)<>NEW.amount
  THEN RAISE(ABORT,'manual credit mismatch') END;
 SELECT CASE WHEN NEW.status='approved' AND NEW.network='base' AND EXISTS(SELECT 1 FROM receipts WHERE tx=NEW.tx)
  THEN RAISE(ABORT,'manual transfer already recorded by vault') END;
 -- A decision recorded without an output index consumes the entire network/hash pair.
 SELECT CASE WHEN NEW.status IN ('approved','sent','completed') AND EXISTS(
  SELECT 1 FROM manual_payments p
  WHERE p.id<>NEW.id AND p.network=NEW.network AND p.tx=NEW.tx
   AND p.status IN ('approved','sent','completed')
   AND (NEW.transfer_index IS NULL OR p.transfer_index IS NULL)
 ) THEN RAISE(ABORT,'manual hash already recorded') END;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS manual_deposit_evidence_guard;
--> statement-breakpoint
CREATE TRIGGER manual_deposit_evidence_guard BEFORE UPDATE ON manual_payments
WHEN OLD.kind='deposit' AND OLD.status='pending' AND NEW.status='approved'
BEGIN
 SELECT CASE WHEN NOT (
  (json_extract(NEW.evidence,'$.verification') IS 'cashier' AND
   json_extract(NEW.evidence,'$.decision') IS 'received' AND NEW.tx IS OLD.tx AND
   NEW.transfer_index IS NULL AND NEW.confirmations IS NULL)
  OR EXISTS(
   SELECT 1 FROM manual_quotes q LEFT JOIN manual_options o ON o.id=q.asset
   WHERE q.id=NEW.id AND NEW.transfer_index IS NOT NULL
    AND NEW.confirmations>=COALESCE(NULLIF(q.minimum_confirmations,0),o.confirmations,6)
    AND json_extract(NEW.evidence,'$.verification')='manual'
    AND json_extract(NEW.evidence,'$.success')=1
    AND json_extract(NEW.evidence,'$.ownershipVerified')=1
    AND json_extract(NEW.evidence,'$.network')=q.network
    AND json_extract(NEW.evidence,'$.address')=q.address
    AND json_extract(NEW.evidence,'$.crypto')=q.crypto
    AND json_extract(NEW.evidence,'$.confirmations')=NEW.confirmations
    AND json_extract(NEW.evidence,'$.paidAt') BETWEEN q.created AND q.expires
  )
 ) THEN RAISE(ABORT,'manual approval evidence required') END;
END;
