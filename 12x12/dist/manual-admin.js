import {mountSupport} from './support-ui.js';
import {element,link} from './cashier-api.js';
import {cashier,cents,when,assetLabel,statusLabel,field,button,notice,bindForm,submitButton,makeDetails,transactionLink,appendPager} from './manual-ui.js';

const root=document.getElementById('manual-admin');
const view=element('section',null,'manual-view');
const tabs=element('nav',null,'manual-tabs');
const sections={deposit:'Deposit queue',withdrawal:'Withdrawal queue',users:'Users',support:'Support tickets',settings:'Networks and limits'};
let options;

async function start(){
 ({options}=await cashier('admin/options'));
 for(const [id,title] of Object.entries(sections)){
  const tab=button(title,()=>open(id));tab.dataset.section=id;tabs.append(tab);
 }
 root.replaceChildren(tabs,view);
 const tab=new URLSearchParams(location.search).get('tab');
 await open(Object.hasOwn(sections,tab)?tab:'deposit');
}
async function open(section){
 for(const tab of tabs.children)tab.setAttribute('aria-pressed',String(tab.dataset.section===section));
 const content=element('div');
 view.replaceChildren(content);
 try{
  if(section==='settings'){
   await showSettings(content);
   if(location.hash==='#investment-reserve')document.getElementById('investment-reserve')?.scrollIntoView();
  }
  else if(section==='users')await users(content);
  else if(section==='support')await mountSupport(content,{admin:true});
  else await queue(content,section,'open');
 }catch(error){content.replaceChildren(element('p',error.message,'wallet-feedback'));}
}
async function audit(id,details){
 try{
  const {rows}=await cashier('admin/audit?id='+encodeURIComponent(id));
  const list=element('ol',null,'manual-audit');
  for(const entry of rows){
   const item=element('li');
   item.append(element('strong',entry.event+' · '+when(entry.created)),element('p','Actor '+entry.actor,'secondary'));
   if(entry.detail)item.append(element('pre',JSON.stringify(JSON.parse(entry.detail),null,2)));
   list.append(item);
  }
  details.append(list);
 }catch(error){details.append(element('p',error.message,'wallet-feedback'));}
}

function auditDetails(id){
 const details=element('details',null,'manual-action');
 details.append(element('summary','Audit history'));
 let loaded=false;
 details.ontoggle=()=>{
  if(details.open&&!loaded){loaded=true;audit(id,details);}
 };
 return details;
}

function reviewButtons(row,controls,article,actions,onReviewed){
 const feedback=notice();
 const buttons=[];
 for(const [action,label,note] of actions){
  buttons.push(button(label,async()=>{
   for(const control of buttons)control.disabled=true;
   feedback.textContent='';
   try{
    const result=await cashier('admin/review',{id:row.id,action,note});
    await onReviewed(result);
   }catch(error){feedback.textContent=error.message;}
   finally{for(const control of buttons)control.disabled=false;}
  },buttons.length===0?'primary':undefined));
 }
 controls.append(...buttons);
 article.append(feedback);
 return feedback;
}

function fillRequestDetails(details,row,option,kind,openUser){
 details.replaceChildren(element('summary','Details'),
  makeDetails([['Request ID',row.id],['User ID',row.user_id],['Account login',row.username],
   ['Coin and network',assetLabel(option)],['Expected crypto',row.crypto+' '+option.symbol],['Fee',cents(row.fee)],
   ['USD '+(kind==='deposit'?'credit':'deduction'),cents(row.amount+row.fee)],
   [row.rate_source+' rate',row.rate+' USD / '+option.symbol],['Address',element('code',row.address)],
   ['Token contract',option.token||'Native asset'],['Transaction',transactionLink(option,row.tx)],
   ...(['approved','completed'].includes(row.status)&&row.confirmations==null
    ?[['Approval method','Manual cashier decision']]
    :[['Transfer index',row.transfer_index],['Confirmations',row.confirmations]]),
   ['Quote expires',when(row.expires)],['Submitted',when(row.created)],['Updated',when(row.updated)],['Review notes',row.note]]),
  button('View user',openUser),auditDetails(row.id));
}

function payoutForm(row,option,after){
 const form=element('form',null,'manual-form');
 form.append(makeDetails([['Coin and network',assetLabel(option)],['Amount to send',row.crypto+' '+option.symbol],
  ['Destination',element('code',row.address)]]));
 form.append(element('p','Check your wallet history before sending. If you already sent this payout, use its existing transaction ID.','secondary'));
 const tx=field(form,'Payout transaction ID',{required:true,maxLength:120,spellcheck:false});
 const submit=submitButton(form,'Approve'), feedback=notice();form.append(feedback);
 bindForm(form,submit,feedback,async()=>{
  await cashier('admin/review',{id:row.id,action:'completeManualWithdrawal',tx:tx.value.trim()});
  await after();
 });
 return form;
}

