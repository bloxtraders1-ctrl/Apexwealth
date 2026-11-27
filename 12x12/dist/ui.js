import {tiers} from './tiers.js';
const paths = {
 support:'<path d="M3 12a9 9 0 0 1 18 0M3 12v3a3 3 0 0 0 3 3h1v-7H6a3 3 0 0 0-3 3m18-2v3a3 3 0 0 1-3 3h-1v-7h1a3 3 0 0 1 3 3m-1 4a5 5 0 0 1-5 4h-2"/>',
 overview:'<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
 wallet:'<path d="M19 7V4a1 1 0 0 0-1.3-1L5 6.4A2.6 2.6 0 0 0 3 9v9a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H5"/><path d="M21 11h-5a2 2 0 0 0 0 5h5"/><path d="M17 13.5h.25"/>',
 profile:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
 users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M15 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 4 5"/>',
 layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
 'arrow-up-right':'<path d="M5 19 19 5M6 5h13v13"/>','arrow-right':'<path d="M4 12h16m-7-7 7 7-7 7"/>',
 play:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>',
 trend:'<path d="m3 17 6-6 4 4 8-10m-6 0h6v6"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M7 14h3m3 0h3"/>',
 coins:'<ellipse cx="10" cy="7" rx="7" ry="3"/><path d="M3 7v4c0 2 3 3 7 3 2 0 4-.3 5-1m2-6v3M3 11v4c0 2 3 3 7 3"/><path d="M13 16c0 1.6 2 2.5 4 2.5s4-.9 4-2.5-2-2.5-4-2.5-4 .9-4 2.5Zm0 0v3c0 1.6 2 2.5 4 2.5s4-.9 4-2.5v-3"/>',
 withdraw:'<path d="M12 3v12m-4-4 4 4 4-4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
 sliders:'<path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
 link:'<path d="m9 15 6-6m-7 5-1 1a3.5 3.5 0 1 0 5 5l4-4a3.5 3.5 0 0 0 .5-4m-1-2 1-1a3.5 3.5 0 1 0-5-5L7 8a3.5 3.5 0 0 0-.5 4"/>',
 copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>'
};
export const icon = name => '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24">'+(paths[name]||'')+'</svg>';
export const $ = id=>document.getElementById(id);
export function fillIcons(){document.querySelectorAll('[data-i]').forEach(el=>el.outerHTML=icon(el.dataset.i));}
export const usd = v=>Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
export const short = s=>s.slice(0,6)+'…'+s.slice(-4);
export function modal(title,html){$('dialog-title').textContent=title;$('dialog-body').innerHTML=html;if(!$('dialog').open)$('dialog').showModal();}
let timer;
export function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(timer);timer=setTimeout(()=>$('toast').classList.remove('show'),5500);}
export function calc(separate=true, tier=tiers[0]) {
 const {days,rate,min,max}=tier;
 const input=$('amount'),range=$('amount-range'),n=Number(input.value),valid=input.value!==''&&input.checkValidity();
 const daily=Math.floor(Math.round(n*100)*rate/100)/100;
 $('amount-error').textContent=valid?'':'Enter '+usd(min)+'–'+usd(max)+' with up to two decimal places.';
 if(valid){range.value=n;range.style.setProperty('--progress',((n-min)/(max-min)*100)+'%');}
 $('daily').textContent=valid?usd(daily):'—';$('term').textContent=valid?usd(daily*days):'—';
 $('principal-note').textContent=separate?'Your invested principal unlocks separately at maturity. Crypto withdrawals are subject to the daily cap.':'The '+days+'-day total includes your invested principal. Crypto withdrawals are subject to the daily cap.';
 if(!valid){$('plot').replaceChildren();return;}
 const x=i=>50+i*516/days,y=i=>76-i*64.8/days;
 const line=Array.from({length:days},(_,j)=>' H'+x(j+1)+' V'+y(j+1)).join('');
 let grid='';for(const i of [0,days/2,days])grid+='<path d="M50 '+y(i)+' H566" stroke="#202b48" stroke-dasharray="3 5"/><text x="0" y="'+(y(i)+3)+'">$'+(Math.round(daily*i*100)/100).toLocaleString('en-US')+'</text>';
 let ticks='';for(const i of [0,Math.floor(days/4),Math.floor(days/2),Math.floor(3*days/4),days])ticks+='<text x="'+x(i)+'" y="96" text-anchor="'+(i===days?'end':i===0?'start':'middle')+'">Day '+i+'</text>';
 $('plot').innerHTML='<svg role="img" aria-label="Projected wallet credits increase in '+days+' daily steps from zero to '+usd(daily*days)+'" viewBox="0 0 570 100" preserveAspectRatio="none"><defs><linearGradient id="area" x2="0" y2="1"><stop stop-color="#67e8fa" stop-opacity=".2"/><stop offset="1" stop-color="#67e8fa" stop-opacity=".01"/></linearGradient></defs><g fill="#95a0bb" font-family="monospace" font-size="9">'+grid+ticks+'</g><path d="M50 76'+line+' V77H50Z" fill="url(#area)"/><path d="M50 76'+line+'" fill="none" stroke="#76eafa" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
}
export function renderMetrics() {
  const facts = [
    ['USDC', 'on Base'],
    ['$12–$1,200', 'deposit range'],
    ['12% daily', 'payouts over 12 days'],
    ['12% daily', 'withdrawal cap'],
    ['12% + 1% daily', 'direct referral rewards']
  ];
  $('metrics').innerHTML = facts.map(([value, label]) =>
    '<div class="plan-fact"><strong>'+value+'</strong><span>'+label+'</span></div>'
  ).join('');
}
