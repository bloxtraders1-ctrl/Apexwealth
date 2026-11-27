import {api,element,link,explorer,savedKey,statuses} from './cashier-api.js';
import {cashier,cents,when,assetLabel,statusLabel,field,button,notice,bindForm,submitButton,makeDetails,transactionLink} from './manual-ui.js';

const accountBox=document.getElementById('profile-account');
const section=document.getElementById('history');
const rowsBox=document.getElementById('history-rows');
const actions=document.getElementById('history-actions');
const feedback=document.getElementById('history-feedback');
const activityLabels={
 deposit:'Deposit',withdrawal:'Withdrawal',investment:'Investment',
 'plan payout':'Daily plan credit','principal returned':'Principal returned',
 'first referral reward':'First investment referral commission',
 'daily referral reward':'Daily referral commission','reserve funding':'Reward reserve funding'
};

const balance=element('strong');
const creditPanel=element('div',null,'wallet-summary profile-next-credit');
const creditLabel=element('span');
const creditTimer=element('strong');
creditTimer.setAttribute('role','timer');
creditTimer.setAttribute('aria-label','Time until next wallet credit');
const creditDate=element('time',null,'secondary');
creditPanel.append(creditLabel,creditTimer,creditDate);
creditPanel.hidden=true;
let creditTimeout;
let options=[];
const next='?next='+encodeURIComponent('/profile');
async function start(){
 const status=await api('status');
 if(!status.signedIn){
  const signIn=element('div',null,'panel section-actions');
  signIn.append(link('/login'+next,'Log in','primary'),link('/register'+next,'Sign up','muted-button'));
  accountBox.replaceChildren(signIn);
  return;
 }
 const [account,me,networks]=await Promise.all([cashier('profile'),cashier('me'),cashier('options')]);
 options=networks.options;
 balance.textContent=cents(account.balance);
 const header=element('div',null,'panel profile-card');
 const info=element('div');
 const form=element('form',null,'manual-form');
 const name=field(form,'Account name',{required:true,minLength:2,maxLength:48,autocomplete:'nickname',value:account.name});
 const save=submitButton(form,'Save name'), message=notice();
 form.append(message);
 bindForm(form,save,message,async()=>{
  const result=await cashier('profile',{name:name.value});
  name.value=result.name;
  message.textContent='Your account name was saved.';
 });
 info.append(element('h2','Account details'),makeDetails([
  ...(account.email?[['Email',account.email]]:[]),['Account ID',account.userId]
 ]));
 if(status.mode==='selfhost'&&savedKey()){
  const copy=button('Copy account recovery key',async()=>{
   try{await navigator.clipboard.writeText(savedKey());copy.textContent='Recovery key copied';}
   catch{copy.textContent='Unable to copy recovery key';}
  });
  info.append(copy);
 }
 if(me.admin)info.append(link('/admin/cashier','Open admin cashier'));
 const wallet=element('div',null,'wallet-summary');
 wallet.append(element('span','Available USD'),balance);
 info.append(wallet,creditPanel);
 showNextCredit(account.nextCredit);
 header.append(form,info);
 accountBox.replaceChildren(header);
 section.hidden=false;
 await load(0);
 if(location.hash==='#history')section.scrollIntoView();
}

function showNextCredit(credit){
 clearTimeout(creditTimeout);
 creditPanel.hidden=!credit;
 if(!credit)return;
 creditLabel.textContent='Next daily wallet credit · '+cents(credit.amount);
 creditDate.textContent=when(credit.at);
 creditDate.dateTime=new Date(credit.at*1000).toISOString();
 const deadline=performance.now()+(credit.at-credit.now)*1000;
 const tick=()=>{
  const remaining=Math.ceil((deadline-performance.now())/1000);
  if(remaining<=0){
   creditTimer.textContent='Updating…';
   void refreshCredit();
   return;
  }
  const parts=[Math.floor(remaining/3600),Math.floor(remaining/60)%60,remaining%60];
  creditTimer.textContent=parts.map(part=>String(part).padStart(2,'0')).join(':');
  creditTimeout=setTimeout(tick,1000);
 };
 tick();
}

async function refreshCredit(){
 try{
  const account=await cashier('profile');
  balance.textContent=cents(account.balance);
  showNextCredit(account.nextCredit);
  window.dispatchEvent(new Event('apex-wallet-balance-changed'));
 }catch{
  creditTimeout=setTimeout(refreshCredit,5000);
 }
}

