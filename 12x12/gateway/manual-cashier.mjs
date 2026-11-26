import {walletAccounts} from './wallet-accounts.mjs';
import {supportTickets} from './support.mjs';
import {assets,normalizeAddress,normalizeTx,parseDecimal,formatDecimal,spotPrice,supportsWithdrawal} from './manual-assets.mjs';
import {check} from './chain.mjs';

const defaults={min_deposit:1200,max_deposit:250000,min_withdraw:1,max_withdraw:250000,withdrawal_fee:0,confirmations:6};
const transitions={
 approve:['deposit','pending','approved'], approveManualDeposit:['deposit','pending','approved'],
 rejectDeposit:['deposit','pending','rejected'],
 process:['withdrawal','pending','processing'], broadcast:['withdrawal','processing','broadcasting'],
 approveWithdrawal:['withdrawal','pending','broadcasting'],
 sent:['withdrawal','broadcasting','sent'], complete:['withdrawal','sent','completed'],
 completeManualWithdrawal:['withdrawal','broadcasting','completed'],
 rejectWithdrawal:['withdrawal','pending','rejected']
};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const id=()=>crypto.randomUUID();
const quoteScale=12;
const identity=/^[a-f0-9-]{36}$/;
const messages=[
 ['wallet referral changed','Your referral was just recorded. Retry the investment.'],
 ['manual account held','This account is on cashier hold.'],
 ['manual insufficient balance','Insufficient available USD balance.'],
 ['manual daily limit','The total deduction exceeds your remaining daily investment-based withdrawal limit.'],
 ['manual option unavailable','This withdrawal option is unavailable.'],
 ['manual quote expired','The quote expired. Get a new withdrawal quote.'],
 ['manual_unique_transfer','This blockchain transfer is already recorded.'],
 ['manual hash already recorded','This transaction hash has already been used on this network.'],
 ['manual approval evidence required','The cashier must record valid transfer evidence before approving.'],
 ['manual_payments.network, manual_payments.tx','This blockchain transfer is already recorded.'],
 ['manual transfer already recorded by vault','This transfer belongs to the existing Base vault.'],
 ['manual invalid transition','This request has already moved to another status.']
];
const publicAsset=(key,[symbol,network,decimals,token,explorer])=>({key,symbol,network,decimals,token,explorer});
const rowDetails=`SELECT p.*,q.asset,q.address,q.crypto,q.rate,q.rate_source,q.expires,q.minimum_confirmations,
 q.created AS quote_created,COALESCE(a.email,a.username) AS username,
 COALESCE(NULLIF(q.minimum_confirmations,0),o.confirmations,6) AS required_confirmations
 FROM manual_payments p JOIN manual_quotes q ON q.id=p.id
 LEFT JOIN login_accounts a ON a.id=p.user_id LEFT JOIN manual_options o ON o.id=q.asset`;
const accountIDs=`SELECT id FROM login_accounts
 UNION SELECT user_id FROM receipts
 UNION SELECT user_id FROM manual_payments
 UNION SELECT user_id FROM manual_quotes`;
