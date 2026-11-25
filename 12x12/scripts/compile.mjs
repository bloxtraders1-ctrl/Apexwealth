import fs from 'node:fs';
import solc from 'solc';
const source = fs.readFileSync('contracts/ApexVault.sol','utf8');
export function compile(sources) {
  const settings = {evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode']}}};
  const output = JSON.parse(solc.compile(JSON.stringify({language:'Solidity', sources,settings})));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if(errors.length) throw Error(errors.map(e=>e.formattedMessage).join('\n'));
  return output.contracts;
}
const compiled=compile({'ApexVault.sol':{content:source}})['ApexVault.sol'].ApexVault;
fs.writeFileSync('dist/assets/vault.json',JSON.stringify({abi:compiled.abi,bytecode:'0x'+compiled.evm.bytecode.object,runtime:compiled.evm.deployedBytecode.object,immutables:compiled.evm.deployedBytecode.immutableReferences}));
fs.copyFileSync('node_modules/ethers/dist/ethers.min.js','dist/assets/ethers.min.js');
const cash=compile({'DirectCashier.sol':{content:fs.readFileSync('contracts/DirectCashier.sol','utf8')}})['DirectCashier.sol'];
for(const name of ['DirectCashier','DepositReceipt']){
 const c=cash[name],runtime=c.evm.deployedBytecode;
 fs.writeFileSync('dist/assets/'+name+'.json',JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:runtime.object,immutables:runtime.immutableReferences}));
}
