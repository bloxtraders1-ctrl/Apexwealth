ALTER TABLE wallet_plans ADD COLUMN credit_anchor INTEGER CHECK(credit_anchor IS NULL OR credit_anchor=created);
--> statement-breakpoint
CREATE VIEW wallet_plan_schedule AS
 WITH scheduled AS (
  SELECT p.*,COALESCE(credit_anchor,start_day*86400) AS credit_start FROM wallet_plans p
 )
 SELECT *,credit_start+days*86400 AS matures_at,
  min(days,max(0,CAST((unixepoch()-credit_start)/86400 AS INTEGER))) AS credits_due
 FROM scheduled;
--> statement-breakpoint
DROP VIEW IF EXISTS wallet_plan_credits;
--> statement-breakpoint
CREATE VIEW wallet_plan_credits(request_id,user_id,event,delta,created) AS
 SELECT id,user_id,'plan payout',daily*credits_due,credit_start+credits_due*86400
   FROM wallet_plan_schedule WHERE credits_due>0
 UNION ALL SELECT id,user_id,'principal returned',amount,matures_at
   FROM wallet_plan_schedule WHERE separate=1 AND credits_due=days
 UNION ALL SELECT id,sponsor,'referral reward',first_reward+daily_reward*credits_due,
   max(created,credit_start+credits_due*86400)
   FROM wallet_plan_schedule WHERE sponsor IS NOT NULL AND (first_reward>0 OR credits_due>0);
