import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Wallet} from 'ethers';
import {localDB} from '../gateway/local-db.mjs';
import {manualCashier} from '../gateway/manual-cashier.mjs';

const admin='admin',investor='investor',other='other';
const address=Wallet.createRandom().address;
const destination=Wallet.createRandom().address;
const hash=byte=>'0x'+byte.repeat(64);
function setup({controlDbTime=false}={}){
 let now=1_795_500_000;
 const sqlite=controlDbTime?new DatabaseSync(':memory:'):null;
 if(sqlite){
  sqlite.function('unixepoch',()=>now);
  for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort()){
   sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  }
 }
 const DB=sqlite?{prepare(sql){
  const statement=sqlite.prepare(sql);
  return {bind(...args){return {first:()=>statement.get(...args),all:()=>({results:statement.all(...args)}),
   run:()=>({meta:{changes:statement.run(...args).changes}})};}};
 }}:localDB(':memory:');
 const env={DB,APEX_CASHIER_ADMIN_IDS:admin};
 let interrupted;
 env.DB={prepare(statement){
  const st=DB.prepare(statement);
  return {bind(...args){
   const bound=st.bind(...args);
   return {...bound,run(){
    const result=bound.run();
    if(interrupted&&statement.includes(interrupted)){interrupted=undefined;throw Error('Injected lost write response');}
    return result;
   }};
  }};
 }};
 const options={price:async()=>({rate:'1.00',source:'Coinbase'}),clock:()=>now};
 const raw=(sql,...args)=>DB.prepare(sql).bind(...args);
 const call=async(route,body,user=investor,origin='https://apex.example')=>{
  const response=await manualCashier(new Request('https://apex.example/api/manual/'+route,{
   method:body?'POST':'GET',headers:{origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined
  }),env,user,options);
  return {code:response.status,...await response.json()};
 };
 const settings={asset:'usdc-ethereum',enabled:true,address,min_deposit:1200,max_deposit:250000,
  min_withdraw:1,max_withdraw:250000,withdrawal_fee:25,confirmations:3};
 const configure=()=>call('admin/options',settings,admin);
 const quote=(kind='deposit',amount='100',user=investor)=>call('quote',{asset:settings.asset,kind,amount,address:destination},user);
 const fundBasis=()=>{
  raw(`INSERT INTO receipts(id,user_id,payout,amount,referrer,receiver,factory,vault,created,stage)
   VALUES('basis',?, ?,100000000,'ref','rx','factory','vault',?,'active')`,investor,destination,now).run();
 };
 const attest=(quote,kwargs={})=>({success:true,ownershipVerified:true,network:quote.network,address:quote.address,crypto:quote.crypto,
  token:quote.option.token,confirmations:4,paidAt:now,index:3,note:'Verified transfer in explorer',...kwargs});
 const approve=(quote,kwargs={})=>call('admin/review',{id:quote.id,action:'approve',...attest(quote,kwargs)},admin);
 const deposit=async(amount='100',tx=hash('1'),user=investor)=>{
  const q=await quote('deposit',amount,user);assert.equal(q.code,200);
  const r=await call('submit',{id:q.id,tx},user);assert.equal(r.code,200);
  return q;
 };
 const review=(id,action,fields={})=>call('admin/review',{id,action,note:'Recorded cashier review',...fields},admin);
 const events=()=>raw('SELECT event, COUNT(*) AS n FROM manual_ledger GROUP BY event ORDER BY event').all().results;
 return {call,configure,quote,deposit,approve,fundBasis,review,events,raw,attest,
  loseResponse:(statement='INSERT INTO manual_payments')=>{interrupted=statement;},tick:seconds=>now+=seconds};
}

