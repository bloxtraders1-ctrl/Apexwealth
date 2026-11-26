import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI} from '../gateway/api.mjs';
import {localDB} from '../gateway/local-db.mjs';
import {Wallet} from 'ethers';
test('receipt ownership, duplicate proof, API origin and queued withdrawals',async()=>{
 const vault=Wallet.createRandom().address,factory=Wallet.createRandom().address,recipient=Wallet.createRandom().address;
 const env={DB:localDB(':memory:'),settings:{vaultAddress:vault,factoryAddress:factory}};
 const owner=Wallet.createRandom();
 let stage='created',validProof=false;
 const net={quote:async()=>Wallet.createRandom().address,proof:async()=>{if(!validProof)throw Object.assign(Error('No transfer'),{status:409});},state:async()=>({stage,available:'12000000'}),paid:async()=>false,owner:async()=>owner.address};
 async function request(path,body,user='account-A',origin='https://apex.example'){
  const req=new Request('https://apex.example/api/'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const r=await handleAPI(req,env,user,'hosted',net);
  return [r.status,await r.json()];
 }
 assert.equal((await request('portfolio',null,null))[0],401);
 assert.equal((await request('receipt',{amount:100,payout:recipient},'account-A','https://other.example'))[0],403);
 assert.equal((await request('receipt',{amount:1201,payout:recipient}))[0],400);
 const args={amount:'100',payout:recipient};const [ok,row]=await request('receipt',args);assert.equal(ok,200);
 assert.equal((await request('receipt',args))[1].id,row.id);
 assert.equal((await request('portfolio',null,'account-B'))[1].receipts.length,0);
 const data={id:row.id,tx:'0x'+'55'.repeat(32)};
 assert.equal((await request('proof',data,'account-B'))[0],403);
 assert.equal((await request('proof',data))[0],409);
 validProof=true;assert.equal((await request('proof',data))[0],200);
 assert.equal((await request('proof',data))[0],200);
 const [,other]=await request('receipt',args,'account-B');
 assert.equal((await request('proof',{...data,id:other.id},'account-B'))[0],409);
 stage='active';await request('sync',{id:row.id});
 const destination=Wallet.createRandom().address;
 const withdraw={id:row.id,amount:'9.50',destination};
 assert.equal((await request('withdraw',{id:row.id}))[0],400);
 assert.equal((await request('withdraw',{...withdraw,amount:'12.01'}))[0],409);
 assert.equal((await request('withdraw',withdraw,'account-B'))[0],403);
 const [queuedCode,queued]=await request('withdraw',withdraw);
 assert.equal(queuedCode,200);
 assert.equal(queued.destination,destination);
 assert.equal(queued.amount,9500000);
 assert.equal((await request('withdraw',withdraw))[1].id,queued.id);
 assert.equal((await request('withdraw',{...withdraw,destination:recipient}))[0],409);
 assert.equal((await request('portfolio'))[1].withdrawals.length,1);
 const timestamp=Math.floor(Date.now()/1000);
 const signature=await owner.signMessage('12x12 cashier review\nhttps://apex.example\n'+timestamp);
 assert.equal((await request('queue',{timestamp,signature:'invalid'},'operator'))[0],403);
 const [queueCode,queue]=await request('queue',{timestamp,signature},'operator');
 assert.equal(queueCode,200);
 assert.equal(queue.withdrawals[0].destination,destination);
 assert.equal((await request('withdraw',{...withdraw,timestamp,signature},'operator'))[0],403);
});
test('public launch schedule hides cashier totals from signed-out users and investors',async()=>{
 const DB=localDB(':memory:');
 const env={DB,APEX_CASHIER_ADMIN_IDS:'cashier'};
 const read=(path,user)=>handleAPI(new Request('https://apex.example/api/'+path),env,user,'hosted');
 const schedule=await (await read('launch',null)).json();
 assert.ok(schedule.launchAt-schedule.now>=12*3600-5&&schedule.launchAt-schedule.now<=12*3600);
 assert.equal((await (await read('launch','investor')).json()).launchAt,schedule.launchAt);
 assert.equal((await read('statistics',null)).status,403);
 assert.equal((await read('statistics','investor')).status,403);
 assert.equal((await read('statistics','cashier')).status,200);
});
test('cashier statistics count only activated receipts and paid withdrawals and omit identities',async()=>{
 const DB=localDB(':memory:');
 const read=async()=> (await handleAPI(new Request('https://apex.example/api/statistics'),{DB,APEX_CASHIER_ADMIN_IDS:'admin'},'admin','hosted')).json();
 assert.deepEqual([(await read()).invested,(await read()).paid],[356651250000,324849650000]);
 for(const [id,stage] of [['one','active'],['two','review'],['three','refunded']]){
  await DB.prepare('INSERT INTO receipts(id,user_id,payout,amount,referrer,receiver,factory,vault,created,stage) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'secret-user','secret-payout',100000000,'ref',id,'factory','vault',100,stage).run();
 }
 for(const [id,stage] of [['a','paid'],['b','review']])await DB.prepare('INSERT INTO withdrawals(id,receipt,amount,created,stage) VALUES(?,?,?,?,?)').bind(id,'one',12000000,101,stage).run();
 const data=await read();assert.deepEqual([data.invested,data.paid,data.investments,data.payouts],[356751250000,324861650000,1,1]);
 assert.equal(data.recent.length,2);assert.equal(data.recent[0].kind,'payout');assert.ok(!JSON.stringify(data).includes('secret-'));
});

test('tier quotes require distinct funded direct accounts and an eligible payout address',async()=>{
 const DB=localDB(':memory:'), payout=Wallet.createRandom().address;
 const env={DB,settings:{vaultAddress:Wallet.createRandom().address,factoryAddress:Wallet.createRandom().address}};
 let chainCount=5, issued=0;
 const net={qualified:async()=>chainCount,quote:async()=>{issued++;return Wallet.createRandom().address;}};
 async function post(route,args){
  const origin='https://apex.example';
  const res=await handleAPI(new Request(origin+'/api/'+route,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(args)}),env,'sponsor','hosted',net);
  return [res.status,await res.json()];
 }
 const sponsor=Wallet.createRandom().address;
 function seed(id,user,receiver,referrer,stage){
  DB.prepare('INSERT INTO receipts(id,user_id,payout,amount,referrer,receiver,factory,vault,created,stage) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(id,user,payout,50000000,referrer,receiver,env.settings.factoryAddress,env.settings.vaultAddress,100,stage).run();
 }
 seed('parent','sponsor',sponsor,'','active');
 seed('r1','investor-1','one',sponsor,'active');
 seed('r2','investor-1','two',sponsor,'active');
 seed('r3','sponsor','three',sponsor,'active');
 seed('r4','investor-2','four',sponsor,'review');
 const request=(plan_id,amount)=>post('receipt',{plan_id,amount,payout});
 const readAccess=async()=> (await handleAPI(new Request('https://apex.example/api/plan-access'),env,'sponsor','hosted',net)).json();
 assert.deepEqual(await readAccess(),{fundedReferrals:1,plans:{}});

 assert.equal((await request(2,50))[0],409);
 assert.deepEqual((await post('eligibility',{payout}))[1],{fundedReferrals:1,eligibleThrough:1});
 seed('r5','investor-2','five',sponsor,'active');
 seed('r6','investor-3','six',sponsor,'active');
 assert.equal((await request(3,200))[0],409);
 chainCount=2;
 assert.equal((await request(2,50))[0],409);
 assert.equal(issued,0);
 const [changedPayout]=await post('receipt',{plan_id:1,amount:50,payout:Wallet.createRandom().address});
 assert.equal(changedPayout,409);
 seed('r7','investor-4','seven',sponsor,'active');
 seed('r8','investor-5','eight',sponsor,'active');
 chainCount=4;
 assert.deepEqual(await readAccess(),{fundedReferrals:5,plans:{}});
 chainCount=5;
 assert.deepEqual(await readAccess(),{fundedReferrals:5,plans:{2:payout}});
 for(const [tier,amount] of [[2,49.99],[2,1500.01],[3,199.99],[3,2500.01],[0,100],[4,100]])assert.equal((await request(tier,amount))[0],400);
 const [code,first]=await request(2,1500);
 assert.equal(code,200);assert.equal(first.plan_id,2);assert.equal(first.contract_version,5);
 assert.equal((await request(2,1500))[1].id,first.id);
 assert.equal((await request(1,100))[0],409);
 await post('archive',{id:first.id});
 for(let n=6;n<=10;n++)seed('user-'+n,'new-'+n,'addr-'+n,sponsor,'active');
 chainCount=9;
 assert.equal((await request(3,2500))[0],409);
 chainCount=10;
 assert.deepEqual(await readAccess(),{fundedReferrals:10,plans:{2:payout,3:payout}});
 const [ok,high]=await request(3,2500);
 assert.equal(ok,200);assert.equal(high.plan_id,3);assert.equal(high.amount,2500000000);
 assert.equal(issued,2);
});

test('settlement readiness separates new deposits from withdrawals',async()=>{
 const request=new Request('https://apex.example/api/settlement-status');
 const closed=await handleAPI(request,{settings:{}},null,'selfhost');
 assert.deepEqual(await closed.json(),{depositReady:false,withdrawalReady:false,reason:'configuration'});
 const settings={vaultAddress:Wallet.createRandom().address,factoryAddress:Wallet.createRandom().address};
 for(const depositReady of [false,true]){
  const gateway={readiness:async()=>({depositReady,withdrawalReady:true})};
  const response=await handleAPI(request,{settings},null,'selfhost',gateway);
  assert.deepEqual(await response.json(),{depositReady,withdrawalReady:true,reason:depositReady?null:'reserve'});
 }
});