function reviewNote(value,max=1000){
 const note=typeof value==='string'?value.trim():'';
 check(note.length>=5&&note.length<=max,'Enter a review note or reason of 5–'+max+' characters.');
 return note;
}
function integer(value,min,max,label){
 check(Number.isSafeInteger(value)&&value>=min&&value<=max,'Enter a valid '+label+'.');
 return value;
}
function verifyEvidence(body,row,now){
 const option=publicAsset(row.asset,assets[row.asset]);
 const {network,token,decimals}=option;
 check(body.success===true,'Confirm that the blockchain transaction succeeded.');
 check(body.network===network,'The verified network differs from the quoted network.');
 const address=normalizeAddress(network,body.address);
 check(address===row.address,'The verified address differs from the quoted address.');
 const observed=parseDecimal(body.crypto,decimals,'received crypto amount');
 check(observed===parseDecimal(row.crypto,decimals,'quoted crypto amount'),'The received amount must match the quote. Investigate mismatched transfers separately.',409);
 if(token)check(normalizeAddress(network,body.token)===normalizeAddress(network,token),'The token contract does not match.');
 const confirmations=integer(body.confirmations,row.required_confirmations,10_000_000,'confirmation count');
 const paidAt=integer(body.paidAt,1,now,'block timestamp');
 return {verification:'manual',network,token,address,crypto:row.crypto,confirmations,paidAt,success:true};
}
function depositDecision({id,status,updated,note,confirmations,transfer_index}){
 return json({id,status,updated,note,confirmations,transfer_index});
}
function transferIndex(row,value){
 const [,network,,token]=assets[row.asset];
 // Review native EVM, TRX and XRP payments by transaction ID.
 if(['ethereum','base','bsc','tron','xrpl'].includes(network)&&!token)return -1;
 return integer(value,0,100_000_000,'transfer/output index');
}

