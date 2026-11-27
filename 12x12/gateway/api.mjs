import {ZeroAddress,verifyMessage,parseUnits} from 'ethers';
import settings from '../dist/config.json' with {type:'json'};
import {chain,check,address,same} from './chain.mjs';
const opaque=()=> '0x'+Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const tiers=new Map([[1,{min:12,max:1200,required:0}],[2,{min:50,max:1500,required:5}],[3,{min:200,max:2500,required:10}]]);
const txPattern=/^0x[0-9a-f]{64}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
let lastReadiness;
function settlementReadiness(config,rpcUrl,net){
 const key=JSON.stringify([config,rpcUrl]);
 const now=Date.now();
 if(lastReadiness?.key===key&&now<lastReadiness.expires)return lastReadiness.value;
 const value=net.readiness().catch(()=>({depositReady:false,withdrawalReady:false,reason:'verification'}));
 lastReadiness={key,expires:now+20_000,value};
 return value;
}

export async function handleAPI(req,env,user,mode,chainOverride){
 try{
  const url=new URL(req.url),route=url.pathname.slice(5),cfg=env.settings||settings;
  const enabled=Boolean(cfg.vaultAddress&&cfg.factoryAddress);
  if(route==='launch'&&req.method==='GET'){
   const schedule=await env.DB.prepare('SELECT launch_at AS launchAt, unixepoch() AS now FROM platform_launch WHERE id=1').bind().first();
   return json(schedule);
  }
  if(route==='status')return json({enabled,signedIn:!!user,mode,environment:env.accountEnvironment||mode,separatePrincipal:cfg.separatePrincipal,capOnBalance:cfg.capOnBalance});
  if(route==='settlement-status'&&req.method==='GET'){
   const cfgState={depositReady:false,withdrawalReady:false};
   if(!enabled)return json({...cfgState,reason:'configuration'});
   const net=chainOverride||chain(cfg,env.BASE_RPC_URL);
   const ready=chainOverride?await net.readiness():await settlementReadiness(cfg,env.BASE_RPC_URL,net);
   return json({...ready,reason:ready.reason||(ready.depositReady?null:'reserve')});
  }
  if(route==='statistics' && req.method==='GET'){
   const admins=(env.APEX_CASHIER_ADMIN_IDS||'').split(',').map(id=>id.trim());
   check(user&&admins.includes(user),'Cashier administrator access required.',403);
   const result=await env.DB.prepare(`
    WITH totals AS (
     SELECT COALESCE(SUM(CASE WHEN kind='investment' THEN amount ELSE 0 END),0) AS invested,
            COALESCE(SUM(CASE WHEN kind='payout' THEN amount ELSE 0 END),0) AS paid,
            COUNT(CASE WHEN kind='investment' THEN 1 END) AS investments,
            COUNT(CASE WHEN kind='payout' THEN 1 END) AS payouts FROM confirmed_cashier_activity
    ), recent AS (SELECT kind,amount,created FROM confirmed_cashier_activity ORDER BY created DESC,id DESC LIMIT 5)
    SELECT totals.invested + opening.deposited - opening.recorded_deposited AS invested,
           totals.paid + opening.paid_out - opening.recorded_paid_out AS paid,
           totals.investments,totals.payouts,recent.kind,recent.amount,recent.created
    FROM totals JOIN activity_opening_totals opening ON opening.id=1 LEFT JOIN recent ON 1=1
    ORDER BY recent.created DESC
   `).bind().all();
   const {invested,paid,investments,payouts}=result.results[0];
   const manual=(await env.DB.prepare("SELECT 1 AS ready FROM manual_options WHERE enabled=1 LIMIT 1").bind().first())?.ready===1;
   return json({invested,paid,investments,payouts,configured:enabled,manual,recent:result.results.filter(row=>row.kind).map(({kind,amount,created})=>({kind,amount,created}))});
  }
  check(user,'Sign in to access your deposit account.',401);
  const db=env.DB,net=chainOverride||chain(cfg,env.BASE_RPC_URL);
  const sql=(s,...args)=>db.prepare(s).bind(...args);
  const all=async(s,...args)=>(await sql(s,...args).all()).results;
  async function fundedReferrals(payout=null){
   const row=await sql(`SELECT COUNT(DISTINCT investor.user_id) AS n FROM receipts investor
    JOIN receipts sponsor ON sponsor.receiver=investor.referrer COLLATE NOCASE
    WHERE sponsor.user_id=? AND investor.user_id<>sponsor.user_id AND investor.stage='active'
      AND (? IS NULL OR sponsor.payout=? COLLATE NOCASE)
      AND NOT EXISTS (
       SELECT 1 FROM receipts earlier WHERE earlier.user_id=investor.user_id AND earlier.stage='active'
        AND (earlier.created < investor.created OR (earlier.created=investor.created AND earlier.rowid<investor.rowid))
      )`,user,payout,payout).first();
   return Number(row.n);
  }
  async function eligibility(payout){
   const [accounts,beneficiaries]=await Promise.all([fundedReferrals(payout),net.qualified(payout)]);
   const count=Math.min(accounts,beneficiaries);
   return {fundedReferrals:count,eligibleThrough:count>=10?3:count>=5?2:1};
  }
  if(route==='plan-access'&&req.method==='GET'){
   const response={fundedReferrals:await fundedReferrals(),plans:{}};
   if(!enabled||response.fundedReferrals<tiers.get(2).required)return json(response);
   const addresses=await all("SELECT DISTINCT payout FROM receipts WHERE user_id=? AND stage='active'",user);
   for(const {payout} of addresses){
    if(await fundedReferrals(payout)<tiers.get(2).required)continue;
    const {eligibleThrough}=await eligibility(payout);
    for(let tier=2;tier<=eligibleThrough;tier++)response.plans[tier]??=payout;
    if(response.plans[3])break;
   }
   return json(response);
  }
  if(route==='wallet-balance'&&req.method==='GET'){
   const active=await all("SELECT * FROM receipts WHERE user_id=? AND stage='active'",user);
   if(!active.length)return json({available:'0'});
   const queued=await all("SELECT w.receipt FROM withdrawals w JOIN receipts r ON r.id=w.receipt WHERE r.user_id=? AND w.stage='review'",user);
   const pending=new Set(queued.map(row=>row.receipt));
   const eligible=active.filter(row=>!pending.has(row.id));
   let total=0n;
   for(let i=0;i<eligible.length;i+=8){
    const states=await Promise.all(eligible.slice(i,i+8).map(row=>net.state(row)));
    for(const state of states)if(state.stage==='active')total+=BigInt(state.available);
   }
   return json({available:String(total)});
  }
  if(route==='portfolio'&&req.method==='GET'){
   const rows=await all('SELECT * FROM receipts WHERE user_id=? ORDER BY created DESC',user);
   const ws=await all('SELECT w.* FROM withdrawals w JOIN receipts r ON r.id=w.receipt WHERE r.user_id=? ORDER BY w.created DESC',user);
   return json({receipts:rows,withdrawals:ws,fundedReferrals:await fundedReferrals()});
  }
  check(req.method==='POST','Use POST for this request.',405);
  check(req.headers.get('origin')===url.origin&&req.headers.get('content-type')?.includes('application/json'),'Invalid request origin.',403);
  const raw=await req.text();check(raw.length<5000,'Request too large.',413);const body=JSON.parse(raw);
  check(enabled,'Direct deposits open after the operator connects the cashier and funds the vault.',503);
  const now=Math.floor(Date.now()/1000);
  async function isCashier(vault=cfg.vaultAddress){
   const stamp=Number(body.timestamp);check(Number.isSafeInteger(stamp)&&Math.abs(stamp-now)<300,'Cashier authorisation expired.',403);
   const msg='12x12 cashier review\n'+url.origin+'\n'+stamp;
   let signer;try{signer=verifyMessage(msg,body.signature);}catch{}
   check(signer&&same(signer,await net.owner(vault)),'Only the vault owner can review the cashier queue.',403);
  }
  if(route==='queue'){
   await isCashier();
   const receipts=await all("SELECT * FROM receipts WHERE vault=? COLLATE NOCASE AND stage IN ('review','refund-requested','created') ORDER BY CASE stage WHEN 'created' THEN 1 ELSE 0 END, created DESC LIMIT 100",cfg.vaultAddress);
   const withdrawals=await all("SELECT w.*,r.receiver,r.payout,r.vault,r.factory,r.contract_version,r.plan_id FROM withdrawals w JOIN receipts r ON r.id=w.receipt WHERE r.vault=? COLLATE NOCASE AND w.stage='review' ORDER BY w.created LIMIT 100",cfg.vaultAddress);
   return json({receipts,withdrawals});
  }
  if(route==='eligibility')return json(await eligibility(address(body.payout)));
  if(route==='receipt'){
   const plan_id=body.plan_id??1, tier=tiers.get(plan_id);
   check(tier,'Select a valid investment plan.');
   check(/^\d+(\.\d{1,2})?$/.test(String(body.amount)),'Enter a deposit in dollars and cents.');
   const amount=Math.round(Number(body.amount)*100)*10000;
   check(amount>=tier.min*1e6&&amount<=tier.max*1e6,`Choose a deposit between $${tier.min.toLocaleString('en-US')} and $${tier.max.toLocaleString('en-US')} for this plan.`);
   const payout=address(body.payout),referrer=body.referrer?address(body.referrer):ZeroAddress;
   check(payout!==ZeroAddress&&!same(payout,cfg.vaultAddress)&&!same(payout,cfg.factoryAddress),'Use your personal USDC receiving address.');
   const outstanding=()=>sql("SELECT * FROM receipts WHERE user_id=? AND stage IN ('created','review')",user).first();
   function reply(open){
    check(open&&open.plan_id===plan_id&&open.amount===amount&&same(open.payout,payout)&&same(open.referrer,referrer),'You already have a different pending receipt. Review it in your portfolio before creating another.',409);
    return json(open);
   }
   const open=await outstanding();
   if(open)return reply(open);
   if(tier.required){
    const {fundedReferrals:count}=await eligibility(payout);
    check(count>=tier.required,`This plan needs ${tier.required} distinct funded direct investors. Your account and payout address currently qualify with ${count}.`,409);
   }
   if(referrer!==ZeroAddress){const own=await sql('SELECT id FROM receipts WHERE user_id=? AND receiver=? COLLATE NOCASE',user,referrer).first();check(!own,'Self-referrals are unavailable.');}
   const funded=await sql("SELECT payout FROM receipts WHERE user_id=? AND vault=? COLLATE NOCASE AND stage='active' ORDER BY created,rowid LIMIT 1",user,cfg.vaultAddress).first();
   check(!funded||same(funded.payout,payout),'Use the Base payout address from your first funded receipt for this vault.',409);
   const row={id:opaque(),payout,amount,referrer,plan_id};const receiver=await net.quote(row);
   await sql("INSERT OR IGNORE INTO receipts(id,user_id,payout,amount,referrer,receiver,factory,vault,created,plan_id,contract_version) VALUES(?,?,?,?,?,?,?,?,?,?,5)",row.id,user,payout,amount,referrer,receiver,cfg.factoryAddress,cfg.vaultAddress,now,plan_id).run();
   return reply(await outstanding());
  }
  const row=await sql('SELECT * FROM receipts WHERE id=?',String(body.id||'')).first();
  check(row,'Receipt not found.',404);
  if(row.user_id!==user){
   check(route==='sync','Only the receipt owner can submit or change a request.',403);
   await isCashier(row.vault);
  }
  if(route==='refund-request'){
   check(['created','review','archived','refunded'].includes(row.stage),'This receipt has already activated.',409);
   await sql("UPDATE receipts SET stage='refund-requested' WHERE id=? AND stage=?",row.id,row.stage).run();
   return json({stage:'refund-requested'});
  }
  if(route==='archive'){
   check(row.stage==='created','Only an unused receipt can be archived.',409);
   await sql("UPDATE receipts SET stage='archived' WHERE id=? AND stage='created'",row.id).run();
   return json({stage:'archived'});
  }
  if(route==='proof'){
   const tx=String(body.tx||'').toLowerCase();check(txPattern.test(tx),'Enter a 66-character transaction hash.');
   if(row.tx===tx)return json({stage:row.stage});
   check(row.stage==='created','This receipt already has a transfer.',409);
   await net.proof(row,tx);
   const result=await sql("UPDATE OR IGNORE receipts SET tx=?,stage='review' WHERE id=? AND stage='created'",tx,row.id).run();check(result.meta.changes===1,'This transfer has already been submitted.',409);return json({stage:'review'});
  }
  if(route==='sync'||route==='withdraw'){
   const info=await net.state(row);
   if(info.stage==='active'||info.stage==='refunded')await sql('UPDATE receipts SET stage=? WHERE id=?',info.stage,row.id).run();
   const pending=await sql("SELECT * FROM withdrawals WHERE receipt=? AND stage='review'",row.id).first();
   if(pending&&await net.paid(row,pending))await sql("UPDATE withdrawals SET stage='paid' WHERE id=?",pending.id).run();
   if(route==='withdraw'){
    check(info.stage==='active'&&BigInt(info.available)>0n,'No payout is available for withdrawal yet.',409);
    const destination=row.contract_version>=5?address(body.destination):row.payout;
    check(!body.destination||same(body.destination,destination),'This earlier receipt uses its original withdrawal address.',409);
    check(destination!==ZeroAddress&&![row.receiver,row.vault,row.factory].some(addr=>same(addr,destination)),'Enter a valid personal Base receiving address.');
    const rawAmount=body.amount==null?'':String(body.amount);
    check(!rawAmount||/^\d{1,6}(\.\d{1,6})?$/.test(rawAmount),'Enter a valid USD amount.');
    const amount=rawAmount?parseUnits(rawAmount,6):BigInt(info.available);
    check(amount>0n&&amount<=BigInt(info.available),'The withdrawal exceeds your available balance.',409);
    await sql("INSERT OR IGNORE INTO withdrawals(id,receipt,amount,created,destination) VALUES(?,?,?,?,?)",opaque(),row.id,Number(amount),now,destination).run();
    const queued=await sql("SELECT id,amount,destination,stage FROM withdrawals WHERE receipt=? AND stage='review'",row.id).first();
    check(queued&&queued.amount===Number(amount)&&same(queued.destination||row.payout,destination),'This receipt already has a pending withdrawal.',409);
    return json(queued);
   }
   return json(info);
  }
  return json({error:'Unknown cashier action.'},404);
 }catch(e){return json({error:e.status?e.message:e instanceof SyntaxError?'Invalid request.':'Cashier temporarily unavailable. Please retry.'},e.status|| (e instanceof SyntaxError?400:503));}
}
