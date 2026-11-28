import {check} from './chain.mjs';

const daySeconds=86400;
const browserLifetime=90*daySeconds;
const onlineWindow=5*60;
const cookieName='12x12_visitor';
const pages=new Set(['index','plan','how-it-works','referrals','profile','faq','terms','privacy','login','register']);
const utf8=new TextEncoder();

const currentTime=()=>Math.floor(Date.now()/1000);
const dayOf=seconds=>Math.floor(seconds/daySeconds);
const dateOf=day=>new Date(day*daySeconds*1000).toISOString().slice(0,10);

export async function recordPageView(req,db,now=currentTime()){
 const url=new URL(req.url);
 check(req.method==='POST','Use POST for this request.',405);
 check(req.headers.get('origin')===url.origin&&req.headers.get('content-type')?.includes('application/json'),'Invalid request origin.',403);
 const headers=new Headers({'Cache-Control':'no-store'});
 if(req.headers.get('sec-gpc')==='1'||req.headers.get('dnt')==='1')return new Response(null,{status:204,headers});
 const raw=await req.text();
 check(raw.length<=256,'Request too large.',413);
 let body;
 try{body=JSON.parse(raw);}catch{check(false,'Invalid page view.');}
 check(pages.has(body?.page),'Unknown page.');
 const existing=(req.headers.get('cookie')||'').match(/(?:^|; *)12x12_visitor=([0-9a-f-]{36})(?:;|$)/)?.[1];
 const browser=existing||crypto.randomUUID();
 const hash=await crypto.subtle.digest('SHA-256',utf8.encode(browser));
 const browserDigest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
 const views=body.heartbeat===true?0:1;
 await db.prepare(`INSERT INTO analytics_visitors (day,browser_digest,page_views,last_seen) VALUES (?,?,?,?)
  ON CONFLICT(day,browser_digest) DO UPDATE SET
   page_views=page_views+excluded.page_views,
   last_seen=MAX(COALESCE(last_seen,0),excluded.last_seen)`).bind(dayOf(now),browserDigest,views,now).run();
 if(!existing){
  headers.set('Set-Cookie',cookieName+'='+browser+'; Path=/api/analytics/visit; Max-Age='+browserLifetime+
   '; HttpOnly; SameSite=Lax'+(url.protocol==='https:'?'; Secure':''));
 }
 return new Response(null,{status:204,headers});
}

export async function onlineVisitors(read,now){
 const row=await read(`SELECT COUNT(DISTINCT browser_digest) AS online
  FROM analytics_visitors WHERE last_seen>? AND last_seen<=?`,now-onlineWindow,now);
 return {online:Number(row.online)};
}

export async function analyticsSummary(all,range,now){
 const days=range===null?7:Number(range);
 check([7,30,90].includes(days),'Choose a 7, 30 or 90 day range.');
 const today=dayOf(now), firstDay=today-days+1;
 const rows=await all(`WITH RECURSIVE dates(day) AS (
   VALUES (?) UNION ALL SELECT day+1 FROM dates WHERE day<?
  ), traffic AS (
   SELECT day, COUNT(*) AS visitors, SUM(page_views) AS page_views
   FROM analytics_visitors WHERE day BETWEEN ? AND ? AND page_views>0 GROUP BY day
  ), totals AS (
   SELECT COUNT(DISTINCT browser_digest) AS unique_visitors
   FROM analytics_visitors WHERE day BETWEEN ? AND ? AND page_views>0
  ), accounts AS (SELECT COUNT(*) AS total_accounts FROM login_accounts)
  SELECT dates.day, COALESCE(traffic.visitors,0) AS visitors,
   COALESCE(traffic.page_views,0) AS page_views, COALESCE(signups.signups,0) AS signups,
   totals.unique_visitors, accounts.total_accounts
  FROM dates LEFT JOIN traffic ON traffic.day=dates.day
  LEFT JOIN analytics_signups signups ON signups.day=dates.day
  CROSS JOIN totals CROSS JOIN accounts
  ORDER BY dates.day DESC`,firstDay,today,firstDay,today,firstDay,today);
 const daily=rows.map(row=>({date:dateOf(row.day),visitors:Number(row.visitors),pageViews:Number(row.page_views),signups:Number(row.signups)}));
 return {
  days, uniqueVisitors:Number(rows[0].unique_visitors), totalAccounts:Number(rows[0].total_accounts),
  pageViews:daily.reduce((sum,day)=>sum+day.pageViews,0),
  signups:daily.reduce((sum,day)=>sum+day.signups,0), daily
 };
}
