import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function localDB(file){
 if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});
 const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(!db.prepare("SELECT name FROM sqlite_master WHERE name='receipts'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0000_cashier.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM pragma_table_info('receipts') WHERE name='plan_id'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0001_receipt_tiers.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='login_accounts'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0002_accounts.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM pragma_table_info('withdrawals') WHERE name='destination'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0003_withdrawal_destination.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='manual_payments'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0004_manual_cashier.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='manual_account_controls'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0005_cashier_accounts.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='activity_opening_totals'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0006_activity_opening_totals.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM pragma_table_info('login_accounts') WHERE name='email'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0007_email_login.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='manual_transition_guard' AND instr(sql,?)>0").get("'processing','broadcasting','rejected','cancelled'")){
  db.exec('BEGIN;'+readFileSync('drizzle/0008_simplified_withdrawal_review.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='wallet_plans'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0009_wallet_investing.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='manual_approved_hash'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0010_cashier_manual_approval.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='support_reply_updates_ticket'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0011_support_tickets.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='manual_deposit_evidence_guard'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0012_manual_deposit_evidence.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='manual_deposit_evidence_guard' AND instr(sql,?)>0").get("'cashier'")){
  db.exec('BEGIN;'+readFileSync('drizzle/0013_cashier_decisions.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='platform_launch'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0014_launch_and_wallet_credits.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='wallet_plan_schedule'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0015_investment_credit_intervals.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='wallet_plan_paydays'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0016_business_day_credits.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='manual_verified_deposit_only'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0017_verified_deposit_approvals.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='wallet_payday_skip_guard'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0018_payday_exceptions.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='google_signin_requests'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0019_google_login.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_record_signup'").get()){
  db.exec('BEGIN;'+readFileSync('drizzle/0020_admin_analytics.sql','utf8')+'COMMIT;');
 }
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_online_visitors'").get()){
  db.exec('BEGIN IMMEDIATE;');
  try{
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_online_visitors'").get()){
    db.exec(readFileSync('drizzle/0021_online_visitors.sql','utf8'));
   }
   db.exec('COMMIT;');
  }catch(error){
   db.exec('ROLLBACK;');
   throw error;
  }
 }
 return {prepare(s){const st=db.prepare(s);return {bind(...a){return {first:()=>st.get(...a),all:()=>({results:st.all(...a)}),run:()=>({meta:{changes:st.run(...a).changes}})};}};}};
}
