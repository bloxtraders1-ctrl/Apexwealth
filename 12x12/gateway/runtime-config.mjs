import defaults from '../dist/config.json' with {type:'json'};

export function runtimeConfig(source){
 if(!source)return defaults;
 const settings=JSON.parse(source);
 const {chainId,vaultAddress,factoryAddress,separatePrincipal,capOnBalance,contractVersion}=settings;
 const isAddress=value=>typeof value==='string'&&/^0x[\da-f]{40}$/i.test(value)&&!/^0x0{40}$/i.test(value);
 if(chainId!==8453||!isAddress(vaultAddress)||!isAddress(factoryAddress)||contractVersion!==5||
    typeof separatePrincipal!=='boolean'||typeof capOnBalance!=='boolean'){
  throw Error('APEX_CONFIG_JSON must contain the version 5 config exported from Vault setup.');
 }
 return {chainId,vaultAddress,factoryAddress,separatePrincipal,capOnBalance,contractVersion};
}
