import {element,link} from './cashier-api.js';
import {icon} from './ui.js';
import {cashier,cents,when,assetLabel,statusLabel,field,button,notice,bindForm,submitButton,makeDetails} from './manual-ui.js';

export async function mountManualCashier(panel,footer,initial='deposit',onBalance=()=>{}){
const screens={deposit:'Deposit',withdrawal:'Withdraw'};
const quoteKey='apex-manual-quote';
const drafts={deposit:{},withdrawal:{}};
const view=element('div',null,'manual-view wallet-steps');
const actions=element('nav',null,'manual-tabs wallet-cashier-tabs');
actions.setAttribute('aria-label','Cashier screens');
const summary=element('div',null,'manual-summary');
let account,options;
const keyFor=kind=>quoteKey+'-'+kind;
function readQuote(key){
 try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}
}
function savedQuote(kind){
 const quote=readQuote(keyFor(kind))||readQuote(quoteKey);
 return quote?.kind===kind&&quote.owner===account.userId?quote:null;
}
function saveQuote(quote){
 sessionStorage.setItem(keyFor(quote.kind),JSON.stringify(quote));
 const old=readQuote(quoteKey);
 if(old?.id===quote.id)sessionStorage.removeItem(quoteKey);
}
function clearQuote(quote){
 if(readQuote(keyFor(quote.kind))?.id===quote.id)sessionStorage.removeItem(keyFor(quote.kind));
 const old=readQuote(quoteKey);
 if(old?.id===quote.id)sessionStorage.removeItem(quoteKey);
}
function updateBalance(wallet){
 onBalance(cents(wallet.balance));
 summary.replaceChildren(makeDetails([['Withdrawal allowance today',cents(wallet.daily_remaining)],
  ...(wallet.held?[['Cashier status','On hold']]:[])]));
}

function startStep(content,kind,index,title){
 const steps=element('ol',null,'wallet-step-track');
 steps.setAttribute('aria-label',screens[kind]+' steps');
 ['Network','Amount','Review'].forEach((label,i)=>{
  const step=element('li',label);
  if(i===index)step.setAttribute('aria-current','step');
  steps.append(step);
 });
 const heading=element('h2',title);
 heading.tabIndex=-1;
 content.replaceChildren(steps,heading);
 footer.replaceChildren();
 footer.hidden=true;
 const form=element('form',null,'manual-form');
 form.id='manual-wallet-step';
 content.append(form);
 content.closest('.wallet-content').scrollTop=0;
 heading.focus({preventScroll:true});
 return form;
}
function stepActions(form,label,handler,back){
 const controls=element('div',null,'wallet-cashier-footer-actions');
 const backButton=back?button('Back',back):null;
 if(backButton)controls.append(backButton);
 const submit=element('button',label,'primary');
 submit.type='submit';
 submit.setAttribute('form',form.id);
 controls.append(submit);
 const feedback=notice();
 footer.replaceChildren(feedback,controls);
 footer.hidden=false;
 bindForm(form,submit,feedback,async()=>{
  if(backButton)backButton.disabled=true;
  try{await handler();}finally{if(backButton)backButton.disabled=false;}
 });
}
function showNetwork(content,kind){
 const form=startStep(content,kind,0,'Choose a coin and network');
 const draft=drafts[kind];
 const allowed=options.filter(item=>kind==='deposit'?item.deposit_enabled:(item.withdrawal_enabled??item.enabled));
 if(!allowed.length){
  form.append(element('p','No payment networks are configured. Contact the cashier administrator.','secondary'));
  return;
 }
 const asset=field(form,'Coin and network',{tag:'select',required:true});
 for(const item of allowed){
  const choice=element('option',assetLabel(item));
  choice.value=item.key;asset.append(choice);
 }
 if(allowed.some(item=>item.key===draft.asset))asset.value=draft.asset;
 stepActions(form,'Continue to amount',()=>{
  if(draft.asset!==asset.value)draft.address='';
  draft.asset=asset.value;
  showAmount(content,kind);
 });
}
function showAmount(content,kind){
 const deposit=kind==='deposit',draft=drafts[kind];
 const option=options.find(item=>item.key===draft.asset);
 const form=startStep(content,kind,1,deposit?'Deposit amount':'Withdrawal amount');
 form.append(element('p',assetLabel(option),'wallet-network-label'));
 const amount=field(form,deposit?'USD amount to credit':'USD amount to withdraw',{
  type:'number',step:'0.01',inputMode:'decimal',required:true,value:draft.amount||'',
  min:((deposit?option.min_deposit:option.min_withdraw)/100).toFixed(2),
  max:((deposit?option.max_deposit:option.max_withdraw)/100).toFixed(2)
 });
 const destination=deposit?null:field(form,'Your receiving address',{
  value:draft.address||'',required:true,maxLength:120,spellcheck:false,autocomplete:'off'
 });
 form.append(element('p','Limits '+cents(Number(amount.min)*100)+'–'+cents(Number(amount.max)*100)+' · Fee '+cents(deposit?0:option.withdrawal_fee)+
  (destination&&option.network==='dogecoin'?' · Use a legacy Base58Check address.':''),'secondary'));
 const remember=()=>{draft.amount=amount.value;draft.address=destination?.value||'';};
 stepActions(form,deposit?'Review deposit':'Review withdrawal',async()=>{
  remember();
  const quote=await cashier('quote',{kind,asset:draft.asset,amount:draft.amount,address:destination?.value});
  quote.owner=account.userId;
  if(!form.isConnected)return;
  saveQuote(quote);
  reviewQuote(content,quote);
 },()=>{remember();showNetwork(content,kind);});
}
function open(screen){
 for(const tab of actions.children)tab.setAttribute('aria-pressed',String(tab.dataset.screen===screen));
 const content=element('section');
 view.replaceChildren(content);
 const existing=savedQuote(screen);
 if(existing){
  drafts[screen]={asset:existing.option.key,amount:(existing.amount/100).toFixed(2),address:screen==='withdrawal'?existing.address:''};
  reviewQuote(content,existing);
 }else showNetwork(content,screen);
}

