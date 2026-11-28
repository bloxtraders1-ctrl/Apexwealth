ALTER TABLE login_accounts ADD COLUMN google_subject TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX login_accounts_google_subject ON login_accounts(google_subject) WHERE google_subject IS NOT NULL;
--> statement-breakpoint
CREATE TABLE google_signin_requests (
 state_digest TEXT PRIMARY KEY,
 expires INTEGER NOT NULL,
 verifier TEXT NOT NULL,
 nonce TEXT NOT NULL,
 next_path TEXT NOT NULL,
 return_page TEXT NOT NULL,
 link_session TEXT
);
