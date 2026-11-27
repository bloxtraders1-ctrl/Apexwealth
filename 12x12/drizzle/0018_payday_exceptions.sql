CREATE TABLE wallet_payday_skips (
 day TEXT PRIMARY KEY CHECK(date(day,'+0 days') IS day),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 240),
 actor TEXT NOT NULL,
 created INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
DROP VIEW wallet_plan_paydays;
--> statement-breakpoint
CREATE VIEW wallet_plan_paydays AS
WITH RECURSIVE slots(id,user_id,sponsor,days,at,n,paid,cutoff) AS (
 SELECT p.id,p.user_id,p.sponsor,p.days,COALESCE(p.credit_anchor,p.start_day*86400),0,0,c.starts_at
 FROM wallet_plans p CROSS JOIN wallet_payday_policy c
 UNION ALL
 SELECT id,user_id,sponsor,days,at+86400,n+CASE WHEN at+86400<=cutoff OR (
  strftime('%w',at+86400,'unixepoch') BETWEEN '1' AND '5'
  AND NOT EXISTS(SELECT 1 FROM us_federal_holidays h WHERE h.day=date(at+86400,'unixepoch'))
  AND NOT EXISTS(SELECT 1 FROM wallet_payday_skips e WHERE e.day=date(at+86400,'unixepoch'))
 ) THEN 1 ELSE 0 END,n,cutoff
 FROM slots WHERE n<days
)
SELECT id,user_id,sponsor,at,n FROM slots WHERE n>paid;
--> statement-breakpoint
CREATE TRIGGER wallet_payday_skip_guard BEFORE INSERT ON wallet_payday_skips
BEGIN
 SELECT CASE WHEN NEW.day<date(unixepoch(),'unixepoch') THEN RAISE(ABORT,'payday skip in past') END;
 SELECT CASE WHEN strftime('%w',NEW.day) NOT BETWEEN '1' AND '5'
  OR EXISTS(SELECT 1 FROM us_federal_holidays WHERE day=NEW.day)
  THEN RAISE(ABORT,'payday already excluded') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM wallet_plan_paydays p WHERE p.at BETWEEN unixepoch(NEW.day) AND unixepoch()
   AND p.at<unixepoch(NEW.day,'+1 day')
 ) THEN RAISE(ABORT,'payday credits already posted') END;
END;
