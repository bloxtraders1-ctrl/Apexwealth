CREATE TRIGGER manual_deposit_evidence_guard BEFORE UPDATE ON manual_payments
WHEN OLD.kind='deposit' AND OLD.status='pending' AND NEW.status='approved'
BEGIN
 SELECT CASE WHEN NOT EXISTS(
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
 ) THEN RAISE(ABORT,'manual approval evidence required') END;
END;
