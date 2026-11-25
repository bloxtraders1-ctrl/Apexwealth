import {$,icon,fillIcons,modal,calc,renderMetrics,usd,short,toast} from './ui.js';
import {openWallet,fmt} from './chain.js';
const config=await fetch('/config.json',{cache:'no-store'}).then(r=>r.json());
let artifact,wallet=null,position=null,account=null,balances=null,usdc=null,separate=config.separatePrincipal??true,balanceCap=config.capOnBalance??false,busy=false,refreshId=0;
const injections=new Map();
window.addEventListener('eip6963:announceProvider',({detail})=>{if(detail?.provider?.request)injections.set(detail.info.uuid,detail);});
window.dispatchEvent(new Event('eip6963:requestProvider'));
const records=rows=>rows.map(([k,v])=>'<dl><dt>'+k+'</dt><dd>'+v+'</dd></dl>').join('');
const val=n=>n===null||n===undefined?'—':Number(fmt(n)).toLocaleString('en-US',{maximumFractionDigits:6})+' USD';
const explorer=a=>'<a rel="noopener noreferrer" target="_blank" href="https://basescan.org/address/'+a+'">'+short(a)+' ↗</a>';
const capDescription=()=>balanceCap?'12% of your withdrawable balance at the first withdrawal of each UTC day':'12% of the original deposit per UTC day';
const firstCredit = config.contractVersion>=2?'at the next midnight UTC':'after the first 24 hours';
const terms=()=>'<div class="term-row"><span>Deposit asset</span><strong>USDC on Base</strong></div><div class="term-row"><span>Deposit limits</span><strong>$12 – $1,200</strong></div><div class="term-row"><span>Daily payout</span><strong>12% of original deposit</strong></div><div class="term-row"><span>Term</span><strong>12 completed days</strong></div><p>'+(separate?'Your original deposit unlocks separately after day 12.':'The twelve payouts include the original deposit.')+' All withdrawals, including referral earnings, share a cap of '+capDescription()+'. Unclaimed amounts remain available on later days.</p>';
const reserveInfo='<p>Rewards come from a sponsor-funded USDC reserve. The contract checks funding when a plan opens. USDC value, smart-contract operation and access to your wallet carry risk.</p>';
function go(){const page=['overview','portfolio','referrals'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!==page);document.querySelectorAll('[data-nav]').forEach(a=>{const current=a.dataset.nav===page;a.classList.toggle('active',current);if(current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});document.title='12x12 · '+({overview:'Investment overview',portfolio:'Portfolio',referrals:'Referrals'}[page]);window.scrollTo(0,0);}
function render(){
 renderMetrics();calc(separate);
 document.querySelectorAll('[data-connect]').forEach(b=>{b.innerHTML=icon('wallet')+'<span>'+(wallet?short(wallet.address):'Connect wallet')+'</span>';});
 $('wallet-heading').textContent=wallet?short(wallet.address):'Connect your wallet';
 $('wallet-desc').textContent=wallet?(usdc===null?'Reading your USDC balance…':val(usdc)+' in your wallet'):'View your balance, manage deposits and withdraw available earnings.';
 $('wallet-action').innerHTML=icon(wallet?'arrow-right':'link')+(wallet?'Open portfolio':'Connect wallet');
 $('position-data').innerHTML=records([['Connected wallet',wallet?explorer(wallet.address):'Disconnected'],['Wallet balance',val(usdc)],['Original deposit',val(position?.principal)],['Daily payouts unlocked',val(balances?.income)],['Principal unlocked',val(balances?.principal)],['Referral balance',val(balances?.bonus)],['Withdrawable today',val(balances?.available)],['Total withdrawn',val(account?.totalWithdrawn)]]);
 $('withdraw').disabled=!wallet?.vault||!balances?.available||busy;
 $('position-note').textContent=!config.vaultAddress?'Deposits are closed while the operator sets up the funded vault.':position?.start?'Plan opened '+new Date(Number(position.start)*1000).toLocaleString()+'. Daily withdrawals reset at 00:00 UTC.':'Connect your wallet to read your on-chain position.';
 $('ref-data').innerHTML=records([['Referred plans',account?account.referredPlans.toString():'—'],['Total commission earned',val(account?.totalBonus)],['Unclaimed commission',val(balances?.bonus)]]);
 const eligible=wallet&&position?.principal>0n;
 $('ref-link').value=eligible?location.origin+'/?ref='+wallet.address+'#portfolio':'';
 $('copy-link').innerHTML=icon(eligible?'copy':'wallet')+(eligible?'Copy link':wallet?'View eligibility':'Connect wallet');
}
function show(type){
 if(type==='plan'||type==='terms'){modal(type==='plan'?'12x12 Plan':'Plan terms',terms()+reserveInfo+'<button class="primary" id="to-portfolio">Open portfolio '+icon('arrow-right')+'</button>');$('to-portfolio').onclick=()=>{$('dialog').close();location.hash='portfolio';};}
 if(type==='how')modal('How it works','<ol><li><strong>Connect a Base wallet.</strong> Hold USDC for your deposit and ETH for network fees.</li><li><strong>Open the plan.</strong> Choose $12–$1,200, review the terms, then sign the USDC approval and deposit in your wallet.</li><li><strong>Withdraw your payouts.</strong> Open Portfolio once the first credit unlocks '+firstCredit+'. Unclaimed amounts carry forward, subject to your daily cap.</li></ol>'+reserveInfo);
 if(type==='help')modal('Wallet & plan help','<p><strong>Which asset can I use?</strong><br>Native USDC on Base. Use the deposit form so the vault can record your position.</p><p><strong>When can I withdraw?</strong><br>The first payout unlocks '+firstCredit+'. The daily withdrawal allowance resets at midnight UTC.</p><p><strong>How are referrals paid?</strong><br>Share your referral link after opening a plan. Your current vault determines when referral rewards become available in Portfolio.</p><p><strong>Vault status</strong><br>'+(config.vaultAddress?explorer(config.vaultAddress):'Awaiting operator deployment and funding.')+'</p>');
}
function resetWallet(){refreshId++;wallet=position=account=balances=usdc=null;render();}
async function refresh(){
 if(!wallet)return;const w=wallet,id=++refreshId;
 const [u,p,a,b,s,c]=await Promise.all([w.token.balanceOf(w.address),w.vault?.plans(w.address),w.vault?.accounts(w.address),w.vault?.balances(w.address),w.vault?.separatePrincipal(),w.vault?.capOnBalance()]);
 if(w!==wallet||id!==refreshId)return;
 usdc=u;position=p;account=a;balances=b;if(s!==undefined)separate=s;if(c!==undefined)balanceCap=c;render();
}
let currentInjection;
const changed=()=>{resetWallet();toast('Wallet or network changed. Reconnect to refresh your position.');};
async function attach(injected){
 try{
  if(currentInjection?.removeListener){currentInjection.removeListener('accountsChanged',changed);currentInjection.removeListener('chainChanged',changed);}
  artifact??=await fetch(config.contractVersion>=4?'/assets/vault.json':'/assets/vault-v'+(config.contractVersion||1)+'.json').then(r=>r.json());const w=await openWallet(injected,config,artifact);
  currentInjection=injected;injected.on?.('accountsChanged',changed);injected.on?.('chainChanged',changed);wallet=w;render();if($('dialog').open)$('dialog').close();await refresh();
 }catch(e){resetWallet();failure(e);}
}
async function connect(){
 if(wallet){modal('Connected wallet','<p class="addr">'+wallet.address+'</p><p>USDC on Base · '+explorer(wallet.address)+'</p><button class="muted-button" id="disconnect">Disconnect from site</button>');$('disconnect').onclick=()=>{resetWallet();$('dialog').close();};return;}
 const providers=[...injections.values()];
 if(providers.length>1){
  modal('Select your wallet','<div id="choices" class="actions"></div>');for(const item of providers){const b=document.createElement('button');b.className='muted-button';b.textContent=item.info.name;b.onclick=()=>attach(item.provider);$('choices').append(b);}return;
 }
 const provider=providers[0]?.provider||window.ethereum;
 if(!provider){modal('Connect your wallet','<p>Open 12x12 in your wallet’s built-in browser, or enable a browser wallet that supports Base.</p><p>You can copy this page address to open it on another device.</p><button class="muted-button" id="copy-page">'+icon('copy')+' Copy page address</button>');$('copy-page').onclick=()=>copy(location.href);return;}
 await attach(provider);
}
async function copy(s){try{await navigator.clipboard.writeText(s);toast('Copied to clipboard.');}catch{modal('Copy address','<input readonly class="field" id="manual-copy">');$('manual-copy').value=s;$('manual-copy').select();}}
function failure(e){const message=e?.code===4001||e?.code==='ACTION_REJECTED'?'The wallet request was declined.':String(e?.reason||e?.shortMessage||e?.message||'Wallet connection failed.').slice(0,280);modal('Wallet update','<p id="wallet-error"></p>');$('wallet-error').textContent=message;}
function review(title,body,action,callback){modal(title,body+'<button id="confirm" class="primary">'+action+'</button>');$('confirm').onclick=async()=>{if(busy)return;busy=true;$('confirm').disabled=true;try{await callback();}catch(e){failure(e);}finally{busy=false;render();}};}
async function txStatus(tx,action){modal(action,'<p>Waiting for confirmation on Base.</p><a rel="noopener noreferrer" target="_blank" href="https://basescan.org/tx/'+tx.hash+'">View transaction ↗</a>');await tx.wait();}
$('withdraw').onclick=async()=>{if(!balances?.available)return;const w=wallet,amount=balances.available;
 review('Review withdrawal','<p>Withdraw <strong>'+val(amount)+'</strong> to '+explorer(w.address)+'. Network fees are paid in ETH.</p>','Confirm withdrawal',async()=>{if(w!==wallet)throw Error('Reconnect your wallet.');await txStatus(await w.vault.claim(amount),'Withdrawing USDC');await refresh();modal('Withdrawal confirmed','<p>Your USDC has been transferred to your wallet.</p>');});};
$('copy-link').onclick=()=>{if(!wallet)return connect();if($('ref-link').value)return copy($('ref-link').value);modal('Referral eligibility','<p>Your referral link activates after your wallet opens its first funded plan.</p>');};
$('wallet-action').onclick=()=>wallet?location.hash='portfolio':connect();
$('amount').oninput=()=>calc(separate);$('amount-range').oninput=e=>{$('amount').value=Number(e.target.value).toFixed(2);calc(separate);};
$('dialog').setAttribute('aria-labelledby','dialog-title');$('close').onclick=()=>$('dialog').close();$('dialog').onclick=e=>{if(e.target===$('dialog'))$('dialog').close();};
document.querySelectorAll('[data-connect]').forEach(b=>b.onclick=connect);document.querySelectorAll('[data-modal]').forEach(b=>b.onclick=()=>show(b.dataset.modal));

window.addEventListener('hashchange',go);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&wallet)refresh().catch(failure);});
setInterval(()=>{if(wallet&&!document.hidden&&!busy)refresh().catch(()=>toast('Unable to refresh on-chain balances.'));},30000);
fillIcons();render();go();