function addTransactionField(form,network){
 const solana=network==='solana';
 const type=solana?'Transaction signature':'Transaction ID (TxID)';
 const example=solana?'5mK4…yP8Q':(['ethereum','base','bsc'].includes(network)?'0x7c9a…42d1':'7c9a…42d1');
 const input=field(form,type,{required:true,maxLength:120,spellcheck:false,autocomplete:'off',
  placeholder:solana?'Paste the Solana signature':'Paste the transaction hash'});

 const banner=element('details',null,'cashier-tx-help');
 const summary=element('summary',null,'cashier-tx-banner');
 const symbol=element('span',null,'cashier-tx-symbol');
 symbol.innerHTML=icon('link');
 const intro=element('span',null,'cashier-tx-intro');
 const hint=element('span','Find it in the wallet or exchange you sent from.');
 hint.id='deposit-transaction-hint';
 input.setAttribute('aria-describedby',hint.id);
 intro.append(element('strong','Where to find your '+(solana?'transaction signature':'transaction ID')),hint);
 const chevron=element('span',null,'cashier-tx-chevron');
 chevron.setAttribute('aria-hidden','true');
 summary.append(symbol,intro,chevron);

 const guide=element('div',null,'cashier-tx-guide');
 const steps=element('ol',null,'cashier-tx-steps');
 for(const text of [
  'Open Activity or Withdrawal history.',
  'Select the transfer you just sent.',
  'Copy the full '+(solana?'signature':'transaction ID or hash')+' and paste it above.'
 ])steps.append(element('li',text));
 const receipt=element('div',null,'cashier-tx-example');
 const receiptTitle=element('div',null,'cashier-tx-example-title');
 receiptTitle.append(element('strong','Withdrawal details'),element('span','Example'));
 const idRow=element('div',null,'cashier-tx-example-row');
 const copyIcon=element('span');
 copyIcon.innerHTML=icon('copy');
 idRow.append(element('span',type),element('code',example),copyIcon);
 receipt.append(receiptTitle,idRow);
 guide.append(steps,receipt);
 banner.append(summary,guide);
 form.append(banner);
 return input;
}

