CREATE TABLE IF NOT EXISTS support_tickets (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 3 AND 120),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 answered INTEGER NOT NULL DEFAULT 0 CHECK(answered IN (0,1))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_owner ON support_tickets(user_id,updated DESC,id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_recent ON support_tickets(updated DESC,id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS support_replies (
 seq INTEGER PRIMARY KEY,
 id TEXT NOT NULL UNIQUE,
 ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
 author_id TEXT NOT NULL,
 from_support INTEGER NOT NULL CHECK(from_support IN (0,1)),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_replies_thread ON support_replies(ticket_id,seq);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS support_reply_updates_ticket AFTER INSERT ON support_replies
BEGIN
 UPDATE support_tickets SET updated=MAX(updated,NEW.created),answered=NEW.from_support WHERE id=NEW.ticket_id;
END;
