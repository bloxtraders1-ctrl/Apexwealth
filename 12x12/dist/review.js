import {openWallet,USDC,matchesArtifact} from './chain.js';
import {Contract} from './assets/ethers.min.js';
import {api,element,action,money,explorer,statuses,link} from './cashier-api.js';
const button=document.getElementById('load-queue'),area=document.getElementById('queue'),status=document.getElementById('cash-status');
const cfg=await fetch('/config.json',{cache:'no-store'}).then(r=>r.json());
async function artifacts(suffix){
 const builds=await Promise.all(['vault','DirectCashier','DepositReceipt'].map(name=>fetch('/assets/'+name+suffix+'.json').then(r=>r.json())));
 return {vault:builds[0],factory:builds[1],receipt:builds[2]};
}
const current=await artifacts('');
const previous={vault:current.vault,factory:await fetch('/assets/DirectCashier-v4.json').then(r=>r.json()),receipt:await fetch('/assets/DepositReceipt-v4.json').then(r=>r.json())};
const builds={1:await artifacts('-v1'),2:{...previous,vault:await fetch('/assets/vault-v2.json').then(r=>r.json())},3:{...previous,vault:await fetch('/assets/vault-v3.json').then(r=>r.json())},4:previous,5:current};
async function contractsFor(row){
 const build=builds[row.contract_version||1];
 if(!build)throw Error('Unsupported cashier version.');
 const [vaultCode,factoryCode]=await Promise.all([wallet.provider.getCode(row.vault),wallet.provider.getCode(row.factory)]);
 if(!matchesArtifact(vaultCode,build.vault)||!matchesArtifact(factoryCode,build.factory))throw Error('Vault or cashier verification failed.');
 const vault=new Contract(row.vault,build.vault.abi,signer),factory=new Contract(row.factory,build.factory.abi,signer);
 const [asset,owner,factoryVault]=await Promise.all([vault.token(),vault.owner(),factory.vault()]);
 if(asset.toLowerCase()!==USDC.toLowerCase()||owner.toLowerCase()!==wallet.address.toLowerCase()||factoryVault.toLowerCase()!==row.vault.toLowerCase())throw Error('Select the account that owns this verified cashier vault.');
 return {factory,receipt:new Contract(row.receiver,build.receipt.abi,signer),receiptBuild:build.receipt};
}
let wallet,stamp,signature,signer;
async function authorise(){
 if(!(await api('status')).signedIn)throw Error('Log in to 12x12 before connecting the vault owner wallet.');
 if(!cfg.factoryAddress||!cfg.vaultAddress)throw Error('Deploy the direct cashier and fund the vault in Vault setup first.');
 if(!window.ethereum)throw Error('The cashier needs the vault owner’s Base wallet to approve requests.');
 wallet=await openWallet(window.ethereum,{vaultAddress:null},builds[2].vault);signer=await wallet.provider.getSigner();
 stamp=Math.floor(Date.now()/1000);signature=await signer.signMessage('12x12 cashier review\n'+location.origin+'\n'+stamp);
}
const auth=()=>({timestamp:stamp,signature});
const workspace=document.getElementById('admin-workspace');
const filters=[...workspace.querySelectorAll('[data-queue]')];
let tab='deposits', queueData;
const awaitingConfirmation=new Set();
for(const filter of filters)filter.onclick=()=>{tab=filter.dataset.queue;renderQueue();};

async function queue(){
 if(!wallet||Math.floor(Date.now()/1000)-stamp>230)await authorise();
 for(const receipt of awaitingConfirmation)await api('sync',{id:receipt,...auth()});
 queueData=await api('queue',auth());
 for(const receipt of awaitingConfirmation){
  if(!queueData.withdrawals.some(row=>row.receipt===receipt))awaitingConfirmation.delete(receipt);
 }
 workspace.hidden=false;
 button.textContent='Refresh queue';
 status.textContent='Owner verified · Base';
 renderQueue();
}

function renderQueue(){
 const data=queueData;
 if(!data)return;
 area.replaceChildren();
 for(const filter of filters)filter.setAttribute('aria-pressed',String(tab===filter.dataset.queue));
 document.getElementById('deposit-count').textContent=data.receipts.length;
 document.getElementById('withdrawal-count').textContent=data.withdrawals.length;
 for(const row of (tab==='deposits'?data.receipts:[])){
  const card=element('article',null,'panel queue-item');card.append(element('span',statuses[row.stage],'receipt-stage'),element('h2','Plan '+(row.plan_id||1)+' · '+money(row.amount)),element('p','Deposit address: '+row.receiver,'hash'),element('p','Deposit refund address: '+row.payout,'hash'));
  if(row.tx)card.append(explorer(row.tx));
  const act=async method=>{
   const {factory,receipt:receiver,receiptBuild}=await contractsFor(row);
   const tiered=row.contract_version>=2;
   const args=[row.id,row.payout,row.amount,row.referrer];
   if(tiered)args.push(row.plan_id);
   const expected=await factory[tiered?'addressForTier':'addressFor'](...args);
   if(expected.toLowerCase()!==row.receiver.toLowerCase())throw Error('Receipt address verification failed.');
   if(await wallet.provider.getCode(row.receiver)==='0x'){status.textContent='Review receipt deployment in your wallet.';await (await factory[tiered?'prepareTier':'prepare'](...args)).wait();}
   if(!matchesArtifact(await wallet.provider.getCode(row.receiver),receiptBuild))throw Error('Receipt code verification failed.');
   if(method==='activate'&&!await receiver.active()){status.textContent='Review plan activation in your wallet.';await (await receiver.activate()).wait();}
   if(method==='refund'){status.textContent='Review refund to the fixed payout address.';await (await receiver.refund()).wait();}
   status.textContent='Transaction mined. Refresh the queue after Base confirms it as safe.';
   await api('sync',{id:row.id,...auth()});await queue();
  };
  if(row.stage==='review')card.append(action('Approve deposit',()=>act('activate'),'primary'));
  if(['refund-requested','review'].includes(row.stage))card.append(action('Return uninvested USDC',()=>act('refund')));
  if(row.stage!=='created')card.append(action('Reconcile status',async()=>{await api('sync',{id:row.id,...auth()});await queue();}));
  area.append(card);
 }
 for(const w of (tab==='withdrawals'?data.withdrawals:[])){
  const card=element('article',null,'panel');card.append(element('h2','Withdrawal · '+money(w.amount)),element('p','Destination on Base: '+(w.destination||w.payout),'hash'),action('Approve',async()=>{
   const {receipt:receiver,receiptBuild}=await contractsFor(w);
   if(!matchesArtifact(await wallet.provider.getCode(w.receiver),receiptBuild))throw Error('Payout receipt verification failed.');
   if((await receiver.vault()).toLowerCase()!==w.vault.toLowerCase()||(await receiver.beneficiary()).toLowerCase()!==w.payout.toLowerCase())throw Error('Payout destination verification failed.');
   if(!await receiver.processed(w.id)){
    const tx=w.contract_version>=5?await receiver.payTo(w.id,w.amount,w.destination):await receiver.pay(w.id,w.amount);
    await tx.wait();
   }
   awaitingConfirmation.add(w.receipt);await queue();status.textContent='Withdrawal mined. Refresh the queue after Base confirms it as safe.';
  },'primary'));area.append(card);
 }
 if(!area.children.length)area.append(element('p',tab==='deposits'?'No deposits awaiting review.':'No withdrawals awaiting review.','secondary'));
}
button.onclick=async()=>{button.disabled=true;try{await queue();}catch(e){status.textContent=e.shortMessage||e.message;}finally{button.disabled=false;}};