export async function manualCashier(req,env,user,{price=spotPrice,clock=()=>Math.floor(Date.now()/1000)}={}){
 try{
  check(user,'Log in to open your cashier.',401);
  const url=new URL(req.url), route=url.pathname.slice('/api/manual/'.length), now=clock();
  const admin=(env.APEX_CASHIER_ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(user);
  if(route.startsWith('admin/'))check(admin,'Cashier administrator access required.',403);
  const db=env.DB;
  const sql=(statement,...args)=>db.prepare(statement).bind(...args);
  const read=(statement,...args)=>sql(statement,...args).first();
  const all=async(statement,...args)=>(await sql(statement,...args).all()).results;
  const run=(statement,...args)=>sql(statement,...args).run();
  const supportRoute=route.replace(/^admin\//,'');
  const adminSupport=route.startsWith('admin/support/');
  const support=supportRoute.startsWith('support/')?supportTickets({read,all,run,user,admin,now}):null;
  const wallet=walletAccounts({read,all,run,user,now,separate:env.settings?.separatePrincipal!==false});
  const rowFor=(request,userID)=>read(rowDetails+' WHERE p.id=? AND p.user_id=?',request,userID);
  const account=accountId=>read(`WITH ids AS (${accountIDs})
   SELECT ids.id, COALESCE(a.email,a.username) AS username, COALESCE(c.held,0) AS held, c.note, c.updated,
    COALESCE((SELECT SUM(delta) FROM wallet_cash_journal WHERE user_id=ids.id),0) AS balance,
    COALESCE((SELECT SUM(amount) FROM wallet_invested_principal WHERE user_id=ids.id),0) AS principal,
    COALESCE((SELECT SUM(amount+fee) FROM manual_payments WHERE user_id=ids.id AND kind='withdrawal'
     AND status IN ('pending','processing','broadcasting','sent')),0) AS reserved
   FROM ids LEFT JOIN login_accounts a ON a.id=ids.id
   LEFT JOIN manual_account_controls c ON c.user_id=ids.id WHERE ids.id=?`,accountId);

  if(req.method==='GET'){
   if(supportRoute==='support/tickets')return json(await support.list(url.searchParams.get('offset'),adminSupport));
   if(supportRoute==='support/thread')return json(await support.thread(url.searchParams.get('id'),adminSupport));
   if(route==='profile')return json(await wallet.profile());
   if(route==='affiliate')return json(await wallet.affiliateDashboard());
   if(route==='profile/history')return json(await wallet.history(url.searchParams.get('offset')));
   if(route==='invest')return json({...await wallet.access(),admin});
   if(route==='admin/reward-reserve')return json(await wallet.reserveStatus());
   if(route==='me')return json({userId:user,admin});
   if(route==='options'||route==='admin/options'){
    const rows=await all('SELECT * FROM manual_options');
    const options=Object.entries(assets).map(([key,asset])=>{
     const {address,actor,updated,...config}=rows.find(row=>row.id===key)||{...defaults,enabled:0,address:''};
     const enabled=Boolean(config.enabled&&address);
     const option={...publicAsset(key,asset),...config,enabled,deposit_enabled:enabled,withdrawal_enabled:enabled&&supportsWithdrawal(asset[1])};
     return admin&&route==='admin/options'?{...option,address}:option;
    });
    const {daily_bps}=await read('SELECT daily_bps FROM manual_policy WHERE id=1');
    return json({options,daily_bps});
   }
   if(route==='wallet'){
    const totals=await read(`SELECT
     (SELECT COALESCE(SUM(delta),0) FROM wallet_cash_journal WHERE user_id=?) AS balance,
     (SELECT COALESCE(SUM(amount),0) FROM wallet_invested_principal WHERE user_id=?) AS invested,
     (SELECT COALESCE(SUM(amount+fee),0) FROM manual_payments WHERE user_id=? AND kind='withdrawal'
      AND status NOT IN ('rejected','cancelled') AND created>=?) AS daily_used,
     (SELECT daily_bps FROM manual_policy WHERE id=1) AS daily_bps`,user,user,user,Math.floor(now/86400)*86400);
    const remaining=BigInt(totals.invested)*BigInt(totals.daily_bps)/100000000n-BigInt(totals.daily_used);
    const hold=await read('SELECT held FROM manual_account_controls WHERE user_id=?',user);
    return json({held:Boolean(hold?.held),balance:totals.balance,daily_remaining:Number(remaining>0n?remaining:0n),daily_bps:totals.daily_bps});
   }
   if(route==='history'){
    const kind=url.searchParams.get('kind');
    const before=Number(url.searchParams.get('before')||0);
    check(kind==='deposit'||kind==='withdrawal','Choose a request type.');
    const cursor=url.searchParams.get('cursor')||'';
    const rows=await all(rowDetails+` WHERE p.user_id=? AND p.kind=?
      AND (?=0 OR p.created<? OR (p.created=? AND p.id<?)) ORDER BY p.created DESC,p.id DESC LIMIT 50`,user,kind,before,before,before,cursor);
    return json({rows:rows.map(({actor,evidence,...row})=>row)});
   }
   if(route==='admin/queue'){
    const kind=url.searchParams.get('kind');
    const status=url.searchParams.get('status')||'open';
    check(kind==='deposit'||kind==='withdrawal','Choose a queue.');
    const states=kind==='deposit'?['pending','approved','rejected']:['pending','processing','broadcasting','sent','completed','rejected','cancelled'];
    check(['open','closed','all',...states].includes(status),'Choose a queue status.');
    const network=(url.searchParams.get('network')||'').trim();
    check(!network||Object.values(assets).some(asset=>asset[1]===network),'Choose a supported network.');
    const search=(url.searchParams.get('q')||'').trim().slice(0,120).toLowerCase();
    const cursor=Number(url.searchParams.get('before')||0);
    const last=url.searchParams.get('cursor')||'';
    check(Number.isSafeInteger(cursor)&&cursor>=0,'Invalid queue cursor.');
    const rows=await all(rowDetails+` WHERE p.kind=?
     AND CASE ? WHEN 'all' THEN 1
      WHEN 'open' THEN p.status IN ('pending','processing','broadcasting','sent')
      WHEN 'closed' THEN p.status NOT IN ('pending','processing','broadcasting','sent')
      ELSE p.status=? END
     AND (?='' OR p.network=?)
     AND (?='' OR instr(lower(COALESCE(a.email,'')),?)>0 OR instr(lower(COALESCE(a.username,'')),?)>0
       OR instr(lower(p.id),?)>0 OR instr(lower(COALESCE(p.tx,'')),?)>0)
     AND (?=0 OR p.created<? OR (p.created=? AND p.id<?)) ORDER BY p.created DESC,p.id DESC LIMIT 50`,
     kind,status,status,network,network,search,search,search,search,search,cursor,cursor,cursor,last);
    return json({rows});
   }
   if(route==='admin/users'){
    const search=(url.searchParams.get('q')||'').trim().slice(0,120);
    const after=(url.searchParams.get('after')||'').slice(0,180);
    const rows=await all(`WITH ids AS (${accountIDs})
     SELECT ids.id,COALESCE(a.email,a.username) AS username,COALESCE(c.held,0) AS held,
      COALESCE((SELECT SUM(delta) FROM wallet_cash_journal WHERE user_id=ids.id),0) AS balance
     FROM ids LEFT JOIN login_accounts a ON a.id=ids.id
     LEFT JOIN manual_account_controls c ON c.user_id=ids.id
     WHERE ids.id>? AND (?='' OR instr(lower(ids.id),lower(?))>0 OR instr(lower(COALESCE(a.email,'')),lower(?))>0 OR instr(lower(COALESCE(a.username,'')),lower(?))>0)
     ORDER BY ids.id LIMIT 50`,after,search,search,search,search);
    return json({rows});
   }
   if(route==='admin/user'){
    const accountId=url.searchParams.get('id');
    const record=await account(accountId);
    check(record,'Cashier user not found.',404);
    const [requests,receipts,legacyWithdrawals,ledger]=await Promise.all([
     all(rowDetails+' WHERE p.user_id=? ORDER BY p.created DESC,p.id DESC LIMIT 50',accountId),
     all('SELECT id,plan_id,amount,stage,tx,payout,created FROM receipts WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 50',accountId),
     all('SELECT w.id,w.receipt,w.amount,w.stage,w.created,COALESCE(w.destination,r.payout) AS destination FROM withdrawals w JOIN receipts r ON r.id=w.receipt WHERE r.user_id=? ORDER BY w.created DESC,w.id DESC LIMIT 50',accountId),
     all('SELECT request_id,event,delta,created FROM wallet_cash_journal WHERE user_id=? ORDER BY created DESC,request_id DESC LIMIT 50',accountId)
    ]);
    return json({account:record,requests,receipts,legacyWithdrawals,ledger});
   }
   if(route==='admin/audit'){
    const request=url.searchParams.get('id');
    return json({rows:await all('SELECT * FROM manual_audit WHERE request_id=? ORDER BY seq',request)});
   }
   return json({error:'Unknown cashier page.'},404);
  }
  check(req.method==='POST','Use POST for this action.',405);
  check(req.headers.get('origin')===url.origin&&req.headers.get('content-type')?.split(';')[0]==='application/json','Invalid request origin.',403);
  const raw=await req.text();
  check(raw.length<6500,'Request too large.',413);
  const body=JSON.parse(raw);
  check(body&&typeof body==='object'&&!Array.isArray(body),'Invalid request.');
  if(!admin||!route.startsWith('admin/')){
   const limit=await read(`INSERT INTO manual_limits VALUES(?,?,1)
     ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN period=excluded.period THEN attempts+1 ELSE 1 END,period=excluded.period RETURNING attempts`,
    user+':'+route,Math.floor(now/60));
   check(limit.attempts<=12,'Too many requests. Try again in a minute.',429);
  }
  if(route==='support/create')return json(await support.create(body));
  if(supportRoute==='support/reply')return json(await support.reply(body,adminSupport));
  if(route==='profile')return json(await wallet.rename(body.name));
  if(route==='invest')return json(await wallet.invest(body));
  if(route==='admin/reward-reserve')return json(await wallet.fund(body));
  if(route==='admin/receiving-addresses'){
   const {addresses}=body;
   check(addresses&&typeof addresses==='object'&&!Array.isArray(addresses),'Choose a receiving-address file.');
   const entries=Object.entries(addresses);
   check(entries.length>0&&entries.length<=Object.keys(assets).length,'Choose a file with supported payment options.');
   const verified=entries.map(([asset,address])=>{
    check(Object.hasOwn(assets,asset),'Unsupported payment asset in the receiving-address file.');
    return {asset,address:normalizeAddress(assets[asset][1],address)};
   });
   const {meta}=await run(`INSERT INTO manual_options
    (id,address,enabled,min_deposit,max_deposit,min_withdraw,max_withdraw,withdrawal_fee,confirmations,actor,updated)
    SELECT json_extract(value,'$.asset'),json_extract(value,'$.address'),1,?,?,?,?,?,?,?,?
    FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET address=excluded.address,enabled=1,actor=excluded.actor,updated=excluded.updated
    WHERE manual_options.address<>excluded.address OR manual_options.enabled<>1`,
    defaults.min_deposit,defaults.max_deposit,defaults.min_withdraw,defaults.max_withdraw,
    defaults.withdrawal_fee,defaults.confirmations,user,now,JSON.stringify(verified));
   return json({active:verified.length,updated:meta.changes});
  }
  if(route==='admin/options'){
   const {asset}=body;
   check(Object.hasOwn(assets,asset),'Unsupported payment asset.');
   const address=body.address?normalizeAddress(assets[asset][1],body.address):'';
   check(typeof body.enabled==='boolean'&&(!body.enabled||address),'Enter a verified receiving address before enabling payments.');
   const minD=integer(body.min_deposit,1,100_000_000,'minimum deposit');
   const maxD=integer(body.max_deposit,minD,100_000_000,'maximum deposit');
   const minW=integer(body.min_withdraw,1,100_000_000,'minimum withdrawal');
   const maxW=integer(body.max_withdraw,minW,100_000_000,'maximum withdrawal');
   const fee=integer(body.withdrawal_fee,0,100_000_000,'withdrawal fee');
   const confirmations=integer(body.confirmations,1,100_000,'required confirmations');
   await run(`INSERT INTO manual_options VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET address=excluded.address,enabled=excluded.enabled,
    min_deposit=excluded.min_deposit,max_deposit=excluded.max_deposit,min_withdraw=excluded.min_withdraw,
    max_withdraw=excluded.max_withdraw,withdrawal_fee=excluded.withdrawal_fee,confirmations=excluded.confirmations,actor=excluded.actor,updated=excluded.updated`,
    asset,address,Number(body.enabled),minD,maxD,minW,maxW,fee,confirmations,user,now);
   return json({saved:true});
  }
  if(route==='admin/policy'){
   const bps=integer(body.daily_bps,0,10000,'daily cap in basis points');
   await run('UPDATE manual_policy SET daily_bps=?,actor=?,updated=? WHERE id=1',bps,user,now);
   return json({saved:true});
  }
  if(route==='admin/user-control'){
   const {id:accountId,held}=body;
   check(typeof held==='boolean','Choose whether the cashier is on hold.');
   const record=await account(accountId);
   check(record,'Cashier user not found.',404);
   const note=reviewNote(body.note);
   await run(`INSERT INTO manual_account_controls VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET held=excluded.held,note=excluded.note,actor=excluded.actor,updated=excluded.updated
    WHERE manual_account_controls.held<>excluded.held`,accountId,Number(held),note,user,now);
   return json({id:accountId,held});
  }
  if(route==='quote'){
   const hold=await read('SELECT held FROM manual_account_controls WHERE user_id=?',user);
   check(!hold?.held,'This account is on cashier hold. Contact the cashier administrator.',409);
   const {asset,kind}=body;
   check(Object.hasOwn(assets,asset),'Unsupported payment asset.');
   check(kind==='deposit'||kind==='withdrawal','Choose a valid request type.');
   const option=publicAsset(asset,assets[asset]);
   const deposit=kind==='deposit';
   check(deposit||supportsWithdrawal(option.network),'This network supports deposits only.',409);
   const config=await read('SELECT * FROM manual_options WHERE id=? AND enabled=1',asset);
   check(config?.address,'This payment option is unavailable.',409);
   const amount=parseDecimal(body.amount,2,'USD amount');
   const [min,max]=deposit?[config.min_deposit,config.max_deposit]:[config.min_withdraw,config.max_withdraw];
   check(amount>=BigInt(min)&&amount<=BigInt(max),'Enter an amount within the advertised limits.');
   const address=deposit?config.address:normalizeAddress(option.network,body.address);
   check(deposit||address!==config.address,'Enter your own receiving address.');
   const {rate,source:rate_source}=await price(option.symbol);
   const numerator=amount*10n**BigInt(quoteScale+option.decimals-2);
   const denominator=parseDecimal(rate,quoteScale,'market USD rate');
   check(denominator>0n,'The exchange rate is unavailable.',503);
   const cryptoUnits=deposit?(numerator+denominator-1n)/denominator:numerator/denominator;
   check(cryptoUnits>0n,'The quoted crypto amount is below the network minimum.');
   if(deposit)check(cryptoUnits*denominator/10n**BigInt(quoteScale+option.decimals-2)===amount,'The amount cannot be quoted exactly at this precision.');
   const quote={id:id(),asset,kind,address,amount:Number(amount),fee:deposit?0:config.withdrawal_fee,
    crypto:formatDecimal(cryptoUnits,option.decimals),rate,rate_source,created:now,expires:now+600,minimum_confirmations:config.confirmations,network:option.network};
   await run('INSERT INTO manual_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',quote.id,user,kind,asset,quote.network,address,quote.amount,quote.fee,quote.crypto,rate,rate_source,quote.minimum_confirmations,now,quote.expires);
   return json({...quote,option});
  }
  if(route==='submit'){
   check(typeof body.id==='string'&&identity.test(body.id),'Enter a valid quote ID.');
   const quote=await read('SELECT * FROM manual_quotes WHERE id=? AND user_id=?',body.id,user);
   check(quote,'Quote not found.',404);
   const tx=quote.kind==='deposit'?normalizeTx(quote.network,body.tx):null;
   const existing=await rowFor(quote.id,user);
   if(existing){
    check(existing.kind==='withdrawal'||existing.tx===tx,'This quote already has a different transaction.',409);
    return json({id:existing.id,status:existing.status});
   }
   // The quote ID is the idempotency key. The trigger and reservation run in the same write.
   await run(`INSERT INTO manual_payments(id,user_id,kind,status,network,amount,fee,created,updated,actor,tx)
     SELECT ?,?,?,'pending',?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM manual_payments WHERE id=?)`,
    quote.id,user,quote.kind,quote.network,quote.amount,quote.fee,now,now,user,tx,quote.id);
   const saved=await rowFor(quote.id,user);
   check(saved&&(saved.kind==='withdrawal'||saved.tx===tx),'This quote already has a different transaction.',409);
   return json({id:saved.id,status:saved.status});
  }
  if(route==='cancel'){
   const row=await rowFor(body.id,user);
   check(row?.kind==='withdrawal','Withdrawal not found.',404);
   if(row.status==='cancelled')return json({id:row.id,status:row.status});
   const changed=await run("UPDATE manual_payments SET status='cancelled',updated=?,actor=?,note='Cancelled by investor' WHERE id=? AND status='pending'",now,user,row.id);
   check(changed.meta.changes===1||(await rowFor(row.id,user)).status==='cancelled','Only a pending withdrawal can be cancelled.',409);
   return json({id:row.id,status:'cancelled'});
  }
  if(route==='admin/review'){
   const row=await read(rowDetails+' WHERE p.id=?',body.id);
   check(row,'Request not found.',404);
   const action=body.action;
   if(action==='reconcile'){
    check(row.kind==='withdrawal'&&['broadcasting','sent'].includes(row.status),'This payout is outside reconciliation.',409);
    const note=reviewNote(body.note);
    await run('INSERT INTO manual_audit(request_id,actor,event,created,detail) VALUES(?,?,?,?,?)',row.id,user,'reconciliation',now,JSON.stringify({note}));
    return json({id:row.id,status:row.status});
   }
   check(Object.hasOwn(transitions,action),'Unknown review action.');
   const [kind,from,to]=transitions[action];
   const locking=action==='broadcast'||action==='approveWithdrawal';
   check(row.kind===kind,'This action does not apply to the request.',409);
   const depositReview=kind==='deposit';
   if(depositReview&&row.status===to)return depositDecision(row);
   const note=action==='approveManualDeposit'?'Cashier confirmed receipt of the quoted amount.':
    action==='completeManualWithdrawal'?'Cashier recorded the payout sent.':reviewNote(body.note);
   let tx=row.tx,index=row.transfer_index,evidence=null,confirmations=row.confirmations,credit=row.credit;
   if(action==='sent'){
    tx=normalizeTx(row.network,body.tx);
    index=transferIndex(row,body.index);
   }
   const expected=(action==='rejectWithdrawal'||action==='approveWithdrawal')&&row.status==='processing'?'processing':
    action==='completeManualWithdrawal'&&row.status==='sent'?'sent':from;
   check(row.status===expected||row.status===to,'This request has already moved to another status.',409);
   if(action==='approveManualDeposit'){
    evidence={verification:'cashier',decision:'received'};
    index=null;
    confirmations=null;
    credit=row.amount;
   }
   if(action==='completeManualWithdrawal'){
    if(row.status==='broadcasting'||body.tx!==undefined)tx=normalizeTx(row.network,body.tx);
    check(tx&&(!row.tx||row.tx===tx),'The payout transaction ID differs from the one already recorded.',409);
    evidence={verification:'cashier',decision:'sent'};
    confirmations=null;
   }
   if(action==='approve'){
    evidence=verifyEvidence(body,row,now);
    check(body.ownershipVerified===true,'Confirm that the depositor sent this transfer.');
    check(evidence.paidAt>=row.quote_created&&evidence.paidAt<=row.expires,
     'Payment is outside the quote window. Reconcile the transfer before crediting it.',409);
    evidence.ownershipVerified=true;
    index=transferIndex(row,body.index);
    confirmations=evidence.confirmations;
    credit=row.amount;
   }
   if(action==='complete'){
    const lock=await read("SELECT created FROM manual_audit WHERE request_id=? AND event='broadcasting' ORDER BY seq DESC LIMIT 1",row.id);
    check(lock&&body.paidAt>=lock.created,'The payout block time predates the broadcast lock.',409);
    evidence=verifyEvidence(body,row,now);
    confirmations=evidence.confirmations;
   }
   if(row.status===to){
    if(locking)return json({id:row.id,status:row.status,alreadyLocked:true});
    check(row.tx===tx&&row.transfer_index===index,'The request already has different transfer details.',409);
    return json({id:row.id,status:row.status});
   }
   const changed=await run(`UPDATE manual_payments SET status=?,updated=?,actor=?,tx=?,transfer_index=?,confirmations=?,credit=?,evidence=?,note=?
    WHERE id=? AND status=?`,to,now,user,tx,index,confirmations,credit,evidence?JSON.stringify(evidence):null,note,row.id,expected);
   if(changed.meta.changes!==1){
    const latest=await read('SELECT id,status,tx,transfer_index,updated,note,confirmations FROM manual_payments WHERE id=?',row.id);
    if(locking&&latest?.status===to)return json({id:row.id,status:to,alreadyLocked:true});
    check(latest?.status===to&&latest.tx===tx&&latest.transfer_index===index,'This request has already moved to another status.',409);
    if(depositReview)return depositDecision(latest);
   }
   if(depositReview)return depositDecision({id:row.id,status:to,updated:now,note,confirmations,transfer_index:index});
   return json({id:row.id,status:to});
  }
  return json({error:'Unknown cashier action.'},404);
 }catch(error){
  const message=messages.find(([key])=>String(error.message).includes(key))?.[1];
  if(message)return json({error:message},409);
  return json({error:error.status?error.message:error instanceof SyntaxError?'Invalid request.':'Cashier temporarily unavailable. Open history before retrying.'},
   error.status||(error instanceof SyntaxError?400:503));
 }
}
