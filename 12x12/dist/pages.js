import './support-launcher.js';
import {tiers} from './tiers.js';
import {$,fillIcons,renderMetrics,calc} from './ui.js';
const page=document.body.dataset.page;
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
const config=await fetch('/config.json',{cache:'no-store'}).then(r=>r.json());
const separate=config.separatePrincipal!==false;
if ($('calc-tier')) {
 const picker = $('calc-tier'), input = $('amount'), range = $('amount-range');
 const selected = () => tiers[Number(picker.value)-1];
 const update = () => calc(separate, selected());
 picker.onchange = () => {
  const {min,max,days} = selected();
  for (const field of [input,range]) { field.min=min; field.max=max; }
  input.value=Math.max(min,Math.min(max,Number(input.value))).toFixed(2);
  $('range-min').textContent='$'+min.toLocaleString('en-US')+' minimum';
  $('range-max').textContent='$'+max.toLocaleString('en-US')+' maximum';
  $('term-label').textContent=days+'-day payouts';
  update();
 };
 input.oninput=update;
 range.oninput=()=>{input.value=Number(range.value).toFixed(2);update();};
 picker.onchange();
}
if($('plan-policy'))$('plan-policy').textContent=(separate?'The invested principal unlocks separately at maturity. ':'Scheduled payouts include the invested principal. ')+(config.capOnBalance?'The daily cap uses the unlocked balance at the first withdrawal each UTC day.':'The daily cap uses recorded invested principal and resets at midnight UTC.');
if(page==='cashier-review')await import('./review.js');
await import('./account-nav.js');
if(page==='plan')await import('./plan-access.js');
if(page==='profile')await import('./profile.js');
if(page==='referrals')await import('./affiliate.js');
