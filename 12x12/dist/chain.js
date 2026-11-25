import {BrowserProvider, Contract, ZeroAddress, formatUnits, parseUnits, isAddress} from './assets/ethers.min.js';
export {ZeroAddress,parseUnits,isAddress};
export const USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const tokenAbi=['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'];
export const fmt=n=>formatUnits(n,6);
export function matchesArtifact(code,artifact){
 let actual=code.slice(2).toLowerCase(),target=artifact.runtime.toLowerCase();
 if(!target.length||actual.length!==target.length)return false;
 for(const refs of Object.values(artifact.immutables)){
  for(const {start,length} of refs){const i=start*2,j=i+length*2;actual=actual.slice(0,i)+'0'.repeat(j-i)+actual.slice(j);}
 }
 return actual===target;
}
export async function openWallet(injected,config,artifact){
 const [address]=await injected.request({method:'eth_requestAccounts'});
 if(!isAddress(address))throw Error('No wallet account was selected.');
 const id=await injected.request({method:'eth_chainId'});
 if(Number(id)!==8453){
  try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x2105'}]});}
  catch(e){if(e.code!==4902)throw e;await injected.request({method:'wallet_addEthereumChain',params:[{chainId:'0x2105',chainName:'Base',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:['https://mainnet.base.org'],blockExplorerUrls:['https://basescan.org']}]});}
 }
 const provider=new BrowserProvider(injected);
 if((await provider.getNetwork()).chainId!==8453n)throw Error('Select Base in your wallet.');
 const signer=await provider.getSigner(address),token=new Contract(USDC,tokenAbi,signer);
 let vault=null;
 if(config.vaultAddress){
  if(!matchesArtifact(await provider.getCode(config.vaultAddress),artifact))throw Error('Vault code verification failed.');
  vault=new Contract(config.vaultAddress,artifact.abi,signer);
  if((await vault.token()).toLowerCase()!==USDC.toLowerCase())throw Error('Vault asset verification failed.');
 }
 return {address,provider,token,vault};
}
