import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI} from '../gateway/api.mjs';
import {recordPageView} from '../gateway/analytics.mjs';
import {authenticate} from '../gateway/auth.mjs';
import {localDB} from '../gateway/local-db.mjs';
import {manualCashier} from '../gateway/manual-cashier.mjs';

const origin='https://12x12.example';
const admin='analytics-admin';
const elapsed=86400;
const password='analytics-fixture-password';
function fixture(){
 const DB=localDB(':memory:');
 const env={DB,APEX_CASHIER_ADMIN_IDS:admin};
 const visit=(page,cookie='',headers={},heartbeat=false)=>new Request(origin+'/api/analytics/visit',{
  method:'POST',headers:{origin,cookie,'content-type':'application/json',...headers},body:JSON.stringify({page,heartbeat})
 });
 const report=(query='',user=admin,now)=>manualCashier(
  new Request(origin+'/api/manual/admin/analytics'+query),env,user,{clock:()=>now}
 );
 const online=(now,user=admin)=>manualCashier(
  new Request(origin+'/api/manual/admin/analytics/online'),env,user,{clock:()=>now}
 );
 return {DB,env,visit,report,online};
}

test('page analytics deduplicates browsers in the selected range and tracks page views separately',async()=>{
 const f=fixture();
 const now=Date.UTC(2026,10,28,12)/1000;
 const response=await recordPageView(f.visit('index'),f.DB,now-elapsed);
 assert.equal(response.status,204);
 const header=response.headers.get('set-cookie');
 assert.match(header,/^12x12_visitor=[0-9a-f-]{36}; Path=\/api\/analytics\/visit; Max-Age=7776000; HttpOnly; SameSite=Lax; Secure$/);
 const visitor=header.split(';')[0];
 await recordPageView(f.visit('plan',visitor),f.DB,now);
 await recordPageView(f.visit('register',visitor),f.DB,now);
 await recordPageView(f.visit('index'),f.DB,now);
 await recordPageView(f.visit('index'),f.DB,now-8*elapsed);

 const week=await (await f.report('',admin,now)).json();
 assert.equal(week.days,7);
 assert.equal(week.uniqueVisitors,2);
 assert.equal(week.pageViews,4);
 assert.equal(week.signups,0);
 assert.deepEqual(week.daily[0],{date:'2026-11-28',visitors:2,pageViews:3,signups:0});
 assert.deepEqual(week.daily[1],{date:'2026-11-27',visitors:1,pageViews:1,signups:0});
 assert.deepEqual(week.daily[2],{date:'2026-11-26',visitors:0,pageViews:0,signups:0});
 const month=await (await f.report('?days=30',admin,now)).json();
 assert.equal(month.daily.length,30);
 assert.equal(month.uniqueVisitors,3);
 assert.equal(month.pageViews,5);
 assert.match(f.DB.prepare('SELECT browser_digest FROM analytics_visitors LIMIT 1').bind().first().browser_digest,/^[0-9a-f]{64}$/);
});

test('visits honor privacy signals and admin reports require cashier admin authorization',async()=>{
 const f=fixture();
 const now=Date.UTC(2026,10,28,12)/1000;
 const call=req=>handleAPI(req,f.env,null,'selfhost');
 for(const key of ['sec-gpc','dnt']){
  const optedOut=await call(f.visit('index','',{[key]:'1'}));
  assert.equal(optedOut.status,204);
  assert.equal(optedOut.headers.get('set-cookie'),null);
 }
 assert.equal((await call(f.visit('manual-admin'))).status,400);
 assert.equal((await call(f.visit('index','',{origin:'https://other.example'}))).status,403);
 assert.equal((await call(new Request(origin+'/api/analytics/visit'))).status,405);
 assert.equal((await f.report('',null,now)).status,401);
 assert.equal((await f.report('','registered-user',now)).status,403);
 assert.equal((await f.report('?days=365',admin,now)).status,400);
 assert.equal((await (await f.report('',admin,now)).json()).pageViews,0);
});

test('successful account creation is counted once and repeat login or failed signup never increments the total',async()=>{
 const f=fixture();
 const call=(route,email)=>authenticate(new Request(origin+'/api/'+route,{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password})
 }),f.env,null,'selfhost','analytics-fixture');
 const email='analytics@example.net';
 assert.equal((await call('register','bad-email')).status,400);
 assert.equal((await call('register',email)).status,200);
 assert.equal((await call('register',email)).status,409);
 assert.equal((await call('login',email)).status,200);
 const day=f.DB.prepare('SELECT day FROM analytics_signups').bind().first().day;
 const summary=await (await f.report('',admin,day*elapsed+elapsed/2)).json();
 assert.equal(summary.signups,1);
 assert.equal(summary.totalAccounts,1);
 assert.equal(summary.daily[0].signups,1);
});

test('online count deduplicates across midnight and heartbeats leave historical traffic totals intact',async()=>{
 const f=fixture();
 const midnight=Date.UTC(2026,10,28)/1000;
 const first=await recordPageView(f.visit('index'),f.DB,midnight-60);
 const browser=first.headers.get('set-cookie').split(';')[0];
 await recordPageView(f.visit('index',browser,{},true),f.DB,midnight+10);
 await recordPageView(f.visit('plan',browser,{},true),f.DB,midnight+9);
 await recordPageView(f.visit('register','',{},true),f.DB,midnight+30);
 await recordPageView(f.visit('register'),f.DB,midnight-301);
 f.DB.prepare('INSERT INTO analytics_visitors (day,browser_digest,page_views) VALUES (?,?,?)')
  .bind(midnight/elapsed-1,'imported-visitor',6).run();

 assert.equal((await f.online(midnight+31,null)).status,401);
 assert.equal((await f.online(midnight+31,'registered-user')).status,403);
 assert.deepEqual(await (await f.online(midnight+31)).json(),{online:2});
 assert.deepEqual(await (await f.online(midnight+309)).json(),{online:2});
 assert.deepEqual(await (await f.online(midnight+310)).json(),{online:1});
 assert.deepEqual(await (await f.online(midnight+330)).json(),{online:0});

 const report=await (await f.report('',admin,midnight+310)).json();
 assert.equal(report.uniqueVisitors,3);
 assert.equal(report.pageViews,8);
 assert.deepEqual(report.daily[0],{date:'2026-11-28',visitors:0,pageViews:0,signups:0});
});