test('manual deposit approval requires transfer evidence and credits exactly once',async()=>{
 const t=setup();
 assert.equal((await t.quote()).code,409);
 assert.equal((await t.call('admin/options',null,null)).code,401);
 assert.equal((await t.call('admin/options')).code,403);
 assert.equal((await t.configure()).code,200);
 assert.equal((await t.call('options')).options.some(x=>Object.hasOwn(x,'address')),false);
 assert.equal((await t.quote('deposit','11.99')).code,400);
 const one=await t.deposit();
 const action={id:one.id,action:'approve',amount:999999,confirmations:999,index:99};
 assert.equal(one.minimum_confirmations,3);
 assert.equal((await t.call('wallet')).balance,0);
 assert.equal((await t.call('history?kind=deposit',null,other)).rows.length,0);
 assert.equal((await t.call('admin/review',action,other)).code,403);
 assert.equal((await t.call('admin/review',action,admin,'https://outside.example')).code,403);
 assert.equal((await t.call('admin/review',action,admin)).code,400);
 assert.equal((await t.approve(one,{crypto:'99'})).code,409);
 assert.equal((await t.approve(one,{network:'base'})).code,400);
 assert.equal((await t.approve(one,{address:destination})).code,400);
 assert.equal((await t.approve(one,{token:destination})).code,400);
 assert.equal((await t.approve(one,{ownershipVerified:false})).code,400);
 assert.equal((await t.approve(one,{confirmations:2})).code,400);
 assert.throws(()=>t.raw("UPDATE manual_payments SET status='approved',transfer_index=3,confirmations=4,credit=amount WHERE id=?",one.id).run(),/manual approval evidence required/);

 const [first,retry]=await Promise.all([t.approve(one,{amount:999999}),t.approve(one)]);
 assert.deepEqual(retry,first);
 assert.equal(first.code,200);
 assert.equal(first.status,'approved');
 assert.equal(first.confirmations,4);
 assert.equal(first.transfer_index,3);
 assert.equal(first.note,'Verified transfer in explorer');
 assert.equal((await t.call('wallet')).balance,10000);

 const replay=await t.deposit('100',hash('1'),other);
 assert.match((await t.approve(replay)).error,/already recorded/i);
 assert.equal((await t.call('wallet',null,other)).balance,0);
 assert.equal(t.raw('SELECT COUNT(*) AS total FROM confirmed_cashier_activity').first().total,1);
 const audit=await t.call('admin/audit?id='+one.id,null,admin);
 assert.equal(audit.rows.length,2);
 assert.equal(audit.rows[1].actor,admin);
 const payment=(await t.call('profile/history')).rows.find(row=>row.id===one.id);
 assert.deepEqual(payment.timeline,audit.rows.map(({event,created})=>({event,created})));
 assert.ok(payment.timeline.every(step=>!('actor' in step)&&!('detail' in step)));
 assert.ok(!(await t.call('profile/history',null,other)).rows.some(row=>row.id===one.id));
 assert.deepEqual(JSON.parse(audit.rows[1].detail).evidence,{
  verification:'manual',network:one.network,address:one.address,token:one.option.token,crypto:one.crypto,confirmations:4,
  paidAt:one.created,success:true,ownershipVerified:true
 });
 assert.equal((await t.call('admin/audit?id='+one.id)).code,403);
 assert.throws(()=>t.raw('UPDATE manual_ledger SET delta=0').run(),/immutable ledger/);
 assert.throws(()=>t.raw('DELETE FROM manual_audit').run(),/immutable audit/);
});

test('receiving addresses import atomically with admin permissions and preserve configured limits',async()=>{
 const t=setup();await t.configure();
 const xrp='rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
 const addresses={'usdc-ethereum':destination,'bnb-bsc':address,xrp};
 const importAddresses=(values,user=admin,origin)=>t.call('admin/receiving-addresses',{addresses:values},user,origin);
 assert.equal((await importAddresses(addresses,investor)).code,403);
 assert.equal((await importAddresses(addresses,admin,'https://other.example')).code,403);
 assert.equal((await importAddresses({...addresses,xrp:xrp.slice(0,-1)+'r'})).code,400);
 assert.equal(t.raw('SELECT COUNT(*) AS n FROM manual_options').first().n,1);
 assert.equal(t.raw('SELECT address FROM manual_options WHERE id=?','usdc-ethereum').first().address,address);
 const original=await t.quote();
 assert.equal(original.code,200);
 assert.deepEqual(await importAddresses(addresses),{code:200,active:3,updated:3});
 assert.deepEqual(await importAddresses(addresses),{code:200,active:3,updated:0});
 assert.equal(t.raw('SELECT address FROM manual_quotes WHERE id=?',original.id).first().address,address);
 const settings=(await t.call('admin/options',null,admin)).options;
 assert.equal(settings.find(x=>x.key==='usdc-ethereum').withdrawal_fee,25);
 assert.equal(settings.find(x=>x.key==='usdc-ethereum').address,destination);
 assert.equal(settings.find(x=>x.key==='bnb-bsc').network,'bsc');
 assert.equal(settings.find(x=>x.key==='xrp').withdrawal_enabled,false);
 const xrpQuote=await t.call('quote',{asset:'xrp',kind:'deposit',amount:'12'});
 assert.equal(xrpQuote.address,xrp);
 assert.equal((await t.call('quote',{asset:'xrp',kind:'withdrawal',amount:'12',address:xrp})).code,409);
 const bnbQuote=await t.call('quote',{asset:'bnb-bsc',kind:'deposit',amount:'12'});
 assert.equal(bnbQuote.address,address);
 for(const [q,tx] of [[xrpQuote,'ab'.repeat(32)],[bnbQuote,hash('b')]]){
  assert.equal((await t.call('submit',{id:q.id,tx})).code,200);
  assert.equal((await t.approve(q,{confirmations:6,index:undefined})).transfer_index,-1);
 }
 assert.equal((await t.call('wallet')).balance,2400);
});

