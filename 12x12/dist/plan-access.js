import {element,link} from './cashier-api.js';
import {cashier,cents,field,button,bindForm,submitButton,notice,makeDetails} from './manual-ui.js';
import {tiers} from './tiers.js';

const dialog=element('dialog',null,'wallet-dialog invest-dialog');
const title=element('h2');
title.id='invest-title';
dialog.setAttribute('aria-labelledby',title.id);
const header=element('header',null,'wallet-head');
const close=button('×',()=>dialog.close(),'wallet-close');
close.setAttribute('aria-label','Close investment');
header.append(title,close);
const panel=element('div',null,'wallet-content');
dialog.append(header,panel);
document.body.append(dialog);

let access;
function referralParams(){
 return {referral:sessionStorage.getItem('apex-wallet-referral'),legacyReferral:sessionStorage.getItem('apex-ref')};
}
function loadAccess(){
 return cashier('invest');
}
const accessRequest=loadAccess().then(value=>access=value).catch(()=>null);
const availabilityMessages={
 hold:'Your wallet is on hold. Contact the cashier administrator.'
};
function availabilityMessage(tier){
 const state=access?.eligibility[tier.id];
 if(state==='referrals'){
  const remaining=tier.referrals-access.fundedReferrals;
  return 'Requires '+remaining+' more funded direct '+(remaining===1?'referral.':'referrals.');
 }
 if(state==='balance')return 'Add '+cents(tier.min*100-access.balance)+' to your approved wallet balance to reach the minimum.';
 return availabilityMessages[state]||'';
}
function updateCards(){
 for(const tier of tiers){
  const note=document.querySelector('[data-plan-availability="'+tier.id+'"]');
  const message=access?.eligibility[tier.id]==='referrals'?'':availabilityMessage(tier);
  note.textContent=message;
  note.hidden=!message;
 }
 for(const tier of tiers.filter(plan=>plan.referrals)){
  const status=document.querySelector('[data-tier-lock="'+tier.id+'"]');
  const control=document.querySelector('[data-invest="'+tier.id+'"]');
  const eligible=access?.fundedReferrals>=tier.referrals;
  control.hidden=!eligible;
  status.hidden=eligible;
  const progress=access?Math.min(access.fundedReferrals,tier.referrals)+' of '+tier.referrals+' funded referrals on your account':'Requires '+tier.referrals+' funded direct referrals';
  status.textContent='Locked · '+progress;
 }
}

async function open(tier){
 title.textContent='Invest in Plan '+tier.id;
 panel.replaceChildren(element('p','Checking your USD wallet…','secondary'));
 dialog.showModal();
 let walletPolicy,networks;
 try{
  [access,walletPolicy,networks]=await Promise.all([loadAccess(),cashier('wallet'),cashier('options')]);
  updateCards();
 }
 catch(error){
  panel.replaceChildren(element('p',error.message,'secondary'));
  if(error.status===401)panel.append(link('/login?next='+encodeURIComponent('/plan?invest='+tier.id),'Log in','primary'));
  return;
 }
 if(!dialog.open)return;
 const wallet=element('div',null,'wallet-summary');
 wallet.append(element('span','Available USD'),element('strong',cents(access.balance)));
 panel.replaceChildren(wallet,planTerms(tier,walletPolicy,networks));
 const key='apex-wallet-invest-'+access.userId+'-'+tier.id;
 const saved=JSON.parse(sessionStorage.getItem(key)||'null');
 if(saved){panel.append(retryInvest(saved,key),link('/profile#history','Check account history','muted-button'));return;}
 const reason=availabilityMessage(tier);
 if(reason){
  panel.append(element('p',reason,'wallet-feedback'));
  const state=access.eligibility[tier.id];
  if(state==='balance'){
   const deposit=link('/deposit','Open wallet to deposit','muted-button');
   deposit.addEventListener('click',()=>dialog.close());
   panel.append(deposit);
  }
  if(state==='referrals')panel.append(link('/referrals','View referral progress','muted-button'));
  return;
 }
 const form=element('form',null,'manual-form');
 form.append(element('p',tier.rate+'% daily for '+tier.days+' days · Investment limits '+cents(tier.min*100)+'–'+cents(tier.max*100),'secondary'));
 form.append(element('p','Daily credits post to your USD wallet. The cashier sends crypto withdrawals separately.','secondary'));
 const amount=field(form,'Investment amount (USD)',{type:'number',min:tier.min,max:Math.min(tier.max,access.balance/100),step:0.01,required:true,inputMode:'decimal'});
 const submit=submitButton(form,'Confirm investment'), feedback=notice();
 form.append(feedback);
 panel.append(form);
 bindForm(form,submit,feedback,async()=>{
  const value=Number(amount.value).toFixed(2);
  const payload={id:crypto.randomUUID(),amount:value,plan:tier.id,...referralParams()};
  await submitInvestment(payload,key);
 });
}