async function queue(content,kind,scope,last,criteria={}){
 const query=new URLSearchParams({kind,status:scope});
 if(criteria.network)query.set('network',criteria.network);
 if(criteria.search)query.set('q',criteria.search);
 if(last){query.set('before',last.created);query.set('cursor',last.id);}
 const {rows}=await cashier('admin/queue?'+query);
 const filters=element('form',null,'cashier-queue-filters');
 const search=field(filters,'Search requests',{type:'search',maxLength:120,value:criteria.search||'',placeholder:'Email, request ID or transaction hash'});
 const network=field(filters,'Network',{tag:'select'});
 const status=field(filters,'Status',{tag:'select'});
 for(const [value,label] of [['','All networks'],...[...new Set(options.map(asset=>asset.network))].sort().map(n=>[n,n[0].toUpperCase()+n.slice(1)])]){
  const choice=element('option',label);choice.value=value;network.append(choice);
 }
 network.value=criteria.network||'';
 const states=kind==='deposit'?['pending','approved','rejected']:['pending','processing','broadcasting','sent','completed','rejected','cancelled'];
 for(const [value,label] of [['open','Open requests'],['closed','Closed requests'],['all','All statuses'],...states.map(state=>[state,statusLabel(state)])]){
  const choice=element('option',label);choice.value=value;status.append(choice);
 }
 status.value=scope;
 const apply=submitButton(filters,'Apply filters');
 const alert=notice();
 bindForm(filters,apply,alert,()=>queue(content,kind,status.value,null,{search:search.value.trim(),network:network.value}));
 content.replaceChildren(element('h2',sections[kind]),filters,alert);
 if(!rows.length)content.append(element('p','No requests match these filters.','secondary'));
 const reload=()=>queue(content,kind,scope,last,criteria);
 for(const row of rows){
  const option=options.find(item=>item.key===row.asset);
  const article=element('article',null,'panel manual-card cashier-request');
  const controls=element('div',null,'cashier-request-controls');
  const heading=element('div',null,'cashier-request-heading');
  const details=element('details',null,'manual-action cashier-request-details');
  const openUser=()=>userProfile(content,row.user_id,reload).catch(error=>alert.textContent=error.message);
  heading.append(element('h3',cents(row.amount)),controls);
  article.append(heading);
  if(kind==='deposit'){
   const showDecision=(status,focus=false)=>{
    const decision=element('strong',status==='approved'?'Approved':statusLabel(status),'cashier-request-status');
    decision.dataset.status=status;
    decision.tabIndex=-1;
    controls.replaceChildren(decision);
    if(focus)decision.focus();
   };
   if(row.status==='pending'){
    const feedback=reviewButtons(row,controls,article,[
     ['approveManualDeposit','Approve'],['rejectDeposit','Reject','Deposit rejected by cashier.']
    ],result=>{
     const resolved={...row,...result};
     feedback.remove();
     showDecision(resolved.status,true);
     fillRequestDetails(details,resolved,option,kind,openUser);
    });
   }else showDecision(row.status);
  }else{
   controls.append(element('span',statusLabel(row.status),'cashier-request-status'));
   if(['pending','processing'].includes(row.status)){
    reviewButtons(row,controls,article,[
     ['approveWithdrawal','Start payout','Cashier started the payout.'],
     ['rejectWithdrawal','Reject','Withdrawal rejected by cashier.']
    ],reload);
   }
   if(row.status==='broadcasting')article.append(payoutForm(row,option,reload));
   if(row.status==='sent')reviewButtons(row,controls,article,[['completeManualWithdrawal','Approve']],reload);
  }
  fillRequestDetails(details,row,option,kind,openUser);
  article.append(details);
  content.append(article);
 }
 appendPager(content,rows,row=>queue(content,kind,scope,row,criteria).catch(error=>alert.textContent=error.message));
}

async function users(content,search='',after=''){
 const params=new URLSearchParams({q:search,after});
 const {rows}=await cashier('admin/users?'+params);
 const form=element('form',null,'manual-form');
 const input=field(form,'Find a user',{value:search,maxLength:120,placeholder:'Email, existing username, or account ID'});
 const submit=submitButton(form,'Search');
 const message=notice();form.append(message);
 bindForm(form,submit,message,()=>users(content,input.value.trim()));
 content.replaceChildren(element('h2','Users'),form);
 if(!rows.length)content.append(element('p','No matching accounts.','secondary'));
 for(const row of rows){
  const card=element('article',null,'panel manual-card');
  card.append(element('h3',row.username||row.id),makeDetails([
   ['Account ID',row.id],['Available USD',cents(row.balance)],['Cashier',row.held?'On hold':'Active']
  ]),button('Open account',()=>userProfile(content,row.id,()=>users(content,search,after)).catch(error=>message.textContent=error.message)));
  content.append(card);
 }
 if(rows.length===50)content.append(button('Next accounts',()=>users(content,search,rows.at(-1).id).catch(error=>message.textContent=error.message)));
}