function reviewQuote(content,quote){
 const deposit=quote.kind==='deposit';
 const {option}=quote;
 const form=startStep(content,quote.kind,2,deposit?'Review deposit':'Review withdrawal');
 form.append(makeDetails([['Network',assetLabel(option)],['Crypto '+(deposit?'to send':'to receive'),quote.crypto+' '+option.symbol],
  ['USD amount',cents(quote.amount)],['Fee',cents(quote.fee)],['USD '+(deposit?'credit':'deduction'),cents(quote.amount+quote.fee)],
  [quote.rate_source+' rate',quote.rate+' USD / '+option.symbol],['Quote expires',when(quote.expires)],
  [deposit?'Receiving address':'Your destination',element('code',quote.address)],
  ...(option.token?[['Token contract',element('code',option.token)]]:[])]));
 if(deposit){
  const copy=button('Copy receiving address',async()=>{
   try{await navigator.clipboard.writeText(quote.address);copy.textContent='Address copied';}
   catch{copy.textContent='Select and copy the address above';}
  });
  const canvas=element('canvas',null,'qr');canvas.setAttribute('aria-label','Receiving address QR code');
  const addressTools=element('div',null,'wallet-address-tools');
  addressTools.append(canvas,copy);
  form.append(addressTools,element('p','Use the displayed network and quoted crypto amount. If the quote expires, get a new quote before sending. If you already sent crypto and it confirms outside the quote window, submit the original transaction ID and contact Support for reconciliation.','secondary'));
  if(option.network==='xrpl')form.append(element('p','If your wallet or exchange requires a destination tag, contact Support before sending.','secondary'));
  import('./assets/receipt-qr.js').then(({toCanvas})=>toCanvas(canvas,quote.address,{width:144,margin:2})).catch(()=>{canvas.hidden=true;});
 }else form.append(element('p','Confirming reserves the USD deduction. The cashier sends the crypto after review.','secondary'));
 const tx=deposit?addTransactionField(form,option.network):null;
 if(tx){
  tx.value=quote.knownTx||'';
  tx.onchange=()=>{quote.knownTx=tx.value.trim();saveQuote(quote);};
 }
 stepActions(form,deposit?'Submit for review':'Confirm withdrawal',async()=>{
  if(tx){quote.knownTx=tx.value.trim();saveQuote(quote);}
  const request=await cashier('submit',{id:quote.id,tx:quote.knownTx});
  clearQuote(quote);
  if(form.isConnected){
   footer.replaceChildren();
   footer.hidden=true;
   const result=element('h2',statusLabel(request.status),'wallet-result');
   result.setAttribute('aria-live','polite');
   result.tabIndex=-1;
   content.replaceChildren(result,element('p','Request ID '+request.id,'secondary'),
    link('/profile#history','View wallet history','muted-button'));
   result.focus();
  }
  const wallet=await cashier('wallet').catch(()=>null);
  if(wallet&&panel.isConnected)updateBalance(wallet);
 },()=>{
  clearQuote(quote);
  const availability=options.find(option=>option.key===drafts[quote.kind].asset&&option.enabled);
  if(availability)showAmount(content,quote.kind);
  else showNetwork(content,quote.kind);
 });
}

const [profile,networks,wallet]=await Promise.all([cashier('me'),cashier('options'),cashier('wallet')]);
if(!panel.isConnected)return;
account=profile;
options=networks.options;
updateBalance(wallet);
for(const [key,label] of Object.entries(screens)){
 const tab=button(label,()=>open(key));tab.dataset.screen=key;actions.append(tab);
}
panel.replaceChildren(actions,summary,view);
open(Object.hasOwn(screens,initial)?initial:'deposit');
}