test('one-click cashier decisions record a single deposit credit without confirmation evidence',async()=>{
 const t=setup();await t.configure();
 const q=await t.deposit();
 const request={id:q.id,action:'approveManualDeposit'};
 assert.equal((await t.call('admin/review',request,other)).code,403);
 assert.throws(()=>t.raw("UPDATE manual_payments SET status='approved',credit=amount WHERE id=?",q.id).run(),/manual approval evidence required/);
 t.loseResponse('UPDATE manual_payments SET status=');
 assert.equal((await t.call('admin/review',request,admin)).code,503);
 const approved=await t.call('admin/review',request,admin);
 assert.equal(approved.status,'approved');
 assert.equal(approved.confirmations,null);
 assert.equal(approved.transfer_index,null);
 assert.deepEqual(await t.call('admin/review',request,admin),approved);
 assert.equal((await t.review(q.id,'rejectDeposit')).code,409);
 assert.equal((await t.call('wallet')).balance,10000);
 const audit=(await t.call('admin/audit?id='+q.id,null,admin)).rows;
 assert.deepEqual(JSON.parse(audit.at(-1).detail).evidence,{verification:'cashier',decision:'received'});
 const repeat=await t.deposit('200',hash('1'),other);
 assert.equal((await t.review(repeat.id,'approveManualDeposit')).code,409);
 assert.equal((await t.approve(repeat,{index:7})).code,409);
 assert.equal((await t.call('wallet',null,other)).balance,0);
 const pending=await t.deposit('100',hash('5'));
 const results=await Promise.all([t.review(pending.id,'approveManualDeposit'),t.review(pending.id,'rejectDeposit')]);
 assert.deepEqual(results.map(result=>result.code).sort(),[200,409]);
});

test('cashier records an external payout using only its ID and cannot approve or refund it twice',async()=>{
 const t=setup();await t.configure();t.fundBasis();
 await t.review((await t.deposit()).id,'approveManualDeposit');
 const q=await t.quote('withdrawal','5');
 await t.call('submit',{id:q.id});
 const request={id:q.id,action:'completeManualWithdrawal',tx:hash('2')};
 const complete=()=>t.call('admin/review',request,admin);
 assert.equal((await complete()).code,409);
 assert.equal((await t.review(q.id,'approveWithdrawal')).status,'broadcasting');
 assert.equal((await t.review(q.id,'completeManualWithdrawal')).code,400);
 assert.equal((await t.review(q.id,'completeManualWithdrawal',{tx:hash('1')})).code,409);
 assert.throws(()=>t.raw("UPDATE manual_payments SET status='completed',tx=?,transfer_index=1,confirmations=8 WHERE id=?",hash('2'),q.id).run(),
  /manual invalid transition/);
 assert.equal((await t.call('cancel',{id:q.id})).code,409);
 assert.equal((await t.review(q.id,'rejectWithdrawal')).code,409);
 t.loseResponse('UPDATE manual_payments SET status=');
 assert.equal((await complete()).code,503);
 assert.equal((await complete()).status,'completed');
 assert.equal((await t.review(q.id,'completeManualWithdrawal',{tx:hash('3')})).code,409);
 const audit=(await t.call('admin/audit?id='+q.id,null,admin)).rows;
 assert.deepEqual(audit.map(row=>row.event),['submitted','broadcasting','completed']);
 assert.deepEqual(JSON.parse(audit.at(-1).detail).evidence,{verification:'cashier',decision:'sent'});
 assert.equal((await t.call('wallet')).balance,9475);
 const second=await t.quote('withdrawal','5');
 await t.call('submit',{id:second.id});
 await t.review(second.id,'approveWithdrawal');
 assert.equal((await t.review(second.id,'completeManualWithdrawal',{tx:hash('2')})).code,409);
 await t.review(second.id,'sent',{tx:hash('3'),index:5});
 assert.equal((await t.review(second.id,'completeManualWithdrawal')).status,'completed');
 assert.equal((await t.review(second.id,'rejectWithdrawal')).code,409);
 assert.deepEqual(t.events().map(row=>[row.event,row.n]),[['credit',1],['payout',2],['reserve',2]]);
});

test('indexed transfers are unique and historical approvals protect the whole hash',async()=>{
 const t=setup();await t.configure();t.fundBasis();
 const first=await t.deposit();
 assert.equal((await t.approve(first)).code,200);
 const replay=await t.deposit('200',hash('1'),other);
 assert.equal((await t.approve(replay)).code,409);
 assert.equal(t.raw('SELECT COUNT(*) AS total FROM confirmed_cashier_activity WHERE id=?',first.id).first().total,1);
 assert.equal((await t.approve(replay,{index:4})).code,200);

 const manual=await t.deposit('100',hash('3'));
 const duplicate=await t.deposit('100',hash('3'),other);
 const results=await Promise.all([t.approve(manual),t.approve(duplicate)]);
 assert.deepEqual(results.map(result=>result.code).sort(),[200,409]);
 const payout=await t.quote('withdrawal','5');
 await t.call('submit',{id:payout.id});
 await t.review(payout.id,'approveWithdrawal');
 assert.equal((await t.review(payout.id,'sent',{tx:hash('3'),index:3})).code,409);
 assert.equal((await t.review(payout.id,'sent',{tx:hash('4'),index:4})).status,'sent');

 const historical=await t.deposit('100',hash('9'));
 t.raw('DROP TRIGGER manual_deposit_evidence_guard').run();
 t.raw("UPDATE manual_payments SET status='approved',credit=amount,evidence=? WHERE id=?",JSON.stringify({verification:'manual'}),historical.id).run();
 const historicReplay=await t.deposit('100',hash('9'),other);
 assert.match((await t.approve(historicReplay,{index:7})).error,/hash has already been used/i);
});

