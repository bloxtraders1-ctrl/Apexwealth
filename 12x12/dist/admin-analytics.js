import {element} from './cashier-api.js';
import {button,cashier,notice} from './manual-ui.js';

const number=new Intl.NumberFormat();
const date=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

function summaryCard(label,value){
 const card=element('div',null,'panel analytics-card');
 card.append(element('span',label,'secondary'),element('strong',number.format(value)));
 return card;
}

function dailyTable(rows){
 const table=element('table',null,'analytics-table');
 table.append(element('caption','Daily breakdown (UTC)'));
 const head=table.createTHead().insertRow();
 for(const title of ['Date','Unique visitors','Page views','Signups']){
  const cell=element('th',title);
  cell.scope='col';
  head.append(cell);
 }
 const body=table.createTBody();
 for(const row of rows){
  const entry=body.insertRow();
  const heading=element('th');
  heading.scope='row';
  const time=element('time',date.format(new Date(row.date+'T00:00:00Z')));
  time.dateTime=row.date;
  heading.append(time);
  entry.append(heading);
  for(const count of [row.visitors,row.pageViews,row.signups])entry.insertCell().textContent=number.format(count);
 }
 return table;
}

export function mountAnalytics(container){
 const heading=element('div',null,'analytics-heading');
 const tools=element('div',null,'analytics-tools');
 const range=element('select',null,'field');
 range.id='analytics-range';
 const label=element('label','Date range');
 label.htmlFor=range.id;
 for(const days of [7,30,90]){
  const option=element('option','Last '+days+' days');
  option.value=String(days);
  range.append(option);
 }
 const onlineCard=element('div',null,'panel analytics-card analytics-online');
 const onlineCount=element('strong','Loading…');
 onlineCount.setAttribute('role','status');
 onlineCard.append(element('span','Online now','secondary'),onlineCount,
  element('small','Unique browsers active in the last 5 minutes','secondary'));
 let stopped=false, onlinePending=false;
 async function refreshOnline(){
  if(stopped||onlinePending||document.visibilityState!=='visible')return;
  onlinePending=true;
  try{
   const {online}=await cashier('admin/analytics/online');
   const value=number.format(online);
   if(!stopped&&onlineCount.textContent!==value)onlineCount.textContent=value;
  }catch{
   if(!stopped&&onlineCount.textContent!=='Unavailable')onlineCount.textContent='Unavailable';
  }finally{
   onlinePending=false;
  }
 }
 const feedback=notice();
 const results=element('div',null,'analytics-results');
 let request=0;
 async function load(){
  const current=++request;
  feedback.textContent='Loading analytics…';
  results.setAttribute('aria-busy','true');
  try{
   const data=await cashier('admin/analytics?days='+encodeURIComponent(range.value));
   if(current!==request)return;
   const cards=element('div',null,'analytics-cards');
   cards.append(summaryCard('Unique visitors',data.uniqueVisitors),summaryCard('Page views',data.pageViews),
    summaryCard('New signups',data.signups),summaryCard('All-time accounts',data.totalAccounts));
   results.replaceChildren(cards,dailyTable(data.daily));
   feedback.textContent='';
  }catch(error){
   if(current===request){
    results.replaceChildren();
    feedback.textContent=error.message;
   }
  }finally{
   if(current===request)results.removeAttribute('aria-busy');
  }
 }
 range.onchange=load;
 tools.append(label,range,button('Refresh',()=>{void refreshOnline();return load();}));
 heading.append(element('h2','Analytics'),tools);
 container.replaceChildren(heading,element('p','Unique visitors are counted by browser. Daily tracking starts when Analytics is enabled. All-time accounts includes earlier signups.','secondary'),onlineCard,feedback,results);
 const timer=setInterval(refreshOnline,20_000);
 document.addEventListener('visibilitychange',refreshOnline);
 void refreshOnline();
 void load();
 return ()=>{
  stopped=true;
  request++;
  clearInterval(timer);
  document.removeEventListener('visibilitychange',refreshOnline);
 };
}
