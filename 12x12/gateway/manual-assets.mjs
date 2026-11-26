import {getAddress, decodeBase58, sha256} from 'ethers';
import {check} from './chain.mjs';

export const assets = {
 'sol': ['SOL','solana',9,null,'https://explorer.solana.com/tx/'],
 'trx': ['TRX','tron',6,null,'https://tronscan.org/#/transaction/'],
 'usdt-tron': ['USDT','tron',6,'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t','https://tronscan.org/#/transaction/'],
 'ltc': ['LTC','litecoin',8,null,'https://blockchair.com/litecoin/transaction/'],
 'doge': ['DOGE','dogecoin',8,null,'https://blockchair.com/dogecoin/transaction/'],
 'btc': ['BTC','bitcoin',8,null,'https://mempool.space/tx/'],
 'eth': ['ETH','ethereum',18,null,'https://etherscan.io/tx/'],
 'bnb-bsc': ['BNB','bsc',18,null,'https://bscscan.com/tx/'],
 'xrp': ['XRP','xrpl',6,null,'https://livenet.xrpl.org/transactions/'],
 'usdc-ethereum': ['USDC','ethereum',6,'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48','https://etherscan.io/tx/'],
 'usdc-base': ['USDC','base',6,'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913','https://basescan.org/tx/']
};

const evmNetworks=['base','ethereum','bsc'];
const bitcoinAlphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const xrplAlphabet='rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

export const supportsWithdrawal=network=>network!=='xrpl';

function base58Hex(value){
 if(!/^[1-9A-HJ-NP-Za-km-z]{25,92}$/.test(value))return '';
 const hex=decodeBase58(value).toString(16);
 return '00'.repeat(value.match(/^1*/)[0].length)+(hex.length%2?'0':'')+hex;
}
function base58Check(value,versions){
 const hex=base58Hex(value);
 return hex.length===50&&versions.includes(hex.slice(0,2))&&sha256(sha256('0x'+hex.slice(0,-8))).slice(2,10)===hex.slice(-8);
}

function segwitAddress(value,hrp){
 if(value.length>90||!(value===value.toLowerCase()||value===value.toUpperCase()))return false;
 const address=value.toLowerCase();
 if(!address.startsWith(hrp+'1'))return false;
 const alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
 const data=Array.from(address.slice(hrp.length+1),char=>alphabet.indexOf(char));
 if(data.length<7||data.includes(-1)||data[0]>16)return false;
 const prefix=Array.from(hrp,c=>c.charCodeAt(0));
 const bits=[...prefix.map(n=>n>>5),0,...prefix.map(n=>n&31),...data];
 const generator=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
 let checksum=1;
 for(const n of bits){
  const top=checksum>>>25;
  checksum=((checksum&0x1ffffff)<<5)^n;
  for(let index=0;index<5;index++)if((top>>>index)&1)checksum^=generator[index];
 }
 const version=data[0];
 if(checksum!==(version===0?1:0x2bc830a3))return false;
 const payload=data.slice(1,-6), bitLength=payload.length*5, remainder=bitLength%8;
 const bytes=Math.floor(bitLength/8);
 if(remainder>=5||(remainder&&(payload.at(-1)&((1<<remainder)-1))))return false;
 return version===0?(bytes===20||bytes===32):bytes>=2&&bytes<=40;
}

export function normalizeAddress(network,raw){
 const value=typeof raw==='string'?raw.trim():'';
 if(evmNetworks.includes(network)){
  try{
   const address=getAddress(value);
   if(/^0x0{40}$/i.test(address))throw Error();
   return address;
  }catch{check(false,'Enter a valid nonzero '+network+' address.');}
 }
 if(network==='xrpl'){
  const bitcoinEncoding=Array.from(value,char=>bitcoinAlphabet[xrplAlphabet.indexOf(char)]||'!').join('');
  check(/^r.{24,34}$/.test(value)&&base58Check(bitcoinEncoding,['00']),'Enter a valid XRP Ledger classic address.');
  return value;
 }
 if(network==='solana'){
  const hex=base58Hex(value);
  check(hex.length===64&&!/^0+$/.test(hex),'Enter a valid Solana address.');
  return value;
 }
 const hrp={bitcoin:'bc',litecoin:'ltc'}[network];
 if(hrp&&segwitAddress(value,hrp))return value.toLowerCase();
 const versions={tron:['41'],bitcoin:['00','05'],litecoin:['30','32'],dogecoin:['1e','16']};
 check(base58Check(value,versions[network]||[]),'Enter a valid '+network+' receiving address.');
 return value;
}

export function normalizeTx(network,raw){
 const tx=typeof raw==='string'?raw.trim():'';
 if(network==='solana'){
  check(base58Hex(tx).length===128,'Enter a valid Solana transaction signature.');
  return tx;
 }
 if(evmNetworks.includes(network)){
  check(/^0x[a-f0-9]{64}$/i.test(tx),'Enter a 0x-prefixed transaction hash.');
  return tx.toLowerCase();
 }
 check(/^[a-f0-9]{64}$/i.test(tx),'Enter a 64-character transaction hash.');
 return network==='xrpl'?tx.toUpperCase():tx.toLowerCase();
}

export function parseDecimal(value,decimals,label){
 check(typeof value==='string'&&/^\d{1,20}(\.\d{1,24})?$/.test(value),'Enter a valid '+label+'.');
 const [whole,fraction='']=value.split('.');
 check(fraction.length<=decimals,label+' allows at most '+decimals+' decimal places.');
 return BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
}
export function formatDecimal(amount,decimals){
 const scale=10n**BigInt(decimals);
 const fraction=(amount%scale).toString().padStart(decimals,'0').replace(/0+$/,'');
 return (amount/scale).toString()+(fraction?'.'+fraction:'');
}

async function krakenRate(symbol){
 const pair=(symbol==='BTC'?'XBT':symbol)+'USD';
 const response=await fetch('https://api.kraken.com/0/public/Ticker?pair='+pair,{signal:AbortSignal.timeout(6500)});
 if(!response.ok)throw Error();
 const {error,result}=await response.json();
 const values=Object.values(result||{});
 if(error?.length||values.length!==1)throw Error();
 return values[0]?.c?.[0];
}

async function coinbaseRate(symbol){
 const response=await fetch('https://api.coinbase.com/v2/prices/'+symbol+'-USD/spot',{signal:AbortSignal.timeout(6500)});
 if(!response.ok)throw Error();
 const {data}=await response.json();
 if(data?.base!==symbol||data?.currency!=='USD')throw Error();
 return data.amount;
}

export async function spotPrice(symbol){
 for(const [source,fetchRate] of [['Kraken',krakenRate],['Coinbase',coinbaseRate]]){
  try{
   const rate=await fetchRate(symbol);
   if(parseDecimal(rate,12,'market USD rate')>0n)return {rate,source};
  }catch{}
 }
 check(false,'A live USD quote is currently unavailable for '+symbol+'.',503);
}
