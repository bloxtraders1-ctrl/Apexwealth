CREATE TABLE manual_options (
 id TEXT PRIMARY KEY, address TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 min_deposit INTEGER NOT NULL, max_deposit INTEGER NOT NULL,
 min_withdraw INTEGER NOT NULL, max_withdraw INTEGER NOT NULL,
 withdrawal_fee INTEGER NOT NULL, confirmations INTEGER NOT NULL, actor TEXT NOT NULL, updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE manual_policy (id INTEGER PRIMARY KEY CHECK(id=1), daily_bps INTEGER NOT NULL CHECK(daily_bps BETWEEN 0 AND 10000), actor TEXT NOT NULL, updated INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO manual_policy VALUES(1,1200,'system',0);
--> statement-breakpoint
CREATE TABLE manual_quotes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('deposit','withdrawal')),
 asset TEXT NOT NULL, network TEXT NOT NULL, address TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0),
 fee INTEGER NOT NULL CHECK(fee>=0), crypto TEXT NOT NULL, rate TEXT NOT NULL, rate_source TEXT NOT NULL,
 minimum_confirmations INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE manual_payments (
 id TEXT PRIMARY KEY REFERENCES manual_quotes(id), user_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('deposit','withdrawal')), 
 status TEXT NOT NULL CHECK(status IN ('pending','processing','broadcasting','sent','completed','approved','rejected','cancelled')),
 network TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), fee INTEGER NOT NULL CHECK(fee>=0),
 created INTEGER NOT NULL, updated INTEGER NOT NULL, actor TEXT NOT NULL,
 tx TEXT, transfer_index INTEGER, confirmations INTEGER, credit INTEGER,
 evidence TEXT, note TEXT
);
--> statement-breakpoint
CREATE INDEX manual_payments_user ON manual_payments(user_id,kind,created);
--> statement-breakpoint
CREATE INDEX manual_payments_queue ON manual_payments(kind,status,created);
--> statement-breakpoint
CREATE UNIQUE INDEX manual_unique_transfer ON manual_payments(network,tx,transfer_index)
 WHERE status IN ('approved','sent','completed');
--> statement-breakpoint
CREATE TABLE manual_ledger (
 request_id TEXT NOT NULL REFERENCES manual_payments(id), user_id TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('credit','reserve','payout','refund')),
 delta INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(request_id,event)
);
--> statement-breakpoint
CREATE INDEX manual_ledger_user ON manual_ledger(user_id);
--> statement-breakpoint
CREATE TABLE manual_audit (
 seq INTEGER PRIMARY KEY, request_id TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL,
 created INTEGER NOT NULL, detail TEXT
);
--> statement-breakpoint
CREATE INDEX manual_audit_request ON manual_audit(request_id,seq);
--> statement-breakpoint
CREATE TABLE manual_limits (
 bucket TEXT PRIMARY KEY, period INTEGER NOT NULL, attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER manual_submission_guard BEFORE INSERT ON manual_payments
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM manual_quotes q WHERE q.id=NEW.id AND q.user_id=NEW.user_id
   AND q.kind=NEW.kind AND q.network=NEW.network AND q.amount=NEW.amount AND q.fee=NEW.fee
 ) OR NEW.status<>'pending' THEN RAISE(ABORT,'manual quote mismatch') END;
 SELECT CASE WHEN NEW.kind='withdrawal' AND NOT EXISTS(
  SELECT 1 FROM manual_quotes q JOIN manual_options a ON a.id=q.asset
  WHERE q.id=NEW.id AND a.enabled=1 AND length(a.address)>0
 ) THEN RAISE(ABORT,'manual option unavailable') END;
 SELECT CASE WHEN NEW.kind='withdrawal' AND NEW.created>=(SELECT expires FROM manual_quotes WHERE id=NEW.id)
  THEN RAISE(ABORT,'manual quote expired') END;
 SELECT CASE WHEN NEW.kind='withdrawal' AND
  NEW.amount+NEW.fee>COALESCE((SELECT SUM(delta) FROM manual_ledger WHERE user_id=NEW.user_id),0)
  THEN RAISE(ABORT,'manual insufficient balance') END;
 SELECT CASE WHEN NEW.kind='withdrawal' AND
  NEW.amount+NEW.fee+COALESCE((SELECT SUM(amount+fee) FROM manual_payments
   WHERE user_id=NEW.user_id AND kind='withdrawal' AND status NOT IN ('rejected','cancelled')
    AND created>=NEW.created/86400*86400),0)>
  COALESCE((SELECT SUM(amount) FROM receipts WHERE user_id=NEW.user_id AND stage='active'),0)
    *(SELECT daily_bps FROM manual_policy WHERE id=1)/100000000
  THEN RAISE(ABORT,'manual daily limit') END;