function requestTimeline(row){
 if(!row.timeline?.length)return null;
 const timeline=element('ol',null,'profile-timeline');
 timeline.setAttribute('aria-label','Request status timeline');
 for(const [index,entry] of row.timeline.entries()){
  const step=element('li');
  if(index===row.timeline.length-1)step.setAttribute('aria-current','step');
  const name={submitted:'Request submitted',broadcasting:'Approved for payout',sent:'Payout sent'}[entry.event]||statusLabel(entry.event);
  const date=element('time',when(entry.created));
  date.dateTime=new Date(entry.created*1000).toISOString();
  step.append(element('strong',name),date);
  timeline.append(step);
 }
 return timeline;
}

function makeCard(row){
 const card=element('article',null,'panel manual-card profile-entry');
 const legacy=row.kind.startsWith('Base');
 const option=options.find(item=>item.key===row.asset);
 const label=activityLabels[row.kind]||row.kind;
 const state=legacy?statuses[row.status]||row.status:({active:'Active',matured:'Matured',credited:'Credited'}[row.status]||statusLabel(row.status));
 const title=element('h3',label+(row.plan?' · Plan '+row.plan:''));
 const summary=element('div',null,'profile-entry-summary');
 summary.append(title,element('p',state,'secondary'),element('strong',cents(row.amount)));
 const details=element('details');
 details.append(element('summary',row.timeline?'Request timeline and details':'Details'));
 const timeline=requestTimeline(row);
 if(timeline)details.append(timeline);
 details.append(makeDetails([
  ['Date',when(row.created)],['Reference',row.id],
  ...(row.network?[['Coin and network',option?assetLabel(option):'USDC · '+row.network]]:[]),
  ...(row.crypto?[['Crypto amount',row.crypto+' '+(option?.symbol||'')]]:[]),
  ...(row.fee?[['Fee',cents(row.fee)]]:[]),
  ...(row.rate?[[row.rate_source+' rate',row.rate+' USD / '+(option?.symbol||'')]]:[]),
  ...(row.address?[['Receiving address',element('code',row.address)]]:[]),
  ...(row.tx?[['Transaction',legacy?explorer(row.tx):transactionLink(option,row.tx)]]:[]),
  ...(row.confirmations!=null?[['Confirmations',row.confirmations]]:[]),
  ...(row.updated?[['Updated',when(row.updated)]]:[]),
  ...(row.note?[['Review note',row.note]]:[])
 ]));
 card.append(summary,details);
 if(row.kind==='withdrawal'&&row.status==='pending'){
  card.append(recordAction('Cancel withdrawal',async()=>{await cashier('cancel',{id:row.id});balance.textContent=cents((await cashier('wallet')).balance);window.dispatchEvent(new Event('apex-wallet-balance-changed'));await load(0);}));
 }
 if(row.kind==='Base receipt'){
  if(row.status==='created')card.append(link('/deposit?asset=usdc-base','Submit transaction hash','muted-button'));
  if(row.status==='active')card.append(link('/withdraw?asset=usdc-base','Open Base withdrawal','muted-button'));
  if(['created','review','archived','refunded'].includes(row.status)){
   card.append(recordAction('Request refund review',async()=>{await api('refund-request',{id:row.id});await load(0);}));
  }
 }
 return card;
}

function recordAction(label,handler){
 const control=button(label,async()=>{
  control.disabled=true;
  feedback.textContent='';
  try{await handler();}
  catch(error){feedback.textContent=error.message;control.disabled=false;}
 });
 return control;
}

async function load(offset){
 const {rows,next:more}=await cashier('profile/history?offset='+offset);
 if(offset===0)rowsBox.replaceChildren();
 if(!rows.length&&offset===0)rowsBox.append(element('p','Your deposits, withdrawals, investments and credits will appear here.','secondary'));
 for(const row of rows)rowsBox.append(makeCard(row));
 actions.replaceChildren(recordAction('Refresh',()=>load(0)));
 rowsBox.querySelector('[data-history-more]')?.remove();
 if(more!==null){
  const loadMore=recordAction('Load older activity',()=>load(more));
  loadMore.dataset.historyMore='';
  rowsBox.append(loadMore);
 }
}

start().catch(error=>{
 if(section.hidden)accountBox.replaceChildren(element('p',error.message,'wallet-feedback'));
 else feedback.textContent=error.message;
});