test('withdrawals enforce balance and investment cap, are retryable, and never refund after broadcast begins',async()=>{
 const t=setup();
 await t.configure();
 t.fundBasis();
 const unfunded=await t.quote('withdrawal','10');
 assert.equal((await t.call('submit',{id:unfunded.id})).code,409);
 await t.approve(await t.deposit());
 const overCap=await t.quote('withdrawal','12');
 assert.equal((await t.call('submit',{id:overCap.id})).code,409);
 const first=await t.quote('withdrawal','11.75');
 const [a,b]=await Promise.all([t.call('submit',{id:first.id}),t.call('submit',{id:first.id})]);
 assert.equal(a.code,200);assert.equal(b.code,200);
 assert.equal((await t.call('wallet')).balance,8800);
 assert.equal((await t.call('wallet')).daily_remaining,0);
 const rejected=await Promise.all([t.review(first.id,'rejectWithdrawal'),t.review(first.id,'rejectWithdrawal')]);
 assert.deepEqual(rejected.map(row=>row.code),[200,200]);
 assert.equal((await t.call('wallet')).balance,10000);
 const second=await t.quote('withdrawal','10');
 await t.call('submit',{id:second.id});
 assert.equal((await t.review(second.id,'process')).code,200);
 const lock=await t.review(second.id,'broadcast');
 assert.equal(lock.status,'broadcasting');
 assert.equal((await t.review(second.id,'rejectWithdrawal')).code,409);
 assert.equal((await t.call('cancel',{id:second.id})).code,409);
 assert.equal((await t.review(second.id,'complete',t.attest(second))).code,409);
 const sent={tx:hash('2'),index:5};
 assert.equal((await t.review(second.id,'sent',sent)).status,'sent');
 assert.equal((await t.review(second.id,'sent',sent)).status,'sent');
 assert.equal((await t.review(second.id,'sent',{...sent,tx:hash('3')})).code,409);
 assert.equal((await t.review(second.id,'complete',{verified:true,confirmations:4,paidAt:second.created})).code,400);
 assert.equal((await t.review(second.id,'rejectWithdrawal')).code,409);
 assert.equal((await t.review(second.id,'complete',t.attest(second,{confirmations:2}))).code,400);
 assert.equal((await t.review(second.id,'complete',t.attest(second))).status,'completed');
 assert.equal((await t.review(second.id,'complete',t.attest(second))).status,'completed');
 assert.equal((await t.call('wallet')).balance,8975);
 assert.deepEqual(t.events().map(row=>[row.event,row.n]),[['credit',1],['payout',1],['refund',1],['reserve',2]]);
});

test('approval races and simultaneous reservations write only the winning ledger transition',async()=>{
 const t=setup();await t.configure();t.fundBasis();
 const one=await t.deposit();
 const results=await Promise.all([t.approve(one),t.review(one.id,'rejectDeposit')]);
 assert.deepEqual(results.map(x=>x.code).sort(),[200,409]);
 const balance=(await t.call('wallet')).balance;
 assert.ok([0,10000].includes(balance));
 if(!balance)await t.approve(await t.deposit('100',hash('4')));
 const w1=await t.quote('withdrawal','9');
 const w2=await t.quote('withdrawal','9');
 const results2=await Promise.all([t.call('submit',{id:w1.id}),t.call('submit',{id:w2.id})]);
 assert.deepEqual(results2.map(x=>x.code).sort(),[200,409]);
 const winner=results2.find(x=>x.code===200);
 assert.equal((await t.call('cancel',{id:winner.id})).code,200);
 assert.equal((await t.call('cancel',{id:winner.id})).code,200);
 assert.equal((await t.call('wallet')).balance,10000);
});

test('deposit review may occur later if the transfer landed before expiry',async()=>{
 const t=setup();await t.configure();t.fundBasis();
 const old=await t.deposit();
 const expired=await t.quote('withdrawal','1');
 t.tick(601);
 assert.equal((await t.approve(old)).code,409);
 assert.equal((await t.approve(old,{paidAt:old.created-1})).code,409);
 assert.equal((await t.approve(old,{paidAt:old.expires})).code,200);
 assert.equal((await t.call('submit',{id:expired.id})).code,409);
 assert.equal((await t.call('submit',{id:expired.id},other)).code,404);
 assert.equal((await t.call('submit',{id:expired.id},investor,'https://outside.example')).code,403);
});

test('losing a commit response does not reserve funds twice on retry',async()=>{
 const t=setup();await t.configure();t.fundBasis();
 await t.approve(await t.deposit());
 const quote=await t.quote('withdrawal','5');
 t.loseResponse();
 assert.equal((await t.call('submit',{id:quote.id})).code,503);
 assert.equal((await t.call('submit',{id:quote.id})).code,200);
 assert.equal((await t.call('wallet')).balance,9475);
 assert.equal(t.events().find(row=>row.event==='reserve').n,1);
});

