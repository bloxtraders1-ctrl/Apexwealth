CREATE TABLE analytics_visitors (
 day INTEGER NOT NULL,
 browser_digest TEXT NOT NULL,
 page_views INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY (day, browser_digest)
);
--> statement-breakpoint
CREATE TABLE analytics_signups (
 day INTEGER PRIMARY KEY,
 signups INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER analytics_record_signup AFTER INSERT ON login_accounts
BEGIN
 INSERT INTO analytics_signups (day,signups) VALUES (unixepoch()/86400,1)
 ON CONFLICT(day) DO UPDATE SET signups=signups+1;
END;
