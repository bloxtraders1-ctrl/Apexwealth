export const assets = [
 {id:'sol', symbol:'SOL', name:'Solana', mark:'≋', network:'Solana'},
 {id:'usdt-tron', symbol:'USDT', name:'Tether', mark:'₮', network:'TRON · TRC20'},
 {id:'trx', symbol:'TRX', name:'TRON', mark:'△', network:'TRON'},
 {id:'ltc', symbol:'LTC', name:'Litecoin', mark:'Ł', network:'Litecoin'},
 {id:'doge', symbol:'DOGE', name:'Dogecoin', mark:'Ð', network:'Dogecoin'},
 {id:'eth', symbol:'ETH', name:'Ethereum', mark:'Ξ', network:'Ethereum'},
 {id:'usdc-ethereum', symbol:'USDC', name:'USD Coin', mark:'$', network:'Ethereum · ERC20'},
 {id:'btc', symbol:'BTC', name:'Bitcoin', mark:'₿', network:'Bitcoin'},
 {id:'usdc-base', symbol:'USDC', name:'USD Coin', mark:'$', network:'Base'}
];

export function availableAssets(configured){
 return configured ? assets : assets.filter(asset=>asset.id!=='usdc-base');
}

export function transferEnabled(asset,configured){
 return asset.id==='usdc-base'&&configured;
}
