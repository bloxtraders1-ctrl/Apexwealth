CREATE TABLE wallet_payday_policy (id INTEGER PRIMARY KEY CHECK(id=1), starts_at INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO wallet_payday_policy VALUES(1,unixepoch());
--> statement-breakpoint
CREATE TABLE us_federal_holidays (day TEXT PRIMARY KEY, name TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO us_federal_holidays
WITH RECURSIVE years(y) AS (
 VALUES(1971) UNION ALL SELECT y+1 FROM years WHERE y<2199
), holidays(day,name,observed) AS (
 SELECT printf('%04d-01-01',y),'New Year’s Day',1 FROM years
 UNION ALL SELECT date(printf('%04d-01-15',y),'weekday 1'),'Martin Luther King Jr. Day',0 FROM years WHERE y>=1986
 UNION ALL SELECT date(printf('%04d-02-15',y),'weekday 1'),'Washington’s Birthday',0 FROM years
 UNION ALL SELECT date(printf('%04d-05-25',y),'weekday 1'),'Memorial Day',0 FROM years
 UNION ALL SELECT printf('%04d-06-19',y),'Juneteenth',1 FROM years WHERE y>=2021
 UNION ALL SELECT printf('%04d-07-04',y),'Independence Day',1 FROM years
 UNION ALL SELECT date(printf('%04d-09-01',y),'weekday 1'),'Labor Day',0 FROM years
 UNION ALL SELECT date(printf('%04d-10-08',y),'weekday 1'),'Columbus Day',0 FROM years
 UNION ALL SELECT printf('%04d-11-11',y),'Veterans Day',1 FROM years
 UNION ALL SELECT date(printf('%04d-11-22',y),'weekday 4'),'Thanksgiving Day',0 FROM years
 UNION ALL SELECT printf('%04d-12-25',y),'Christmas Day',1 FROM years
)
SELECT CASE WHEN observed=1 THEN CASE strftime('%w',day)
 WHEN '6' THEN date(day,'-1 day') WHEN '0' THEN date(day,'+1 day') ELSE day END ELSE day END,name
FROM holidays;
--> statement-breakpoint
DROP VIEW wallet_plan_schedule;
--> statement-breakpoint
CREATE VIEW wallet_plan_paydays AS
WITH RECURSIVE slots(id,user_id,sponsor,days,at,n,paid,cutoff) AS (
 SELECT p.id,p.user_id,p.sponsor,p.days,COALESCE(p.credit_anchor,p.start_day*86400),0,0,c.starts_at
 FROM wallet_plans p CROSS JOIN wallet_payday_policy c
 UNION ALL
 SELECT id,user_id,sponsor,days,at+86400,n+CASE WHEN at+86400<=cutoff OR (
  strftime('%w',at+86400,'unixepoch') BETWEEN '1' AND '5'
  AND NOT EXISTS(SELECT 1 FROM us_federal_holidays h WHERE h.day=date(at+86400,'unixepoch'))
 ) THEN 1 ELSE 0 END,n,cutoff
 FROM slots WHERE n<days
)
SELECT id,user_id,sponsor,at,n FROM slots WHERE n>paid;
--> statement-breakpoint
CREATE VIEW wallet_plan_schedule AS
SELECT p.*,COALESCE(p.credit_anchor,p.start_day*86400) AS credit_start,
 MIN(s.at) AS first_credit_at, MAX(s.at) AS matures_at,
 COUNT(CASE WHEN s.at<=unixepoch() THEN 1 END) AS credits_due,
 MAX(CASE WHEN s.at<=unixepoch() THEN s.at END) AS last_credit_at,
 MIN(CASE WHEN s.at>unixepoch() THEN s.at END) AS next_credit_at
FROM wallet_plans p JOIN wallet_plan_paydays s ON s.id=p.id GROUP BY p.id;
--> statement-breakpoint
DROP VIEW wallet_plan_credits;
--> statement-breakpoint
CREATE VIEW wallet_plan_credits(request_id,user_id,event,delta,created) AS
 SELECT id,user_id,'plan payout',daily*credits_due,last_credit_at
   FROM wallet_plan_schedule WHERE credits_due>0
 UNION ALL SELECT id,user_id,'principal returned',amount,matures_at
   FROM wallet_plan_schedule WHERE separate=1 AND credits_due=days
 UNION ALL SELECT id,sponsor,'referral reward',first_reward+daily_reward*credits_due,
   max(created,COALESCE(last_credit_at,created))
   FROM wallet_plan_schedule WHERE sponsor IS NOT NULL AND (first_reward>0 OR credits_due>0);
