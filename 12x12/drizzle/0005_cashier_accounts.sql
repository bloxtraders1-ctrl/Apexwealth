CREATE TABLE manual_account_controls (
 user_id TEXT PRIMARY KEY, held INTEGER NOT NULL CHECK(held IN (0,1)), note TEXT NOT NULL,
 actor TEXT NOT NULL, updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER manual_account_control_added AFTER INSERT ON manual_account_controls BEGIN
 INSERT INTO manual_audit(request_id,actor,event,created,detail)
 VALUES('user:'||NEW.user_id,NEW.actor,CASE NEW.held WHEN 1 THEN 'cashier held' ELSE 'cashier resumed' END,NEW.updated,json_object('note',NEW.note));
END;
--> statement-breakpoint
CREATE TRIGGER manual_account_control_changed AFTER UPDATE ON manual_account_controls BEGIN
 INSERT INTO manual_audit(request_id,actor,event,created,detail)
 VALUES('user:'||NEW.user_id,NEW.actor,CASE NEW.held WHEN 1 THEN 'cashier held' ELSE 'cashier resumed' END,NEW.updated,json_object('note',NEW.note));
END;
--> statement-breakpoint
CREATE TRIGGER manual_held_reservation BEFORE INSERT ON manual_payments
 WHEN NEW.kind='withdrawal' AND EXISTS(SELECT 1 FROM manual_account_controls WHERE user_id=NEW.user_id AND held=1)
 BEGIN SELECT RAISE(ABORT,'manual account held'); END;
--> statement-breakpoint
CREATE TRIGGER manual_held_payout BEFORE UPDATE ON manual_payments
 WHEN NEW.kind='withdrawal' AND NEW.status IN ('processing','broadcasting')
 AND EXISTS(SELECT 1 FROM manual_account_controls WHERE user_id=NEW.user_id AND held=1)
 BEGIN SELECT RAISE(ABORT,'manual account held'); END;
