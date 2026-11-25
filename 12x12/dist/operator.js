import {openWallet,matchesArtifact,USDC,ZeroAddress,parseUnits,isAddress,fmt} from './chain.js';
import {ContractFactory,Contract} from './assets/ethers.min.js';
import {$} from './ui.js';
import {money} from './cashier-api.js';
const artifact=await fetch('/assets/vault.json').then(r=>r.json()),site=await fetch('/config.json',{cache:'no-store'}).then(r=>r.json());
let selected,token,config,candidate,working=false;
const factoryBuild=await fetch('/assets/DirectCashier.json').then(r=>r.json());
const say=s=>$('op-status').textContent=s;
const last=site.vaultAddress||localStorage.getItem('apex-setup-vault');
$('address').value=last||'';
function controls(){document.querySelector('#deploy button').disabled=working||Boolean(selected);document.querySelector('#attach button').disabled=working;document.querySelector('#fund button').disabled=working||!selected;$('export').disabled=working||!config?.factoryAddress;$('deploy-cashier').disabled=working||!selected||Boolean(candidate);$('register-cashier').disabled=working||!candidate||Boolean(config?.factoryAddress);}
function row(k,v){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;dl.append(dt,dd);return dl;}
async function sync(){
 const [s,c,r,locked,registered]=await Promise.all([selected.separatePrincipal(),selected.capOnBalance(),selected.reserve(),selected.locked(),selected.cashier()]);
 const stored=(registered!==ZeroAddress ? registered : null)||localStorage.getItem('apex-factory-'+selected.target)||((site.vaultAddress||'').toLowerCase()===selected.target.toLowerCase()?site.factoryAddress:null);
 candidate=null;let factoryAddress=null;
 if(stored&&isAddress(stored)&&matchesArtifact(await selected.runner.provider.getCode(stored),factoryBuild)){
  const adapter=new Contract(stored,factoryBuild.abi,selected.runner);
  if((await adapter.vault()).toLowerCase()===selected.target.toLowerCase()){candidate=stored;if(registered.toLowerCase()===stored.toLowerCase())factoryAddress=stored;}
 }
 config={contractVersion:5,chainId:8453,vaultAddress:selected.target,factoryAddress,separatePrincipal:s,capOnBalance:c};
 $('vault-info').replaceChildren(row('Vault',selected.target.slice(0,8)+'…'+selected.target.slice(-6)),row('Available reserve',money(r)),row('Committed to plans',money(locked)),row('Principal',s?'Returned separately':'Included in payouts'),row('Withdrawal cap basis',c?'Unlocked balance':'Original deposit'));
}
const providers=new Map();window.addEventListener('eip6963:announceProvider',({detail})=>{if(detail?.provider)providers.set(detail.info.uuid,detail.provider);});window.dispatchEvent(new Event('eip6963:requestProvider'));
async function getWallet(){const injected=window.ethereum||[...providers.values()][0];if(!injected)throw Error('Open this page in a browser with a Base-compatible wallet.');return openWallet(injected,{vaultAddress:null},artifact);}
function run(id,fn){$(id).onsubmit=async e=>{e.preventDefault();if(working)return;working=true;controls();try{await fn();}catch(err){say(String(err.reason||err.shortMessage||err.message).slice(0,450));}finally{working=false;controls();}};}
async function bind(w,address){
 if(!isAddress(address)||!matchesArtifact(await w.provider.getCode(address),artifact))throw Error('The address does not contain this version of the 12x12 vault on Base.');
 const v=new Contract(address,artifact.abi,await w.provider.getSigner(w.address));
 if((await v.token()).toLowerCase()!==USDC.toLowerCase())throw Error('This vault uses a different asset.');
 selected=v;token=w.token;localStorage.setItem('apex-setup-vault',address);$('address').value=address;await sync();
}
run('deploy',async()=>{
 const w=await getWallet();
 say('Review and sign the vault deployment in your wallet.');
 const f=new ContractFactory(artifact.abi,artifact.bytecode,await w.provider.getSigner(w.address));
 const v=await f.deploy(USDC,$('principal').value==='separate',$('cap').value==='balance');
 localStorage.setItem('apex-setup-vault',v.target);$('address').value=v.target;say('Waiting for deployment at '+v.target);
 await v.waitForDeployment();await bind(w,v.target);say('Vault deployed. Fund the reserve and download the site configuration.');
});
run('attach',async()=>{await bind(await getWallet(),$('address').value.trim());say('Verified 12x12 vault connected.');});
run('fund',async()=>{
 const w=await getWallet();await bind(w,selected.target);
 const target=parseUnits($('target').value,6),free=await selected.reserve();
 if(free>=target){say('Available reserve already meets the target.');return;}
 const amount=target-free;
 if(await token.balanceOf(w.address)<amount)throw Error('The connected wallet has insufficient USDC for this top-up.');
 if(await token.allowance(w.address,selected.target)<amount){say('Review the USDC approval for '+fmt(amount)+' USDC.');await (await token.approve(selected.target,amount)).wait();}
 say('Review the transfer of '+fmt(amount)+' USDC to '+selected.target);await (await selected.fund(amount)).wait();await sync();say('Reserve funding confirmed.');
});
$('deploy-cashier').onclick=async()=>{
 if(working||!selected)return;working=true;controls();
 try{
  const w=await getWallet();
  if((await selected.owner()).toLowerCase()!==w.address.toLowerCase())throw Error('Select the vault owner account.');
  const adapter=await new ContractFactory(factoryBuild.abi,factoryBuild.bytecode,await w.provider.getSigner()).deploy(selected.target);
  localStorage.setItem('apex-factory-'+selected.target,adapter.target);
  await adapter.waitForDeployment();await sync();say('Direct cashier deployed. Register it with the vault before exporting the configuration.');
 }catch(e){say(e.shortMessage||e.message);}finally{working=false;controls();}
};
$('register-cashier').onclick=async()=>{
 if(working||!selected||!candidate)return;
 working=true;controls();
 try{
  const w=await getWallet();await bind(w,selected.target);
  if(!candidate || (await selected.owner()).toLowerCase()!==w.address.toLowerCase())throw Error('Select the vault owner account and a deployed cashier.');
  if(!config.factoryAddress){
   say('Review permanent cashier registration in your wallet.');
   await (await selected.setCashier(candidate)).wait();
  }
  await sync();say('Cashier registered. Download the configuration and rebuild the site.');
 }catch(e){say(e.shortMessage||e.message);}finally{working=false;controls();}
};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);};
controls();
