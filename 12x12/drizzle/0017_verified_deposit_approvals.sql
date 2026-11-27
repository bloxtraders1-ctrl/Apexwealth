CREATE TRIGGER manual_verified_deposit_only BEFORE UPDATE ON manual_payments
WHEN OLD.kind='deposit' AND OLD.status='pending' AND NEW.status='approved'
 AND json_extract(NEW.evidence,'$.verification') IS NOT 'manual'
BEGIN
 SELECT RAISE(ABORT,'manual approval evidence required');
END;