function activitySection(title,rows,describe){
 const details=element('details',null,'manual-action');
 details.append(element('summary',title+' · '+rows.length+(rows.length===50?' latest':'')));
 if(!rows.length)details.append(element('p','No records.','secondary'));
 for(const row of rows)details.append(makeDetails(describe(row)));
 return details;
}

async function userProfile(content,id,back){
 const {account,requests,receipts,legacyWithdrawals,ledger}=await cashier('admin/user?id='+encodeURIComponent(id));
 const form=element('form',null,'manual-form panel');
 const reason=field(form,'Reason',{tag:'textarea',required:true,minLength:5,maxLength:1000});
 const submit=submitButton(form,account.held?'Resume manual cashier':'Put manual cashier on hold');
 const message=notice();
 form.append(element('p','A hold stops new quotes, withdrawal reservations and payouts before broadcast. Deposits already sent and payouts already in flight can still be reconciled.','secondary'),message);
 bindForm(form,submit,message,async()=>{
  await cashier('admin/user-control',{id,held:!account.held,note:reason.value});
  await userProfile(content,id,back);
 });
 content.replaceChildren(button('Back to list',()=>back().catch(error=>message.textContent=error.message)),element('h2',account.username||account.id),
  makeDetails([['User ID',account.id],['Available USD',cents(account.balance)],['Reserved withdrawals',cents(account.reserved)],
   ['Recorded Base principal',cents(account.principal/10000)],['Cashier status',account.held?'On hold':'Active'],['Latest reason',account.note]]),
  form,auditDetails('user:'+id),
  activitySection('Manual requests',requests,row=>{
   const option=options.find(item=>item.key===row.asset);
   return [['Request',row.id],['Type',row.kind],['Status',statusLabel(row.status)],['USD amount',cents(row.amount)],
    ['Network',row.network],['Transaction',transactionLink(option,row.tx)],['Created',when(row.created)]];
  }),
  activitySection('Base investment receipts',receipts,row=>[['Receipt',row.id],['Plan',row.plan_id],['Principal',cents(row.amount/10000)],
   ['Status',row.stage],['Transaction',transactionLink(options.find(item=>item.key==='usdc-base'),row.tx)],['Created',when(row.created)]]),
  activitySection('Base withdrawals',legacyWithdrawals,row=>[['Request',row.id],['Amount',cents(row.amount/10000)],['Status',row.stage],
   ['Destination',row.destination],['Created',when(row.created)]]),
  activitySection('USD ledger',ledger,row=>[['Request',row.request_id],['Event',row.event],['Change',cents(row.delta)],['Recorded',when(row.created)]]));
}

