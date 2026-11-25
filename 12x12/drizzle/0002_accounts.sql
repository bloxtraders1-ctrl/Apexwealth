CREATE TABLE login_accounts (username TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, verifier TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE login_sessions (digest TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES login_accounts(id), expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE login_limits (bucket TEXT PRIMARY KEY, until_ts INTEGER NOT NULL, attempts INTEGER NOT NULL);