test('cashier admins can find accounts, inspect balances, and audit an atomic hold and resume',async()=>{
 const t=setup();await t.configure();t.fundBasis();
 t.raw("INSERT INTO login_accounts(username,id,salt,verifier) VALUES('newaccount','new-id','salt','verifier')").run();
 const deposit=await t.deposit();
 const checked=await t.approve(deposit);
 assert.equal(checked.status,'approved');
 const quote=await t.quote('withdrawal','5');
 const queued=await t.quote('withdrawal','5');
 await t.call('submit',{id:queued.id});
 const users=await t.call('admin/users',null,admin);
 assert.deepEqual(users.rows.map(row=>row.id).sort(),['investor','new-id']);
 assert.equal((await t.call('admin/users?q=NEWACCOUNT',null,admin)).rows[0].id,'new-id');
 assert.equal((await t.call('admin/user?id=investor')).code,403);
 assert.equal((await t.call('admin/user-control',{id:investor,held:true,note:'Manual review needed'})).code,403);
 const profile=await t.call('admin/user?id=investor',null,admin);
 assert.equal(profile.account.balance,9475);
 assert.equal(profile.account.reserved,525);
 assert.equal(profile.receipts.length,1);
 assert.equal(profile.ledger.length,2);
 const control=held=>t.call('admin/user-control',{id:investor,held,note:'Manual review state'},admin);
 assert.equal((await control(true)).code,200);
 assert.equal((await control(true)).code,200);
 assert.equal((await t.call('wallet')).held,true);
 assert.equal((await t.quote()).code,409);
 assert.equal((await t.call('submit',{id:quote.id})).code,409);
 assert.equal((await t.review(queued.id,'process')).code,409);
 assert.equal((await t.call('wallet')).balance,9475);
 assert.equal((await control(false)).code,200);
 assert.equal((await t.review(queued.id,'process')).code,200);
 assert.equal((await t.call('admin/audit?id=user%3Ainvestor',null,admin)).rows.length,2);
});

test('Approve and Reject race for the same pending payout and only one can win',async()=>{
 const t=setup();await t.configure();t.fundBasis();
 await t.approve(await t.deposit());
 const quote=await t.quote('withdrawal','5');
 assert.equal((await t.call('submit',{id:quote.id})).code,200);
 const [approve,reject]=await Promise.all([t.review(quote.id,'approveWithdrawal'),t.review(quote.id,'rejectWithdrawal')]);
 assert.deepEqual([approve.code,reject.code].sort(),[200,409]);
 if(approve.code===200){
  assert.equal(approve.status,'broadcasting');
  assert.equal((await t.review(quote.id,'approveWithdrawal')).alreadyLocked,true);
  assert.equal((await t.review(quote.id,'rejectWithdrawal')).code,409);
  assert.equal((await t.call('wallet')).balance,9475);
 }else{
  assert.equal(reject.status,'rejected');
  assert.equal((await t.call('wallet')).balance,10000);
 }
});

test('wallet investing uses approved balance without requiring operator prefunding and is idempotent',async()=>{
 const t=setup();
 const now=Math.floor(Date.now()/1000);
 t.tick(now-1_795_500_000);
 await t.configure();
 const userDeposit=await t.deposit('100',hash('a'));
 const adminDeposit=await t.deposit('300',hash('b'),admin);
 const order={plan:1,amount:'100',id:crypto.randomUUID()};
 const overBalance={...order,id:crypto.randomUUID(),amount:'100.01'};
 const reserve={id:crypto.randomUUID(),amount:'200'};
 assert.equal((await t.call('invest',order)).code,409);
 assert.equal((await t.call('admin/reward-reserve',reserve)).code,403);
 assert.equal((await t.call('admin/reward-reserve')).code,403);
 assert.deepEqual((await t.call('invest')).availablePlans,[]);
 assert.deepEqual((await t.call('invest')).eligibility,{1:'balance',2:'referrals',3:'referrals'});
 assert.deepEqual(await t.call('admin/reward-reserve',null,admin),{code:200,available:0,wallet:0,minimum:1728});
 assert.equal((await t.call('admin/reward-reserve',reserve,admin)).code,409);
 await t.approve(userDeposit);
 assert.equal((await t.call('invest')).eligibility[1],'available');
 assert.deepEqual((await t.call('invest')).availablePlans,[1]);
 assert.equal((await t.call('invest',overBalance)).code,409);
 assert.equal((await t.call('invest',{...order,id:crypto.randomUUID(),plan:2})).code,409);
 assert.equal((await t.call('invest')).startDay,Math.floor(now/86400));
 assert.equal((await t.call('invest')).admin,false);
 assert.equal((await t.call('invest',null,admin)).admin,true);
 const results=await Promise.all([t.call('invest',order),t.call('invest',order),t.call('invest',{...order,id:crypto.randomUUID()})]);
 assert.deepEqual(results.map(result=>result.code),[200,200,409]);
 assert.equal((await t.call('wallet')).balance,0);
 assert.equal((await t.call('wallet')).daily_remaining,1200);
 assert.equal((await t.call('admin/reward-reserve',null,admin)).available,-14400);
 await t.approve(adminDeposit);
 const funding=await Promise.all([t.call('admin/reward-reserve',reserve,admin),t.call('admin/reward-reserve',reserve,admin)]);
 assert.deepEqual(funding.map(result=>result.available),[5600,5600]);
 assert.equal((await t.call('wallet',null,admin)).balance,10000);
 assert.equal((await t.call('invest',{...order,amount:'99'})).code,409);
 assert.equal((await t.call('invest',order,other)).code,409);
 assert.deepEqual((await t.call('profile/history')).rows.map(row=>row.kind).sort(),['deposit','investment']);
 assert.throws(()=>t.raw('DELETE FROM wallet_plans').run(),/immutable investment/);
});

