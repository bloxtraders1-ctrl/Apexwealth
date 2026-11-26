CREATE TABLE platform_launch (
 id INTEGER PRIMARY KEY CHECK(id=1),
 launch_at INTEGER NOT NULL CHECK(launch_at>0)
);
--> statement-breakpoint
INSERT INTO platform_launch VALUES(1,unixepoch()+12*3600);
--> statement-breakpoint
DROP TRIGGER IF EXISTS wallet_invest_guard;
--> statement-breakpoint
CREATE TRIGGER wallet_invest_guard BEFORE INSERT ON wallet_plans
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM manual_account_controls WHERE user_id=NEW.user_id AND held=1)
 THEN RAISE(ABORT,'manual account held') END;
 SELECT CASE WHEN NEW.amount>COALESCE((SELECT SUM(delta) FROM wallet_cash_journal WHERE user_id=NEW.user_id),0)
 THEN RAISE(ABORT,'manual insufficient balance') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM wallet_plans WHERE user_id=NEW.user_id AND
  (sponsor IS NOT NEW.sponsor OR NEW.first_reward>0)) THEN RAISE(ABORT,'wallet referral changed') END;
END;
