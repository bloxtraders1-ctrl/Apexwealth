import {api,element,link,money} from './cashier-api.js';
import {icon} from './ui.js';
import {mountManualCashier} from './manual-user.js';
import {showDeposit,showWithdraw} from './wallet-transfer.js';

export function createWalletControl(status){
 const trigger=element('button',null,'wallet-trigger');
 trigger.type='button';
 trigger.setAttribute('aria-haspopup','dialog');
 trigger.setAttribute('aria-label','Open wallet');
 const balance=element('span','—','wallet-balance');
 const wallet=element('span',null,'wallet-symbol');
 wallet.innerHTML=icon('wallet');
 trigger.append(balance,wallet);

 const dialog=element('dialog',null,'wallet-dialog');
 dialog.setAttribute('aria-labelledby','wallet-title');
 const head=element('header',null,'wallet-head');
 const title=element('h2','Wallet');
 title.id='wallet-title';
 const heading=element('div',null,'wallet-heading');
 heading.append(title);
 const close=element('button','×','wallet-close');
 close.type='button';
 close.setAttribute('aria-label','Close wallet');
 close.onclick=()=>dialog.close();

 const summary=element('div',null,'wallet-summary');
 const label=element('span','Available USD');
 const total=element('strong','—');
 summary.append(label,total);
 head.append(heading,summary,close);
 const content=element('div',null,'wallet-content');
 const footer=element('div',null,'wallet-cashier-footer');
 footer.hidden=true;
 dialog.append(head,content,footer);
 let source;
 let revision=0;

 function showBalance(value){
  balance.textContent=value;
  trigger.setAttribute('aria-label','Open wallet, '+value+' available USD');
 }
 function refreshHeader(){api('manual/wallet').then(result=>showBalance(money(result.balance*10000))).catch(()=>{});}
 if(status.signedIn){
  refreshHeader();
  window.addEventListener('apex-wallet-balance-changed',refreshHeader);
  window.addEventListener('pageshow',event=>{if(event.persisted)refreshHeader();});
 }

 function login(direction,query){
  const target=new URL(location.pathname,location.origin);
  target.search=location.search;
  target.searchParams.set('wallet',direction.toLowerCase());
  for(const key of ['asset','plan','ref']){
   if(query?.has(key))target.searchParams.set(key,query.get(key));
  }
  content.replaceChildren(element('p','Log in to use your wallet.','secondary'),
   link('/login?next='+encodeURIComponent(target.pathname+target.search),'Log in','primary'));
 }

 async function open(direction='Deposit',query,opener=trigger){
  const request=++revision;
  const base=query?.get('asset')==='usdc-base'&&!query.has('ref')&&!query.has('plan');
  source=opener;
  title.textContent=base?'Base investment wallet':'Wallet';
  total.textContent='—';
  label.textContent=base?'Base withdrawal balance':'Available USD';
  content.replaceChildren();
  footer.replaceChildren();
  footer.hidden=true;
  if(!dialog.open)dialog.showModal();
  if(!status.signedIn){login(direction,query);return;}
  const panel=element('section');
  const loading=element('p','Loading wallet…','secondary');
  content.append(loading,panel);
  try{
   if(base){
    const readiness=await api('settlement-status');
    if(!readiness.withdrawalReady)throw Error('The Base cashier is currently unavailable.');
    const refresh=async()=>{
     const result=await api('wallet-balance');
     if(request===revision)total.textContent=money(result.available);
    };
    await refresh();
    const back=element('button','← USD wallet','muted-button');back.type='button';
    back.onclick=()=>open(direction);
    panel.append(back);
    const form=element('div');
    panel.append(form);
    if(direction==='Withdraw')await showWithdraw(form,refresh);
    else await showDeposit(form,refresh);
   }else{
    await mountManualCashier(panel,footer,direction==='Withdraw'?'withdrawal':'deposit',value=>{
     if(request!==revision)return;
     showBalance(value);
     total.textContent=value;
    });
   }
  }catch(error){
   if(request===revision)panel.replaceChildren(element('p',error.message,'wallet-feedback'));
  }finally{loading.remove();}
 }

 dialog.onclick=event=>{if(event.target===dialog)dialog.close();};
 dialog.addEventListener('close',()=>{
  revision++;
  content.replaceChildren();
  footer.replaceChildren();
  footer.hidden=true;
  const url=new URL(location.href);
  if(url.searchParams.has('wallet')){
   for(const key of ['wallet','asset','plan','ref'])url.searchParams.delete(key);
   history.replaceState(null,'',url);
  }
  if(source?.isConnected)source.focus();
 });
 document.body.append(dialog);
 trigger.onclick=()=>open();
 return {trigger,open};
}