END;
--> statement-breakpoint
CREATE TRIGGER manual_record_submission AFTER INSERT ON manual_payments
BEGIN
 INSERT INTO manual_ledger SELECT NEW.id,NEW.user_id,'reserve',-(NEW.amount+NEW.fee),NEW.created WHERE NEW.kind='withdrawal';
 INSERT INTO manual_audit(request_id,actor,event,created,detail)
 VALUES(NEW.id,NEW.actor,'submitted',NEW.created,json_object('kind',NEW.kind,'tx',NEW.tx));
END;
--> statement-breakpoint
CREATE TRIGGER manual_transition_guard BEFORE UPDATE ON manual_payments
BEGIN
 SELECT CASE WHEN NOT (
  (OLD.kind='deposit' AND OLD.status='pending' AND NEW.status IN ('approved','rejected')) OR
  (OLD.kind='withdrawal' AND (
    (OLD.status='pending' AND NEW.status IN ('processing','rejected','cancelled')) OR
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
--> statement-breakpoint
CREATE TRIGGER manual_record_review AFTER UPDATE ON manual_payments
BEGIN
 INSERT INTO manual_ledger SELECT NEW.id,NEW.user_id,'credit',NEW.credit,NEW.updated WHERE NEW.status='approved';
 INSERT INTO manual_ledger SELECT NEW.id,NEW.user_id,'refund',NEW.amount+NEW.fee,NEW.updated WHERE NEW.status IN ('rejected','cancelled') AND NEW.kind='withdrawal';
 INSERT INTO manual_ledger SELECT NEW.id,NEW.user_id,'payout',0,NEW.updated WHERE NEW.status='completed';
 INSERT INTO manual_audit(request_id,actor,event,created,detail)
 VALUES(NEW.id,NEW.actor,NEW.status,NEW.updated,json_object('tx',NEW.tx,'index',NEW.transfer_index,'confirmations',NEW.confirmations,'note',NEW.note,'evidence',json(NEW.evidence)));
END;
--> statement-breakpoint
CREATE TRIGGER manual_legacy_transfer_guard BEFORE UPDATE OF tx ON receipts
 WHEN NEW.tx IS NOT NULL AND EXISTS(SELECT 1 FROM manual_payments WHERE network='base' AND tx=NEW.tx AND status='approved')
BEGIN
 SELECT RAISE(ABORT,'manual transfer already credited');
END;
--> statement-breakpoint
CREATE TRIGGER manual_ledger_no_update BEFORE UPDATE ON manual_ledger BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER manual_ledger_no_delete BEFORE DELETE ON manual_ledger BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER manual_audit_no_update BEFORE UPDATE ON manual_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
--> statement-breakpoint
CREATE TRIGGER manual_audit_no_delete BEFORE DELETE ON manual_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
--> statement-breakpoint
CREATE TRIGGER manual_options_insert_audit AFTER INSERT ON manual_options BEGIN
 INSERT INTO manual_audit(request_id,actor,event,created,detail) VALUES('option:'||NEW.id,NEW.actor,'settings',NEW.updated,
 json_object('asset',NEW.id,'address',NEW.address,'enabled',NEW.enabled,'min_deposit',NEW.min_deposit,'max_deposit',NEW.max_deposit,'min_withdraw',NEW.min_withdraw,'max_withdraw',NEW.max_withdraw,'fee',NEW.withdrawal_fee,'confirmations',NEW.confirmations));
END;
--> statement-breakpoint
CREATE TRIGGER manual_options_update_audit AFTER UPDATE ON manual_options BEGIN
 INSERT INTO manual_audit(request_id,actor,event,created,detail) VALUES('option:'||NEW.id,NEW.actor,'settings',NEW.updated,
 json_object('asset',NEW.id,'address',NEW.address,'enabled',NEW.enabled,'min_deposit',NEW.min_deposit,'max_deposit',NEW.max_deposit,'min_withdraw',NEW.min_withdraw,'max_withdraw',NEW.max_withdraw,'fee',NEW.withdrawal_fee,'confirmations',NEW.confirmations));
END;
--> statement-breakpoint
CREATE TRIGGER manual_policy_audit AFTER UPDATE ON manual_policy BEGIN
 INSERT INTO manual_audit(request_id,actor,event,created,detail)
 VALUES('policy',NEW.actor,'settings',NEW.updated,json_object('daily_bps',NEW.daily_bps));
END;
