ALTER TABLE analytics_visitors ADD COLUMN last_seen INTEGER;
--> statement-breakpoint
CREATE INDEX analytics_online_visitors ON analytics_visitors(last_seen, browser_digest) WHERE last_seen IS NOT NULL;