test('wallet plans skip weekends and observed holidays without reducing total credits',async()=>{
 const t=setup({controlDbTime:true});
 const opened=Date.parse('2026-12-23T12:00:00Z')/1000;
 const tomorrow=opened+86400;
 const monday=Date.parse('2026-12-28T12:00:00Z')/1000;
 const midnight=(Math.floor(opened/86400)+1)*86400;
 t.tick(opened-1_795_500_000);
 await t.configure();
 await t.approve(await t.deposit('262'));
 const legacyInvestor='legacy-investor';
 await t.approve(await t.deposit('12',hash('2'),legacyInvestor));
 t.raw(`INSERT INTO wallet_plans(id,user_id,plan_id,amount,rate,days,daily,separate,created,start_day,sponsor,first_reward,daily_reward,reserve)
  VALUES ('legacy-order',?,1,1200,12,12,144,1,?,?,NULL,0,0,1728)`,legacyInvestor,opened,Math.floor(opened/86400)).run();
 assert.deepEqual((await t.call('profile',null,legacyInvestor)).nextCredit,{at:midnight,amount:144,now:opened});
 const addLegacyReferral=(id,owner,referrer)=>t.raw(`INSERT INTO receipts
  (id,user_id,payout,amount,referrer,receiver,factory,vault,created,stage)
  VALUES(?,?,?,12000000,?,?,'factory','vault',?,'active')`,id,owner,destination,referrer,id,opened-2).run();
 addLegacyReferral('sponsor-address',investor,'unattributed');
 for(let i=0;i<10;i++)addLegacyReferral('referral-'+i,'referral-'+i,'sponsor-address');
 assert.deepEqual((await t.call('invest')).availablePlans,[1,2,3]);
 for(const [plan,amount] of [[1,'12'],[2,'50'],[3,'200']]){
  const result=await t.call('invest',{plan,amount,id:crypto.randomUUID()});
  assert.equal(result.code,200);
  assert.equal(result.firstCreditAt,tomorrow);
 }
 assert.equal(t.raw('SELECT COUNT(*) AS n FROM wallet_reward_funds').first().n,0);
 const readCredits=async()=>{
  const {rows}=await t.call('profile/history');
  return rows.filter(row=>row.kind==='plan payout').map(({plan,amount,created})=>[plan,amount,created]).sort((a,b)=>a[0]-b[0]);
 };
 t.tick(midnight-opened);
 const preCredit=await t.call('profile');
 assert.equal(preCredit.balance,0);
 assert.equal((await t.call('profile',null,legacyInvestor)).balance,144);
 assert.deepEqual(preCredit.nextCredit,{at:tomorrow,amount:4894,now:midnight});
 assert.equal((await t.call('profile',null,other)).nextCredit,null);
 assert.deepEqual(await readCredits(),[]);
 t.tick(tomorrow-midnight-1);
 assert.equal((await t.call('wallet')).balance,0);
 t.tick(1);
 const expected=[[1,144,tomorrow],[2,750,tomorrow],[3,4000,tomorrow]];
 assert.deepEqual(await readCredits(),expected);
 const afterFirst=await t.call('profile');
 assert.equal(afterFirst.balance,4894);
 assert.deepEqual(afterFirst.nextCredit,{at:monday,amount:4894,now:tomorrow});
 t.tick(86400);
 assert.equal((await t.call('wallet')).balance,4894);
 t.tick(2*86400);
 assert.equal((await t.call('wallet')).balance,4894);
 assert.equal((await readCredits()).length,3);
 t.tick(86400);
 assert.equal((await t.call('wallet')).balance,9788);
 assert.equal((await readCredits()).length,6);
 t.tick(35*86400);
 assert.equal((await t.call('profile')).nextCredit,null);
 assert.equal((await t.call('wallet')).balance,26200+12*144+15*750+20*4000);
});

test('a plan opened before an observed holiday waits until the following payday',async()=>{
 const t=setup({controlDbTime:true});
 const opened=Date.parse('2027-07-02T09:15:00Z')/1000;
 const tuesday=Date.parse('2027-07-06T09:15:00Z')/1000;
 t.tick(opened-1_795_500_000);
 await t.configure();
 await t.approve(await t.deposit('12'));
 const result=await t.call('invest',{plan:1,amount:'12',id:crypto.randomUUID()});
 assert.equal(result.firstCreditAt,tuesday);
 t.tick(tuesday-opened-1);
 assert.equal((await t.call('wallet')).balance,0);
 t.tick(1);
 assert.equal((await t.call('wallet')).balance,144);
});

