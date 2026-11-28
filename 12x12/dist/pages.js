import {tiers} from './tiers.js';
import {$,fillIcons,renderMetrics,calc} from './ui.js';
const page=document.body.dataset.page;
if(page&&!['manual-admin','cashier-review'].includes(page)&&navigator.globalPrivacyControl!==true&&navigator.doNotTrack!=='1'){
 function startVisits(){
  let sentPageView=false, pending=false;
  function checkIn(){
   if(document.visibilityState!=='visible'||pending)return;
   const heartbeat=sentPageView;
   sentPageView=true;
   pending=true;
   void fetch('/api/analytics/visit',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page,heartbeat}),
    keepalive:true,signal:AbortSignal.timeout(8000)
   }).catch(()=>{}).finally(()=>{pending=false;});
  }
  checkIn();
  document.addEventListener('visibilitychange',checkIn);
  setInterval(checkIn,60_000);
 }
 if(document.prerendering)document.addEventListener('prerenderingchange',startVisits,{once:true});
 else startVisits();
}

let separate=true;
let refreshCalculator;
const policy=$('plan-policy');
if ($('calc-tier')) {
 const picker=$('calc-tier'), input=$('amount'), range=$('amount-range');
 const selected=()=>tiers[Number(picker.value)-1];
 const update=()=>calc(separate,selected());
 picker.onchange=()=>{
  const {min,max,days}=selected();
  for(const field of [input,range]){field.min=min;field.max=max;}
  input.value=Math.max(min,Math.min(max,Number(input.value))).toFixed(2);
  $('range-min').textContent='$'+min.toLocaleString('en-US')+' minimum';
  $('range-max').textContent='$'+max.toLocaleString('en-US')+' maximum';
  $('term-label').textContent=days+' paydays';
  update();
 };
 input.oninput=update;
 range.oninput=()=>{input.value=Number(range.value).toFixed(2);update();};
 refreshCalculator=update;
 picker.onchange();
}
if(refreshCalculator||policy){
 fetch('/config.json',{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(response=>{
  if(!response.ok)throw Error('Settings unavailable.');
  return response.json();
 }).then(config=>{
  separate=config.separatePrincipal!==false;
  refreshCalculator?.();
  if(policy)policy.textContent=(separate?'The invested principal unlocks separately at maturity. ':'Scheduled payouts include the invested principal. ')+
   (config.capOnBalance?'The daily cap uses the unlocked balance at the first withdrawal each UTC day.':'The daily cap uses recorded invested principal and resets at midnight UTC.');
 }).catch(()=>{});
}
const query=new URLSearchParams(location.search);
const referral=query.get('r'), oldReferral=query.get('ref');
if(referral&&/^[a-z0-9-]{3,80}$/i.test(referral))sessionStorage.setItem('apex-wallet-referral',referral);
if(oldReferral&&/^0x[0-9a-f]{40}$/i.test(oldReferral))sessionStorage.setItem('apex-ref',oldReferral);
if(page==='index'){
 const previous={portfolio:'/profile',referrals:'/referrals',deposit:'/deposit',plan:'/plan'};
 if(previous[location.hash.slice(1)])location.replace(previous[location.hash.slice(1)]+location.search);
 if($('metrics'))renderMetrics();
}
fillIcons();
void import('./support-launcher.js');
if(page==='cashier-review')await import('./review.js');
await import('./account-nav.js');
if(page==='plan')await import('./plan-access.js');
if(page==='profile')await import('./profile.js');
if(page==='referrals')await import('./affiliate.js');