function planTerms(tier,wallet,networks){
 const formatter=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
 const date=day=>formatter.format(new Date((access.startDay+day)*86400000));
 const fees=networks.options.filter(option=>option.withdrawal_enabled).map(option=>option.withdrawal_fee);
 const low=Math.min(...fees),high=Math.max(...fees);
 const feeText=fees.length?cents(low)+(high===low?'':'–'+cents(high)+' depending on network'):'No active withdrawal network';
 const terms=element('section',null,'invest-terms');
 terms.append(element('h3','If opened today'),makeDetails([
  ['Daily credits',date(1)+' to '+date(tier.days)+' at 00:00 UTC'],
  ['Invested principal',access.separate?'Released on '+date(tier.days):'Included in scheduled credits'],
  ['Daily withdrawal cap',(wallet.daily_bps/100)+'% of recorded invested principal, including fees'],
  ['Withdrawal allowance today',cents(wallet.daily_remaining)],
  ['Plan fee',cents(0)],['Withdrawal fee',feeText]
 ]));
 return terms;
}

function retryInvest(saved,key){
 const form=element('form',null,'manual-form');
 form.dataset.retry='';
 form.append(element('p','There is an unfinished '+cents(Number(saved.amount)*100)+' request. Check its result or retry it with the same request ID.','secondary'));
 const retry=submitButton(form,'Resume investment'),feedback=notice();
 form.append(feedback,button('Clear this retry',()=>{sessionStorage.removeItem(key);dialog.close();}));
 bindForm(form,retry,feedback,()=>submitInvestment(saved,key));
 return form;
}

async function submitInvestment(payload,key){
 sessionStorage.setItem(key,JSON.stringify(payload));
 try{
  const result=await cashier('invest',payload);
  sessionStorage.removeItem(key);
  window.dispatchEvent(new Event('apex-wallet-balance-changed'));
  panel.replaceChildren(element('h3','Investment opened'),
   element('p',cents(result.amount)+' invested in Plan '+result.plan+'. Your first daily credit is scheduled for 00:00 UTC.','secondary'),
   link('/profile#history','View investment history','primary'));
 }catch(error){
  if(error.status>=400&&error.status<500)sessionStorage.removeItem(key);
  else if(dialog.open&&!panel.querySelector('[data-retry]')){
   const retry=retryInvest(payload,key);
   retry.dataset.retry='';
   panel.replaceChildren(retry,link('/profile#history','Check account history','muted-button'));
  }
  throw error;
 }
}

function launch(tier){
 open(tier).catch(error=>panel.replaceChildren(element('p',error.message,'wallet-feedback')));
}
for(const tier of tiers)document.querySelector('[data-invest="'+tier.id+'"]').onclick=()=>launch(tier);
await accessRequest;
updateCards();
const url=new URL(location.href);
const requested=tiers.find(tier=>String(tier.id)===url.searchParams.get('invest'));
if(requested&&access){
 url.searchParams.delete('invest');
 history.replaceState(null,'',url);
 launch(requested);
}