test('the payday cutover preserves credits already earned under the prior schedule',async()=>{
 const t=setup({controlDbTime:true});
 const cutoff=Date.parse('2026-12-26T13:00:00Z')/1000;
 const opened=cutoff-2*86400;
 t.raw('UPDATE wallet_payday_policy SET starts_at=?',cutoff).run();
 t.tick(opened-1_795_500_000);
 await t.configure();
 await t.approve(await t.deposit('12'));
 await t.call('invest',{plan:1,amount:'12',id:crypto.randomUUID()});
 t.tick(2*86400);
 assert.equal((await t.call('wallet')).balance,288);
 t.tick(86400);
 const profile=await t.call('profile');
 assert.equal(profile.balance,288);
 assert.equal(profile.nextCredit.at,cutoff+2*86400);
 assert.equal((await t.call('profile/history')).rows.filter(row=>row.kind==='plan payout').length,2);
 assert.equal(t.raw("SELECT day FROM us_federal_holidays WHERE day='2027-07-05'").first().day,'2027-07-05');
 assert.equal(t.raw("SELECT day FROM us_federal_holidays WHERE day='2027-12-24'").first().day,'2027-12-24');
});

test('overlapping investments keep their own payment times',async()=>{
 const t=setup({controlDbTime:true});
 const opened=Date.parse('2026-11-30T12:00:00Z')/1000;
 t.tick(opened-1_795_500_000);
 await t.configure();
 await t.approve(await t.deposit('24'));
 const invest=()=>t.call('invest',{plan:1,amount:'12',id:crypto.randomUUID()});
 const first=await invest();
 t.tick(7200);
 const second=await invest();
 assert.equal(first.firstCreditAt,opened+86400);
 assert.equal(second.firstCreditAt,opened+86400+7200);
 t.tick(86400-7200);
 const next=await t.call('profile');
 assert.equal(next.balance,144);
 assert.deepEqual(next.nextCredit,{at:second.firstCreditAt,amount:144,now:first.firstCreditAt});
 t.tick(7200);
 const after=await t.call('profile');
 assert.equal(after.balance,288);
 assert.deepEqual(after.nextCredit,{at:first.firstCreditAt+86400,amount:144,now:second.firstCreditAt});
});

test('profile name stays private and referrals credit on each new plan interval after the first-investment commission',async()=>{
 const t=setup({controlDbTime:true});
 const today=Date.parse('2026-12-01T00:00:00Z')/1000;
 t.tick(today-1-1_795_500_000);
 await t.configure();
 assert.equal((await t.call('profile',null,null)).code,401);
 assert.equal((await t.call('profile/history',null,null)).code,401);
 assert.equal((await t.call('affiliate',null,null)).code,401);
 const empty=await t.call('affiliate',null,other);
 assert.deepEqual([empty.referralId,empty.funded,empty.totalFirst,empty.totalDaily],[null,0,0,0]);
 assert.equal((await t.call('profile',{name:'  Blue Orbit  '},investor,'https://outside.example')).code,403);
 assert.equal((await t.call('profile',{name:'a'})).code,400);
 assert.equal((await t.call('profile',{name:'  Blue Orbit  '})).name,'Blue Orbit');
 assert.equal((await t.call('profile')).name,'Blue Orbit');
 assert.notEqual((await t.call('profile',null,other)).name,'Blue Orbit');
 await t.approve(await t.deposit('500',hash('a'),admin));
 await t.approve(await t.deposit('100',hash('b'),other));
 await t.approve(await t.deposit('100',hash('c')));
 assert.equal((await t.call('admin/reward-reserve',{amount:'400',id:crypto.randomUUID()},admin)).code,200);
 assert.equal((await t.call('invest',{plan:1,amount:'12',id:crypto.randomUUID()},other)).code,200);
 const start={plan:1,amount:'25',referral:other,id:crypto.randomUUID()};
 assert.equal((await t.call('invest',start)).code,200);
 assert.equal((await t.call('invest',{...start,id:crypto.randomUUID(),referral:admin})).code,200);
 assert.equal((await t.call('profile',null,other)).referrals,1);
 const firstDay=await t.call('affiliate',null,other);
 assert.deepEqual([firstDay.referralId,firstDay.funded,firstDay.activePlans,firstDay.totalFirst,firstDay.totalDaily],[other,1,2,300,0]);
 assert.equal(firstDay.days.length,90);
 assert.deepEqual(firstDay.days.at(-1),{day:today/86400-1,first:300,daily:0});
 t.tick(1);
 const afterMidnight=await t.call('affiliate',null,other);
 assert.equal(afterMidnight.totalDaily,0);
 assert.deepEqual(afterMidnight.days.at(-1),{day:today/86400,first:0,daily:0});
 t.tick(86399);
 const firstInterval=await t.call('affiliate',null,other);
 assert.equal(firstInterval.totalDaily,50);
 assert.deepEqual(firstInterval.days.at(-1),{day:today/86400,first:0,daily:50});
 const anotherAffiliate=await t.call('affiliate?user='+other,null,'another-user');
 assert.equal(anotherAffiliate.funded,0);
 assert.equal(anotherAffiliate.totalFirst,0);
 const {rows}=await t.call('profile/history',null,other);
 assert.equal(rows.filter(row=>row.kind==='first referral reward').length,1);
 assert.equal(rows.find(row=>row.kind==='first referral reward').amount,300);
 assert.equal(rows.filter(row=>row.kind==='daily referral reward').length,2);
 assert.ok(rows.filter(row=>row.kind==='daily referral reward').every(row=>row.amount===25&&row.created===today+86399));
 assert.equal((await t.call('profile/history')).rows.filter(row=>row.kind==='plan payout').length,2);
 assert.equal((await t.call('profile/history',null,'another-user')).rows.length,0);
 t.tick(20*86400);
 const ended=await t.call('affiliate',null,other);
 assert.equal(ended.activePlans,0);
 assert.equal(ended.totalDaily,600);
 assert.equal(ended.days.reduce((total,day)=>total+day.daily,0),600);
});

