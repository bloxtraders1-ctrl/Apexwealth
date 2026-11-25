import {api,element,link,money,tokenAmount} from './cashier-api.js';

function field(form,title,input){
 const label=element('label',title);
 label.append(input);
 form.append(label);
 return input;
}

function handleSubmit(form,button,message,submit){
 form.onsubmit=async event=>{
  event.preventDefault();
  button.disabled=true;
  message.textContent='';
  try{await submit();}
  catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
 };
}

function feedback(){
 const message=element('p',null,'wallet-feedback');
 message.setAttribute('role','status');
 return message;
}

function baseReceiptForm(details,row,onChange){
 if(row.stage==='review'){
  details.replaceChildren(element('h3','USDC on Base'),element('p','Transfer submitted. The cashier will review it before activating your plan.','secondary'),link('/profile#history','View account history'));
  return;
 }
 const address=element('code',row.receiver);
 const copy=element('button','Copy address','muted-button');
 copy.type='button';
 const message=feedback();
 copy.onclick=async()=>{
  try{await navigator.clipboard.writeText(row.receiver);message.textContent='Deposit address copied.';}
  catch{message.textContent='Select the address to copy it.';}
 };
 details.replaceChildren(
  element('h3','USDC on Base'),
  element('p','Send exactly '+tokenAmount(row.amount)+' USDC from your wallet or exchange on the Base network.','secondary'),
  address,copy
 );
 const form=element('form',null,'wallet-form');
 const input=element('input',null,'field');
 input.placeholder='0x…';
 input.pattern='0x[0-9a-fA-F]{64}';
 input.required=true;
 field(form,'Transaction hash',input);
 const submit=element('button','Submit deposit request','primary');
 form.append(submit,message);
 handleSubmit(form,submit,message,async()=>{
  await api('proof',{id:row.id,tx:input.value.trim()});
  baseReceiptForm(details,{...row,stage:'review'},onChange);
  onChange();
 });
 const archive=element('button','Archive unused receipt','muted-button');
 archive.type='button';
 archive.onclick=async()=>{
  archive.disabled=true;
  try{await api('archive',{id:row.id});await showDeposit(details,onChange);}
  catch(error){message.textContent=error.message;archive.disabled=false;}
 };
 details.append(form,archive);
}

export async function showDeposit(details,onChange){
 const data=await api('portfolio');
 const pending=data.receipts.find(row=>['created','review'].includes(row.stage));
 if(pending){baseReceiptForm(details,pending,onChange);return;}
 details.append(element('p','Existing Base receipts can be finished here. To fund your balance, use the USD wallet.','secondary'));
}

export async function showWithdraw(details,onChange){
 const data=await api('portfolio');
 const active=data.receipts.filter(row=>row.stage==='active');
 if(!active.length){details.append(element('p','There is no active plan with funds available to withdraw.','secondary'));return;}
 const states=await Promise.all(active.map(row=>api('sync',{id:row.id}).catch(()=>null)));
 const latest=(await api('portfolio')).withdrawals;
 for(const [index,row] of active.entries()){
  const card=element('section',null,'wallet-withdrawal');
  const state=states[index];
  const pending=latest.find(item=>item.receipt===row.id&&item.stage==='review');
  const message=feedback();
  card.append(element('h4','Plan '+row.plan_id),element('p',state?'Available: '+money(state.available):'Balance temporarily unavailable.','secondary'));
  details.append(card);
  if(pending){
   card.append(element('p',money(pending.amount)+' awaiting approval','secondary'),element('code',pending.destination||row.payout));
   continue;
  }
  if(!Number(state?.available))continue;
  const form=element('form',null,'wallet-form');
  const amount=element('input',null,'field');
  amount.type='number';amount.min='0.000001';amount.step='0.000001';
  amount.max=tokenAmount(state.available);amount.value=amount.max;amount.required=true;
  field(form,'Withdrawal amount (USD)',amount);
  const destination=element('input',null,'field');
  destination.placeholder='0x…';
  destination.pattern='0x[0-9a-fA-F]{40}';destination.required=true;
  if(row.contract_version>=5)field(form,'Send USDC on Base to',destination);
  else{
   destination.value=row.payout;
   card.append(element('p','Original address for this older receipt','secondary'),element('code',row.payout));
  }
  const submit=element('button','Request withdrawal','primary');
  form.append(submit,message);
  handleSubmit(form,submit,message,async()=>{
   const request=await api('withdraw',{id:row.id,amount:amount.value,destination:destination.value.trim()});
   form.replaceWith(element('p',money(request.amount)+' awaiting approval','secondary'),element('code',request.destination));
   onChange();
  });
  card.append(form);
 }
}
