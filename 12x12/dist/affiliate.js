import {api,element,link} from './cashier-api.js';
import {cashier,cents} from './manual-ui.js';
import {tiers} from './tiers.js';
import {$} from './ui.js';

const dayFormat=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const formatDay=day=>dayFormat.format(day*86_400_000);

function showInvite(referralId){
 if(!referralId){
  $('affiliate-link-locked').hidden=false;
  return;
 }
 const url=new URL('/plan',location.origin);
 url.searchParams.set('r',referralId);
 const input=$('affiliate-link');
 const copy=$('affiliate-copy');
 const message=$('affiliate-copy-status');
 input.value=url.href;
 input.onclick=()=>input.select();
 copy.onclick=async()=>{
  try{
   await navigator.clipboard.writeText(input.value);
   message.textContent='Referral link copied.';
  }catch{
   input.focus();
   input.select();
   message.textContent='Copy the selected link.';
  }
 };
 $('affiliate-link-group').hidden=false;
}

function showProgress(funded){
 for(const tier of tiers.filter(tier=>tier.referrals>0)){
  const progress=Math.min(funded,tier.referrals);
  const unlocked=progress===tier.referrals;
  const card=element('article',null,'affiliate-progress-card');
  const head=element('div',null,'affiliate-progress-head');
  const title=element('h3','Plan '+tier.id);
  const status=element('span',unlocked?'Unlocked':'Locked','affiliate-plan-status');
  status.dataset.unlocked=String(unlocked);
  head.append(title,status);
  const bar=element('progress');
  bar.max=tier.referrals;
  bar.value=progress;
  bar.setAttribute('aria-label','Funded referrals needed for Plan '+tier.id);
  const foot=element('div',null,'affiliate-progress-foot');
  foot.append(element('span',progress+' of '+tier.referrals+' funded referrals'),link('/plan#plan-'+tier.id,'View plan'));
  card.append(head,bar,foot);
  $('affiliate-plan-progress').append(card);
 }
}

function showChart(days,range){
 const period=days.slice(-range);
 const total=period.reduce((sum,day)=>sum+day.first+day.daily,0);
 const tick=Math.ceil(Math.max(100,...period.map(day=>day.first+day.daily))/4);
 const axis=Array.from({length:5},(_,index)=>element('span',cents((4-index)*tick)));
 $('affiliate-y-axis').replaceChildren(...axis);
 $('affiliate-range-total').textContent=cents(total);
 $('affiliate-range-label').textContent='credited in the last '+range+' days';
 const markers=[period.at(0),period[Math.floor(period.length/2)],period.at(-1)];
 $('affiliate-x-axis').replaceChildren(...markers.map(day=>element('span',formatDay(day.day))));

 const plot=$('affiliate-plot');
 plot.style.setProperty('--days',period.length);
 plot.dataset.range=String(range);
 plot.setAttribute('aria-label','Wallet commissions over the last '+range+' days: '+cents(total)+'.');
 if(!total){
  plot.replaceChildren(element('p','No commissions in this period.','affiliate-chart-empty'));
  return;
 }
 const bars=period.map(day=>{
  const bar=element('div',null,'affiliate-bar');
  bar.style.setProperty('--daily',day.daily/(4*tick)*100+'%');
  bar.style.setProperty('--first',day.first/(4*tick)*100+'%');
  bar.title=formatDay(day.day)+' · First investment '+cents(day.first)+' · Daily '+cents(day.daily);
  return bar;
 });
 plot.replaceChildren(...bars);
}

async function load(){
 const message=$('affiliate-message');
 const {signedIn}=await api('status');
 if(!signedIn){
  message.textContent='';
  $('affiliate-sign-in').hidden=false;
  return;
 }
 const data=await cashier('affiliate');
 $('affiliate-total').textContent=cents(data.totalFirst+data.totalDaily);
 $('affiliate-funded').textContent=data.funded;
 $('affiliate-active').textContent=data.activePlans;
 $('affiliate-daily').textContent=cents(data.totalDaily);

 showInvite(data.referralId);
 showProgress(data.funded);
 showChart(data.days,30);
 const ranges=$('affiliate-ranges').querySelectorAll('button');
 for(const control of ranges){
  control.onclick=()=>{
   for(const other of ranges)other.setAttribute('aria-pressed',String(other===control));
   showChart(data.days,Number(control.dataset.days));
  };
 }
 message.textContent='';
 $('affiliate-history').hidden=false;
 $('affiliate-dashboard').hidden=false;
}

load().catch(error=>{$('affiliate-message').textContent=error.message;});
