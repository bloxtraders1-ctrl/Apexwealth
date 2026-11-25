CREATE TABLE IF NOT EXISTS wallet_profiles (
 user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 48)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS wallet_reward_funds (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS wallet_plans (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id INTEGER NOT NULL, amount INTEGER NOT NULL,
 rate INTEGER NOT NULL, days INTEGER NOT NULL, daily INTEGER NOT NULL, separate INTEGER NOT NULL CHECK(separate IN (0,1)),
 created INTEGER NOT NULL, start_day INTEGER NOT NULL, sponsor TEXT,
 first_reward INTEGER NOT NULL CHECK(first_reward>=0), daily_reward INTEGER NOT NULL CHECK(daily_reward>=0),
 reserve INTEGER NOT NULL CHECK(reserve>=0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS wallet_plans_owner ON wallet_plans(user_id,created,id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS wallet_plans_sponsor ON wallet_plans(sponsor,created);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS wallet_first_reward ON wallet_plans(user_id) WHERE first_reward>0;
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS wallet_reserve AS
 SELECT COALESCE((SELECT SUM(amount) FROM wallet_reward_funds),0) -
        COALESCE((SELECT SUM(reserve) FROM wallet_plans),0) AS available;
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS wallet_plan_credits(request_id,user_id,event,delta,created) AS
 SELECT id,user_id,'plan payout',daily*min(days,max(0,unixepoch()/86400-start_day)),
   (start_day+min(days,max(0,unixepoch()/86400-start_day)))*86400 FROM wallet_plans WHERE unixepoch()/86400>start_day
 UNION ALL SELECT id,user_id,'principal returned',amount,(start_day+days)*86400
   FROM wallet_plans WHERE separate=1 AND unixepoch()/86400>=start_day+days
 UNION ALL SELECT id,sponsor,'referral reward',first_reward+daily_reward*min(days,max(0,unixepoch()/86400-start_day)),
   max(created,(start_day+min(days,max(0,unixepoch()/86400-start_day)))*86400)
   FROM wallet_plans WHERE sponsor IS NOT NULL AND (first_reward>0 OR unixepoch()/86400>start_day);
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS wallet_cash_journal AS
 SELECT request_id,user_id,event,delta,created FROM manual_ledger
 UNION ALL SELECT id,user_id,'reserve funding',-amount,created FROM wallet_reward_funds
 UNION ALL SELECT id,user_id,'investment',-amount,created FROM wallet_plans
 UNION ALL SELECT request_id,user_id,event,delta,created FROM wallet_plan_credits;
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS wallet_invested_principal AS
 SELECT user_id, amount FROM receipts WHERE stage='active'
 UNION ALL SELECT user_id, amount*10000 FROM wallet_plans;
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS wallet_funded_referrals AS
 SELECT p.sponsor AS sponsor,p.user_id AS investor FROM wallet_plans p
 WHERE p.sponsor IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM wallet_plans earlier WHERE earlier.user_id=p.user_id
  AND (earlier.created<p.created OR (earlier.created=p.created AND earlier.id<p.id))
 )
 UNION
 SELECT sponsor.user_id,investor.user_id FROM receipts investor
 JOIN receipts sponsor ON sponsor.receiver=investor.referrer COLLATE NOCASE
 WHERE investor.stage='active' AND investor.user_id<>sponsor.user_id
 AND NOT EXISTS(SELECT 1 FROM receipts earlier WHERE earlier.user_id=investor.user_id AND earlier.stage='active'
   AND (earlier.created<investor.created OR (earlier.created=investor.created AND earlier.rowid<investor.rowid)));
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS wallet_fund_guard BEFORE INSERT ON wallet_reward_funds
BEGIN
 SELECT CASE WHEN NEW.amount>COALESCE((SELECT SUM(delta) FROM wallet_cash_journal WHERE user_id=NEW.user_id),0)
 THEN RAISE(ABORT,'manual insufficient balance') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS wallet_invest_guard BEFORE INSERT ON wallet_plans
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM manual_account_controls WHERE user_id=NEW.user_id AND held=1)
 THEN RAISE(ABORT,'manual account held') END;
 SELECT CASE WHEN NEW.amount>COALESCE((SELECT SUM(delta) FROM wallet_cash_journal WHERE user_id=NEW.user_id),0)
 THEN RAISE(ABORT,'manual insufficient balance') END;
 SELECT CASE WHEN NEW.reserve>(SELECT available FROM wallet_reserve)
 THEN RAISE(ABORT,'wallet rewards underfunded') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM wallet_plans WHERE user_id=NEW.user_id AND
  (sponsor IS NOT NEW.sponsor OR NEW.first_reward>0)) THEN RAISE(ABORT,'wallet referral changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS wallet_plans_immutable_update BEFORE UPDATE ON wallet_plans BEGIN SELECT RAISE(ABORT,'immutable investment'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS wallet_plans_immutable_delete BEFORE DELETE ON wallet_plans BEGIN SELECT RAISE(ABORT,'immutable investment'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS wallet_funds_immutable_update BEFORE UPDATE ON wallet_reward_funds BEGIN SELECT RAISE(ABORT,'immutable funding'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS wallet_funds_immutable_delete BEFORE DELETE ON wallet_reward_funds BEGIN SELECT RAISE(ABORT,'immutable funding'); END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS manual_submission_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS manual_submission_guard BEFORE INSERT ON manual_payments
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
  NEW.amount+NEW.fee>COALESCE((SELECT SUM(delta) FROM wallet_cash_journal WHERE user_id=NEW.user_id),0)
  THEN RAISE(ABORT,'manual insufficient balance') END;
 SELECT CASE WHEN NEW.kind='withdrawal' AND
  NEW.amount+NEW.fee+COALESCE((SELECT SUM(amount+fee) FROM manual_payments
   WHERE user_id=NEW.user_id AND kind='withdrawal' AND status NOT IN ('rejected','cancelled')
    AND created>=NEW.created/86400*86400),0)>
  COALESCE((SELECT SUM(amount) FROM wallet_invested_principal WHERE user_id=NEW.user_id),0)
    *(SELECT daily_bps FROM manual_policy WHERE id=1)/100000000
  THEN RAISE(ABORT,'manual daily limit') END;
END;
