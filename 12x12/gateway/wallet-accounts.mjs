import {tiers} from '../dist/tiers.js';
import {check} from './chain.mjs';
import {parseDecimal} from './manual-assets.mjs';

function planCredits(amount,tier,separate,hasSponsor=false,firstInvestment=false){
 const daily=Math.floor(amount*tier.rate/100);
 const firstReward=hasSponsor&&firstInvestment?Math.floor(amount*12/100):0;
 const dailyReward=hasSponsor?Math.floor(amount/100):0;
 const liability=daily*tier.days+(separate?0:-amount)+firstReward+dailyReward*tier.days;
 return {daily,firstReward,dailyReward,liability};
}

export function walletAccounts({read,all,run,user,now,separate}){
 const balance=async()=>Number((await read('SELECT COALESCE(SUM(delta),0) AS amount FROM wallet_cash_journal WHERE user_id=?',user)).amount);
 const reserve=async()=>Number((await read('SELECT available FROM wallet_reserve')).available);
 const referrals=async()=>Number((await read('SELECT COUNT(DISTINCT investor) AS total FROM wallet_funded_referrals WHERE sponsor=?',user)).total);
 const referralEligible=async(id)=>Boolean(await read(`SELECT 1 AS eligible FROM wallet_plans WHERE user_id=? UNION ALL
  SELECT 1 FROM receipts WHERE user_id=? AND stage='active' LIMIT 1`,id,id));
 const requestId=value=>{
  check(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),'Invalid request ID.');
  return value;
 };
 const money=value=>{
  const amount=parseDecimal(value,2,'USD amount');
  check(amount>0n&&amount<=100000000n,'Enter a valid USD amount.');
  return Number(amount);
 };
 async function sponsorship({referral,legacyReferral}){
   const existing=await read('SELECT sponsor FROM wallet_plans WHERE user_id=? ORDER BY created,id LIMIT 1',user);
   const baseFirst=await read(`SELECT sponsor.user_id AS sponsor
    FROM receipts investor LEFT JOIN receipts sponsor ON sponsor.receiver=investor.referrer COLLATE NOCASE
    WHERE investor.user_id=? AND investor.stage='active' ORDER BY investor.created,investor.rowid LIMIT 1`,user);
   const wasFunded=existing||baseFirst;
   let sponsor=wasFunded?.sponsor||null;
   if(sponsor===user)sponsor=null;
   if(!wasFunded){
    const ref=referral;
    if(typeof ref==='string'&&ref!==user&&/^[a-z0-9-]{3,80}$/i.test(ref)&&await referralEligible(ref))sponsor=ref;
    const address=legacyReferral;
    if(!sponsor&&typeof address==='string'&&/^0x[0-9a-f]{40}$/i.test(address)){
     const result=await read("SELECT user_id FROM receipts WHERE receiver=? COLLATE NOCASE AND stage='active'",address);
     if(result?.user_id!==user)sponsor=result?.user_id||null;
    }
   }
   return {sponsor,wasFunded};
 }
 return {
  async reserveStatus(){
   const [available,wallet]=await Promise.all([reserve(),balance()]);
   return {available,wallet,minimum:planCredits(tiers[0].min*100,tiers[0],separate).liability};
  },
  async profile(){
   const [settings,login,fundedReferrals,eligible,snapshot]=await Promise.all([
    read('SELECT display_name FROM wallet_profiles WHERE user_id=?',user),
    read('SELECT username,email FROM login_accounts WHERE id=?',user),referrals(),referralEligible(user),
    read(`WITH upcoming AS (
     SELECT credit_start+(credits_due+1)*86400 AS at,SUM(daily) AS amount
     FROM wallet_plan_schedule WHERE user_id=? AND credits_due<days GROUP BY at ORDER BY at LIMIT 1
    )
    SELECT upcoming.*,unixepoch() AS now,
     (SELECT COALESCE(SUM(delta),0) FROM wallet_cash_journal WHERE user_id=?) AS balance
    FROM (SELECT 1) LEFT JOIN upcoming ON 1=1`,user,user)
   ]);
   const {at,amount,now:observedAt,balance:wallet}=snapshot;
   const nextCredit=at===null?null:{at,amount,now:observedAt};
   return {userId:user,name:settings?.display_name||(login?.username!==user?login?.username:null)||'12x12 member',
    email:login?.email||null,balance:wallet,referrals:fundedReferrals,referralEligible:eligible,nextCredit};
  },
  async affiliateDashboard(){
   const today=Math.floor(now/86400);
   const firstDay=today-89;
   const [eligible,funded,totals,days]=await Promise.all([
    referralEligible(user),referrals(),
    read(`SELECT
     COALESCE(SUM(first_reward),0) AS first,
     COALESCE(SUM(daily_reward*credits_due),0) AS daily,
     COUNT(CASE WHEN credits_due<days THEN 1 END) AS active
     FROM wallet_plan_schedule WHERE sponsor=? AND created<=?`,user,now),
    all(`WITH RECURSIVE dates(day) AS (
     VALUES(?) UNION ALL SELECT day+1 FROM dates WHERE day<?
    ), sponsored AS (
     SELECT created/86400 AS opened_day,credit_start/86400 AS credit_day,credits_due,first_reward,daily_reward
     FROM wallet_plan_schedule WHERE sponsor=? AND created<=? AND matures_at/86400>=?
    )
    SELECT dates.day,
     COALESCE(SUM(CASE WHEN dates.day=opened_day THEN first_reward ELSE 0 END),0) AS first,
     COALESCE(SUM(CASE WHEN dates.day>credit_day THEN daily_reward ELSE 0 END),0) AS daily
    FROM dates LEFT JOIN sponsored ON dates.day BETWEEN opened_day AND credit_day+credits_due
    GROUP BY dates.day ORDER BY dates.day`,firstDay,today,user,now,firstDay)
   ]);
   return {referralId:eligible?user:null,funded,totalFirst:totals.first,totalDaily:totals.daily,activePlans:totals.active,days};
  },
  async rename(value){
   const name=typeof value==='string'?value.trim().normalize('NFC'):'';
   check(name.length>=2&&name.length<=48&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name),'Use 2–48 characters for your account name.');
   await run('INSERT INTO wallet_profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name',user,name);
   return {name};
  },
  async access(){
   const [wallet,fundedReferrals,hold]=await Promise.all([
    balance(),referrals(),read('SELECT held FROM manual_account_controls WHERE user_id=?',user)
   ]);
   const eligibility=Object.fromEntries(tiers.map(tier=>[tier.id,
    hold?.held?'hold':fundedReferrals<tier.referrals?'referrals':wallet<tier.min*100?'balance':'available'
   ]));
   const availablePlans=tiers.filter(tier=>eligibility[tier.id]==='available').map(tier=>tier.id);
   return {userId:user,balance:wallet,available:availablePlans.includes(1),availablePlans,fundedReferrals,separate,eligibility,startDay:Math.floor(now/86400)};
  },
  async invest(body){
   const id=requestId(body.id);
   const tier=tiers.find(plan=>plan.id===body.plan);
   check(tier,'Choose an investment plan.');
   const amount=money(body.amount);
   check(amount>=tier.min*100&&amount<=tier.max*100,'Enter an amount within the plan limits.');
   const lookup=()=>read('SELECT id,amount,plan_id AS plan,credit_start+86400 AS firstCreditAt FROM wallet_plan_schedule WHERE id=? AND user_id=?',id,user);
   const prior=await lookup();
   if(prior){
    check(prior.plan===tier.id&&prior.amount===amount,'This investment request was already used.',409);
    return prior;
   }
   check(await referrals()>=tier.referrals,'This plan needs '+tier.referrals+' funded direct referrals.',409);
   const {sponsor,wasFunded}=await sponsorship(body);
   const {daily,firstReward,dailyReward,liability}=planCredits(amount,tier,separate,Boolean(sponsor),!wasFunded);
   await run(`INSERT INTO wallet_plans(id,user_id,plan_id,amount,rate,days,daily,separate,created,start_day,sponsor,first_reward,daily_reward,reserve,credit_anchor)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM wallet_plans WHERE id=?)`,
    id,user,tier.id,amount,tier.rate,tier.days,daily,Number(separate),now,Math.floor(now/86400),sponsor,firstReward,dailyReward,liability,now,id);
   const created=await lookup();
   check(created?.plan===tier.id&&created.amount===amount,'This investment request was already used.',409);
   return created;
  },
  async fund(body){
   const id=requestId(body.id),amount=money(body.amount);
   await run(`INSERT INTO wallet_reward_funds(id,user_id,amount,created)
    SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM wallet_reward_funds WHERE id=?)`,id,user,amount,now,id);
   const row=await read('SELECT amount FROM wallet_reward_funds WHERE id=? AND user_id=?',id,user);
   check(row?.amount===amount,'This reserve funding request was already used.',409);
   return {available:await reserve(),wallet:await balance()};
  },
  async history(before){
   const offset=Number(before||0);
   check(Number.isSafeInteger(offset)&&offset>=0,'Invalid history page.');
   const rows=await all(`WITH RECURSIVE days(n) AS (
    VALUES(1) UNION ALL SELECT n+1 FROM days WHERE n<20
   ), cash_entries AS (
    SELECT p.id,p.kind,p.status,p.amount,p.created,q.network,q.address,p.tx,q.fee,q.asset,p.note,NULL AS plan,
      q.crypto,q.rate_source,q.rate,p.confirmations,p.updated
     FROM manual_payments p JOIN manual_quotes q ON q.id=p.id WHERE p.user_id=?
    UNION ALL SELECT id,'Base receipt',stage,amount/10000.0,created,'Base',receiver,tx,0,'usdc-base',NULL,plan_id,NULL,NULL,NULL,NULL,NULL FROM receipts WHERE user_id=?
    UNION ALL SELECT w.id,'Base withdrawal',w.stage,w.amount/10000.0,w.created,'Base',COALESCE(w.destination,r.payout),
      NULL,0,'usdc-base',NULL,r.plan_id,NULL,NULL,NULL,NULL,NULL FROM withdrawals w JOIN receipts r ON r.id=w.receipt WHERE r.user_id=?
   ), plan_entries(id,kind,status,amount,created,network,address,tx,fee,asset,note,plan,crypto,rate_source,rate,confirmations,updated) AS (
    SELECT id,'investment',CASE WHEN credits_due=days THEN 'matured' ELSE 'active' END,
     amount,created,NULL,NULL,NULL,0,NULL,NULL,plan_id,NULL,NULL,NULL,NULL,NULL FROM wallet_plan_schedule WHERE user_id=?
    UNION ALL SELECT request_id,event,'credited',delta,created,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
     FROM wallet_cash_journal WHERE user_id=? AND event IN ('principal returned','reserve funding')
    UNION ALL SELECT p.id,'plan payout','credited',p.daily,p.credit_start+d.n*86400,NULL,NULL,NULL,0,NULL,NULL,
      p.plan_id,NULL,NULL,NULL,NULL,NULL
     FROM wallet_plan_schedule p JOIN days d ON d.n<=p.credits_due WHERE p.user_id=?
    UNION ALL SELECT id,'first referral reward','credited',first_reward,created,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
     FROM wallet_plans WHERE sponsor=? AND first_reward>0
    UNION ALL SELECT p.id,'daily referral reward','credited',p.daily_reward,p.credit_start+d.n*86400,NULL,NULL,NULL,
      0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL FROM wallet_plan_schedule p
     JOIN days d ON d.n<=p.credits_due WHERE p.sponsor=? AND p.daily_reward>0
   ) SELECT * FROM cash_entries UNION ALL SELECT * FROM plan_entries ORDER BY created DESC,id DESC,kind LIMIT 51 OFFSET ?`,user,user,user,user,user,user,user,user,offset);
   const page=rows.slice(0,50);
   const payments=page.filter(row=>row.kind==='deposit'||row.kind==='withdrawal');
   if(payments.length){
    const placeholders=payments.map(()=>'?').join(',');
    const events=await all(`SELECT a.request_id,a.event,a.created FROM manual_audit a JOIN manual_payments p ON p.id=a.request_id
     WHERE p.user_id=? AND a.request_id IN (${placeholders})
      AND a.event IN ('submitted','approved','processing','broadcasting','sent','completed','rejected','cancelled')
     ORDER BY a.seq`,user,...payments.map(row=>row.id));
    const byPayment=new Map(payments.map(row=>[row.id,row.timeline=[]]));
    for(const {request_id,event,created} of events)byPayment.get(request_id).push({event,created});
   }
   return {rows:page,next:rows.length>50?offset+50:null};
  }
 };
}
