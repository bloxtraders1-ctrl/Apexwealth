ALTER TABLE login_accounts ADD COLUMN email TEXT COLLATE NOCASE;
--> statement-breakpoint
CREATE UNIQUE INDEX login_accounts_email ON login_accounts(email) WHERE email IS NOT NULL;
