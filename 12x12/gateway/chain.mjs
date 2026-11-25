import {Interface, getAddress, ZeroAddress, solidityPackedKeccak256} from 'ethers';
import vaultBuild from '../dist/assets/vault.json' with {type:'json'};
import factoryBuild from '../dist/assets/DirectCashier.json' with {type:'json'};
import oldVault from '../dist/assets/vault-v1.json' with {type:'json'};
import inboxBuild from '../dist/assets/DepositReceipt.json' with {type:'json'};
export const USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const v=new Interface(vaultBuild.abi), f=new Interface(factoryBuild.abi), inbox=new Interface(inboxBuild.abi);
const legacy=new Interface(oldVault.abi);
const token=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export function check(ok,message,status=400){if(!ok)throw Object.assign(Error(message),{status});}
export function address(value){try{return getAddress(value);}catch{throw Object.assign(Error('Enter a valid Base address.'),{status:400});}}
export function same(a,b){return String(a).toLowerCase()===String(b).toLowerCase();}
function compiled(code,art){
 let data=code.slice(2).toLowerCase();if(data.length!==art.runtime.length)return false;
 for(const refs of Object.values(art.immutables))for(const {start,length} of refs){const at=start*2;data=data.slice(0,at)+'0'.repeat(length*2)+data.slice(at+length*2);}
 return data===art.runtime.toLowerCase();
}
export function chain(config,rpcUrl){
 async function rpc(method,params){
  const res=await fetch(rpcUrl||'https://mainnet.base.org',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
  check(res.ok,'Base network is temporarily unavailable.',503);const data=await res.json();check(!data.error,'Base has not confirmed this operation yet.',503);return data.result;
 }
 async function call(contract,abi,name,args=[],block='safe'){const data=abi.encodeFunctionData(name,args);return abi.decodeFunctionResult(name,await rpc('eth_call',[{to:contract,data},block]));}
 async function validated(){
  check(config.factoryAddress&&config.vaultAddress,'The cashier is awaiting operator setup.',503);
  const [network,vc,fc,asset,linked,cashier]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_getCode',[config.vaultAddress,'safe']),rpc('eth_getCode',[config.factoryAddress,'safe']),call(config.vaultAddress,v,'token'),call(config.factoryAddress,f,'vault'),call(config.vaultAddress,v,'cashier')]);
  check(BigInt(network)===8453n&&compiled(vc,vaultBuild)&&compiled(fc,factoryBuild)&&same(asset[0],USDC)&&same(linked[0],config.vaultAddress)&&same(cashier[0],config.factoryAddress),'Cashier configuration could not be verified.',503);
 }
 async function readiness(){
  await validated();
  const min=12_000_000n;
  const [reserve,income,separate,cap]=await Promise.all([
   call(config.vaultAddress,v,'reserve'),
   call(config.vaultAddress,v,'scheduledFor',[1,min]),
   call(config.vaultAddress,v,'separatePrincipal'),
   call(config.vaultAddress,v,'capOnBalance')
  ]);
  check(separate[0]===config.separatePrincipal&&cap[0]===config.capOnBalance,'The published plan terms need an operator update.',503);
  return {depositReady:reserve[0]>=income[0]-(separate[0]?0n:min),withdrawalReady:true};
 }
 async function qualified(payout){
  await validated();
  return Number((await call(config.vaultAddress,v,'qualifiedInvestors',[payout]))[0]);
 }
 async function quote({id,payout,amount,referrer,plan_id}){
  await validated();
  const [reserve,scheduled,separate,cap]=await Promise.all([
   call(config.vaultAddress,v,'reserve'),call(config.vaultAddress,v,'scheduledFor',[plan_id,amount]),
   call(config.vaultAddress,v,'separatePrincipal'),call(config.vaultAddress,v,'capOnBalance')
  ]);
  check(separate[0]===config.separatePrincipal&&cap[0]===config.capOnBalance,'The published plan terms need an operator update.',503);
  if(referrer!==ZeroAddress){
   const [p,identity]=await Promise.all([call(config.vaultAddress,v,'plans',[referrer]),call(config.vaultAddress,v,'identityOf',[referrer])]);
   check(p.principal>0n,'This referral has no active or previously funded plan.');
   check(!same(identity[0],payout),'Self-referrals are unavailable.');
  }
  const reward=await call(config.vaultAddress,v,'referralTerms',[plan_id,payout,amount,referrer]);
  const bonus=reward.total;
  check(reserve[0]>=scheduled[0]+bonus-(separate[0]?0n:BigInt(amount)),'The sponsor reserve cannot cover this amount.',409);
  return (await call(config.factoryAddress,f,'addressForTier',[id,payout,amount,referrer,plan_id]))[0];
 }
 async function proof(row,hash){
  const [receipt,safe]=await Promise.all([rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getBlockByNumber',['safe',false])]);
  check(receipt&&receipt.status==='0x1'&&safe&&BigInt(receipt.blockNumber)<=BigInt(safe.number),'Wait for Base confirmation, then submit the hash again.',409);
  let received=0n;
  for(const log of receipt.logs){if(!same(log.address,USDC))continue;try{const e=token.parseLog(log);if(e&&same(e.args.to,row.receiver))received+=e.args.value;}catch{}}
  check(received===BigInt(row.amount),'This transaction must show the exact quoted USDC amount sent to this receipt address.');
 }
 async function state(row){
  if(await rpc('eth_getCode',[row.receiver,'safe'])==='0x')return {stage:row.stage,available:'0',bonus:'0',earned:'0',referred:'0',withdrawn:'0'};
  const abi=row.contract_version>=2?v:legacy;
  const [active,cancelled,balance,account,plan]=await Promise.all([call(row.receiver,inbox,'active'),call(row.receiver,inbox,'cancelled'),call(row.vault,abi,'balances',[row.receiver]),call(row.vault,abi,'accounts',[row.receiver]),call(row.vault,abi,'plans',[row.receiver])]);
  return {stage:active[0]?'active':cancelled[0]?'refunded':row.stage,available:String(balance.available),bonus:String(balance.bonus),earned:String(account.totalBonus),referred:String(account.referredPlans),withdrawn:String(account.totalWithdrawn),start:Number(plan.start)};
 }
 return {qualified,quote,proof,state,readiness,owner:async(vault=config.vaultAddress)=>(await call(vault,v,'owner'))[0],paid:async(row,withdrawal)=>{
  if(row.contract_version<5)return (await call(row.receiver,inbox,'processed',[withdrawal.id]))[0];
  const [commitment]=await call(row.receiver,inbox,'paymentCommitment',[withdrawal.id]);
  return commitment===solidityPackedKeccak256(['address','uint256'],[withdrawal.destination,withdrawal.amount]);
 }};
}