async function showSettings(content){
 const [settings,reserve]=await Promise.all([cashier('admin/options'),cashier('admin/reward-reserve')]);
 options=settings.options;
 content.replaceChildren(element('h2','Networks and limits'),
  element('p','Set real addresses in this panel. Disabled networks do not issue quotes. Verify custody and USD quote support before enabling a network.','secondary'));
 const policy=element('form',null,'manual-form panel');
 const cap=field(policy,'Daily withdrawal cap (% of recorded funded principal)',{type:'number',min:0,max:100,step:.01,value:String(settings.daily_bps/100),required:true});
 const savePolicy=submitButton(policy,'Save daily cap'), policyMessage=notice();
 policy.append(policyMessage);
 bindForm(policy,savePolicy,policyMessage,async()=>{
  await cashier('admin/policy',{daily_bps:Math.round(Number(cap.value)*100)});
  policyMessage.textContent='Daily cap saved.';
 });
 const reserveForm=element('form',null,'manual-form panel');
 reserveForm.id='investment-reserve';
 const available=element('strong');
 const walletFunds=element('strong');
 const readiness=element('p',null,'secondary');
 const reserveSummary=makeDetails([['Available reward reserve',available],['Your approved USD wallet balance',walletFunds]]);
 const updateReserve=(reserveBalance,walletBalance)=>{
  available.textContent=cents(reserveBalance);
  walletFunds.textContent=cents(walletBalance);
  const shortfall=reserve.minimum-reserveBalance;
  readiness.textContent=shortfall>0
   ?'Add '+cents(shortfall)+' more to cover one minimum Plan 1 investment without a referral commission.'
   :'The reserve covers at least one minimum Plan 1 investment without a referral commission.';
 };
 updateReserve(reserve.available,reserve.wallet);
 reserveForm.append(element('h3','Investment reward reserve'),reserveSummary,readiness,
  element('p','Transfers approved USD from your wallet to fund plan credits and referral commissions. Funding the reserve is final.','secondary'));
 const amount=field(reserveForm,'Amount to transfer (USD)',{type:'number',min:.01,step:.01,max:1000000,required:true});
 const fund=submitButton(reserveForm,'Fund reward reserve'),reserveFeedback=notice();
 reserveForm.append(reserveFeedback);
 let pending;
 bindForm(reserveForm,fund,reserveFeedback,async()=>{
  const value=Number(amount.value).toFixed(2);
  if(pending?.amount!==value)pending={id:crypto.randomUUID(),amount:value};
  const result=await cashier('admin/reward-reserve',pending);
  updateReserve(result.available,result.wallet);
  reserveFeedback.textContent=cents(Number(value)*100)+' transferred. Your wallet balance is '+cents(result.wallet)+'.';
  amount.value='';pending=null;
  window.dispatchEvent(new Event('apex-wallet-balance-changed'));
 });
 const paymentOptions=element('p',null,'secondary');
 const updatePaymentStatus=()=>{
  const names=options.filter(option=>option.deposit_enabled).map(assetLabel);
  paymentOptions.textContent=names.length?'Configured for deposits: '+names.join(', ')+'.':'No deposit network is configured. Save a receiving address and enable a network below.';
 };
 updatePaymentStatus();
 const importForm=element('form',null,'manual-form panel');
 importForm.append(element('h3','Import receiving addresses'),
  element('p','This replaces the listed receiving addresses and enables them for new deposits. Existing quotes, limits and fees are preserved. XRP supports deposits only.','secondary'));
 const file=field(importForm,'Receiving-address file',{type:'file',accept:'.json,application/json',required:true});
 const importButton=submitButton(importForm,'Import and enable'), importFeedback=notice();
 importForm.append(importFeedback);
 bindForm(importForm,importButton,importFeedback,async()=>{
  const selected=file.files[0];
  if(!selected||selected.size>4096)throw Error('Choose a receiving-address JSON file under 4 KB.');
  let addresses;
  try{addresses=JSON.parse(await selected.text());}
  catch{throw Error('Choose a valid receiving-address JSON file.');}
  const {active}=await cashier('admin/receiving-addresses',{addresses});
  file.value='';
  try{
   await showSettings(content);
   content.querySelector('input[type=file]')?.closest('form')?.querySelector('[role=status]')?.replaceChildren(active+' receiving addresses enabled.');
  }catch{
   importFeedback.textContent=active+' receiving addresses enabled. Reload this page to see the updated settings.';
  }
 });
 content.append(paymentOptions,importForm,reserveForm,policy,auditDetails('policy'));
 for(const option of options){
  const form=element('form',null,'manual-form panel manual-option');
  form.append(element('h3',assetLabel(option)));
  const address=field(form,'Receiving address',{value:option.address,maxLength:120,spellcheck:false});
  const enabled=field(form,option.network==='xrpl'?'Accept deposits':'Accept transfers',{type:'checkbox',checked:option.enabled});
  const numeric={};
  for(const [key,label] of [['min_deposit','Minimum deposit'],['max_deposit','Maximum deposit'],['min_withdraw','Minimum withdrawal'],['max_withdraw','Maximum withdrawal'],['withdrawal_fee','Flat withdrawal fee']]){
   numeric[key]=field(form,label+' (USD)',{type:'number',min:key==='withdrawal_fee'?0:.01,max:1000000,step:.01,value:(option[key]/100).toFixed(2),required:true});
  }
  const submit=submitButton(form,'Save '+option.symbol+' settings'),feedback=notice();form.append(feedback);
  bindForm(form,submit,feedback,async()=>{
   const body={asset:option.key,address:address.value,enabled:enabled.checked,confirmations:option.confirmations};
   for(const [key,input] of Object.entries(numeric))body[key]=Math.round(Number(input.value)*100);
   await cashier('admin/options',body);
   ({options}=await cashier('admin/options'));
   updatePaymentStatus();
   feedback.textContent='Network settings saved.';
  });
  content.append(form,auditDetails('option:'+option.key));
 }
}

start().catch(error=>{
 root.replaceChildren(element('p',error.message,'wallet-feedback'),
  link('/login?next='+encodeURIComponent('/admin/cashier'),'Log in','primary'),link('/cashier','Open account details'));
});