test('deposit rejection records a reason and the cashier without crediting',async()=>{
 const t=setup();await t.configure();
 const deposit=await t.deposit();
 const request={id:deposit.id,action:'rejectDeposit',note:'Deposit amount did not match.'};
 assert.equal((await t.call('admin/review',request)).code,403);
 const rejected=await t.call('admin/review',request,admin);
 assert.equal(rejected.status,'rejected');
 assert.equal(rejected.note,request.note);
 assert.equal(rejected.confirmations,null);
 assert.deepEqual(await t.call('admin/review',request,admin),rejected);
 assert.equal((await t.approve(deposit)).code,409);
 assert.equal((await t.call('wallet')).balance,0);
 const audit=(await t.call('admin/audit?id='+deposit.id,null,admin)).rows;
 assert.equal(audit.length,2);
 assert.equal(audit[1].actor,admin);
 assert.equal(audit[1].event,'rejected');
});

test('admin request filters combine email, hash, status and network',async()=>{
 const t=setup();await t.configure();
 t.raw('INSERT INTO login_accounts(username,id,salt,verifier,email) VALUES(?,?,?,?,?)',
  'customer',investor,'salt','verifier','customer@example.com').run();
 const first=await t.deposit('100',hash('a'));
 const second=await t.deposit('80',hash('b'),other);
 await t.approve(first);
 const queue=(filters,user=admin)=>t.call('admin/queue?kind=deposit&'+new URLSearchParams(filters),null,user);
 const ids=result=>result.rows.map(row=>row.id);
 assert.equal((await queue({status:'all'},investor)).code,403);
 assert.deepEqual(ids(await queue({status:'approved',network:'ethereum',q:'CUSTOMER@example.com'})),[first.id]);
 assert.deepEqual(ids(await queue({status:'pending',q:hash('B')})),[second.id]);
 assert.deepEqual(ids(await queue({status:'all',q:first.id})),[first.id]);
 assert.deepEqual(ids(await queue({status:'all',network:'solana',q:first.id})),[]);
 assert.equal((await queue({status:'invalid'})).code,400);
});


test('support tickets are private, accept idempotent replies, and appear in the administrator inbox',async()=>{
 const t=setup();
 const ticket={id:crypto.randomUUID(),subject:'Deposit question',message:'Where can I find my request?'};
 assert.equal((await t.call('support/create',ticket,null)).code,401);
 assert.equal((await t.call('support/create',ticket,investor,'https://outside.example')).code,403);
 const [first,retry]=await Promise.all([t.call('support/create',ticket),t.call('support/create',ticket)]);
 assert.deepEqual(first,{code:200,id:ticket.id});
 assert.deepEqual(retry,first);
 const thread='support/thread?id='+ticket.id;
 assert.equal((await t.call(thread,null,other)).code,404);
 assert.deepEqual((await t.call('support/tickets',null,other)).tickets,[]);
 assert.equal((await t.call('admin/support/tickets',null,investor)).code,403);
 const reply={id:crypto.randomUUID(),ticketId:ticket.id,message:'Open Wallet and view your history.'};
 assert.equal((await t.call('support/reply',reply,other)).code,404);
 assert.equal((await t.call('admin/support/reply',reply,other)).code,403);

 const inbox=await t.call('admin/support/tickets',null,admin);
 assert.equal(inbox.tickets[0].user_id,investor);
 assert.equal(inbox.tickets[0].answered,0);
 t.tick(3);
 const verdict=await t.call('admin/support/reply',reply,admin);
 assert.deepEqual(verdict,{code:200,id:reply.id});
 assert.deepEqual(await t.call('admin/support/reply',reply,admin),verdict);
 const view=await t.call(thread);
 assert.equal(view.ticket.answered,1);
 assert.equal(view.messages.length,2);
 assert.deepEqual(view.messages.map(({from_support:role,body})=>[role,body]),[[0,ticket.message],[1,reply.message]]);
 assert.ok(view.messages.every(item=>!Object.hasOwn(item,'author_id')));
 assert.equal((await t.call('support/reply',{id:crypto.randomUUID(),ticketId:ticket.id,message:'Thanks, I found it.'})).code,200);
 assert.equal((await t.call(thread)).ticket.answered,0);
});
