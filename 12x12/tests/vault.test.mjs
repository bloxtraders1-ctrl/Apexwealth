import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseUnits} from 'ethers';
import {compile} from '../scripts/compile.mjs';
import {matchesArtifact} from '../dist/chain.js';
const artifact=JSON.parse(fs.readFileSync('dist/assets/vault.json'));
const dollars=n=>parseUnits(String(n),6);
const testToken=compile({'Token.sol':{content:`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract Token {
uint8 public constant decimals=6;
mapping(address=>uint256) public balanceOf;
mapping(address=>mapping(address=>uint256)) public allowance;
function mint(address to,uint256 n) external { balanceOf[to]+=n; }
function approve(address to,uint256 n) external returns(bool){allowance[msg.sender][to]=n;return true;}
function transfer(address to,uint256 n) external returns(bool){balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;}
function transferFrom(address from,address to,uint256 n) external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}`}})['Token.sol'].Token;
const mined=async tx=>(await tx).wait();
async function setup(t,separate=true,balanceCap=false){
 const rpc=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{totalAccounts:15}});
 t.after(()=>rpc.disconnect());
 const p=new BrowserProvider(rpc,undefined,{cacheTimeout:-1,pollingInterval:10});
 const [operator,referrer,investor]=await Promise.all([0,1,2].map(i=>p.getSigner(i)));
 const token=await new ContractFactory(testToken.abi,'0x'+testToken.evm.bytecode.object,operator).deploy();await token.waitForDeployment();
 const vault=await new ContractFactory(artifact.abi,artifact.bytecode,operator).deploy(token.target,separate,balanceCap);await vault.waitForDeployment();
 for(const s of [operator,referrer,investor]){await mined(token.mint(s.address,dollars(10000)));await mined(token.connect(s).approve(vault.target,dollars(10000)));}
 const advance=async(days=1)=>{await rpc.request({method:'evm_increaseTime',params:[86400*days]});await rpc.request({method:'evm_mine',params:[]});};
 return {operator,referrer,investor,p,rpc,vault,token,advance};
}
test('opening enforces funding, deposit bounds, referral eligibility and one outstanding plan',async t=>{
 const {vault,investor,referrer,p}=await setup(t);
 assert.ok(matchesArtifact(await p.getCode(vault.target),artifact));
 const v=vault.connect(investor);
 await assert.rejects(v.open.staticCall(dollars(12),ZeroAddress));
 await mined(vault.fund(dollars(5000)));
 for(const bad of ['11.99','1200.01'])await assert.rejects(v.open.staticCall(dollars(bad),ZeroAddress));
 for(const badRef of [referrer.address,investor.address])await assert.rejects(v.open.staticCall(dollars(100),badRef));
 await mined(v.open(dollars(1200),ZeroAddress));
 await assert.rejects(v.open.staticCall(dollars(12),ZeroAddress));
 assert.equal(await vault.locked(),dollars(2928));
 await assert.rejects(vault.releaseReserve.staticCall(dollars(5000)));
 await assert.rejects(v.releaseReserve.staticCall(1n));
 assert.equal((await vault.balances(investor.address)).available,0n);
});
test('time, maturity, split claims, daily cap and referral obligations reconcile to token balance',async t=>{
 const {vault,token,investor,referrer,advance}=await setup(t);
 await mined(vault.fund(dollars(1000)));
 const ref=vault.connect(referrer),inv=vault.connect(investor);
 await mined(ref.open(dollars(12),ZeroAddress));await mined(inv.open(dollars(100),referrer.address));
 const required=dollars(29.28+0)+dollars(244)+dollars(24);
 assert.equal(await vault.locked(),required);
 assert.equal((await vault.accounts(referrer.address)).bonus,dollars(12));
 await advance();
 assert.equal((await vault.balances(referrer.address)).bonus,dollars(13));
 await mined(inv.claim(dollars(7)));await mined(inv.claim(dollars(5)));
 assert.equal((await vault.accounts(referrer.address)).bonus,dollars(13));
 await assert.rejects(inv.claim.staticCall(1n));
 await advance(11);
 assert.equal((await vault.balances(investor.address)).principal,dollars(100));
 assert.equal((await vault.balances(investor.address)).income,dollars(132));
 for(let day=0;day<20;day++){if(day)await advance();const a=(await vault.balances(investor.address)).available;if(a)await mined(inv.claim(a));}
 assert.equal((await vault.plans(investor.address)).principalPaid,dollars(100));
 assert.equal((await vault.accounts(referrer.address)).totalBonus,dollars(24));
 assert.equal((await vault.accounts(investor.address)).totalWithdrawn,dollars(244));
 assert.equal(await token.balanceOf(vault.target),await vault.locked()+await vault.reserve());
 await mined(inv.open(dollars(12),ZeroAddress));
 assert.equal((await vault.accounts(referrer.address)).totalBonus,dollars(24));
 await advance();
 assert.equal((await vault.accounts(referrer.address)).totalBonus,dollars(24.12));
 await advance(30);
 assert.equal((await vault.accounts(referrer.address)).totalBonus,dollars(25.44));
});
test('principal-inclusive settings apply referral rewards to the deposit and freeze the balance-based cap for the UTC day',async t=>{
 const {vault,investor,referrer,advance}=await setup(t,false,true);
 await mined(vault.fund(dollars(400)));await mined(vault.connect(referrer).open(dollars(12),ZeroAddress));
 const inv=vault.connect(investor);await mined(inv.open(dollars(100),referrer.address));
 assert.equal((await vault.accounts(referrer.address)).bonus,dollars(12));
 await advance(12);assert.equal((await vault.balances(investor.address)).available,dollars(17.28));
 await mined(inv.claim(dollars(10)));assert.equal((await vault.balances(investor.address)).available,dollars(7.28));
 await mined(inv.claim(dollars(7.28)));await assert.rejects(inv.claim.staticCall(1n));
 await advance();assert.equal((await vault.balances(investor.address)).available,dollars(15.2064));
});
test('direct receipt accepts an exchange transfer before deployment; cashier activates once and pays the selected withdrawal destination',async t=>{
 const {vault,token,operator,investor,referrer,advance}=await setup(t);
 const {Contract,randomBytes,hexlify}=await import('ethers');
 const f=JSON.parse(fs.readFileSync('dist/assets/DirectCashier.json')),i=JSON.parse(fs.readFileSync('dist/assets/DepositReceipt.json'));
 const factory=await new ContractFactory(f.abi,f.bytecode,operator).deploy(vault.target);await factory.waitForDeployment();await mined(vault.setCashier(factory.target));
 await mined(vault.fund(dollars(1000)));
 const salt=hexlify(randomBytes(32)),args=[salt,investor.address,dollars(100),ZeroAddress];
 const target=await factory.addressFor(...args);
 await mined(token.connect(referrer).transfer(target,dollars(100)));
 await mined(factory.prepare(...args));const inbox=new Contract(target,i.abi,operator);
 await assert.rejects(inbox.connect(referrer).activate.staticCall());
 await mined(inbox.activate());await assert.rejects(inbox.activate.staticCall());
 assert.equal((await vault.plans(target)).principal,dollars(100));
 assert.equal(await token.balanceOf(target),0n);
 await advance();const key=hexlify(randomBytes(32));
 const destination=referrer.address;
 await assert.rejects(inbox.payTo.staticCall(key,dollars(13),destination));
 await assert.rejects(inbox.payTo.staticCall(key,dollars(12),ZeroAddress));
 await assert.rejects(inbox.connect(investor).payTo.staticCall(key,dollars(12),destination));
 const before=await token.balanceOf(destination);
 const {solidityPackedKeccak256}=await import('ethers');
 await mined(inbox.payTo(key,dollars(12),destination));
 assert.equal(await token.balanceOf(destination),before+dollars(12));
 assert.equal(await inbox.paymentCommitment(key),solidityPackedKeccak256(['address','uint256'],[destination,dollars(12)]));
 await advance();await assert.rejects(inbox.payTo.staticCall(key,dollars(12),investor.address));
 const second=[hexlify(randomBytes(32)),investor.address,dollars(100),target];
 const waiting=await factory.addressFor(...second);
 await mined(token.connect(referrer).transfer(waiting,dollars(9)));await mined(factory.prepare(...second));
 const partial=new Contract(waiting,i.abi,operator);await mined(partial.refund());
 assert.equal(await partial.cancelled(),true);assert.equal(await token.balanceOf(waiting),0n);
 await assert.rejects(partial.activate.staticCall());
});

test('tier gates count unique funded beneficiaries and earnings accrue on UTC date changes',async t=>{
 const {vault,token,operator,investor,referrer,p,rpc}=await setup(t);
 const {Contract,randomBytes,hexlify}=await import('ethers');
 const factoryBuild=JSON.parse(fs.readFileSync('dist/assets/DirectCashier.json'));
 const receiptBuild=JSON.parse(fs.readFileSync('dist/assets/DepositReceipt.json'));
 const factory=await new ContractFactory(factoryBuild.abi,factoryBuild.bytecode,operator).deploy(vault.target);
 await factory.waitForDeployment();
 await mined(vault.setCashier(factory.target));
 await mined(vault.fund(dollars(9500)));
 const sponsor=vault.connect(investor);
 await mined(sponsor.open(dollars(12),ZeroAddress));
 const makeReceipt=async(payout,amount,ref,tier)=>{
   const args=[hexlify(randomBytes(32)),payout,dollars(amount),ref,tier];
   const receiver=await factory.addressForTier(...args);
   await mined(factory.prepareTier(...args));
   await mined(token.connect(referrer).transfer(receiver,dollars(amount)));
   return new Contract(receiver,receiptBuild.abi,operator);
 };
 const open=async(payout,amount,ref,tier)=>{const r=await makeReceipt(payout,amount,ref,tier);await mined(r.activate());return r;};
 const tier2=await makeReceipt(investor.address,50,ZeroAddress,2);
 await assert.rejects(tier2.activate.staticCall());
 const addresses=await Promise.all([3,4,5,6,7,8,9,10,11,12].map(async n=>(await p.getSigner(n)).address));
 await open(addresses[0],12,investor.address,1);
 await open(addresses[0],12,investor.address,1);
 assert.equal(await vault.qualifiedInvestors(investor.address),1n);
 const self=await makeReceipt(investor.address,12,investor.address,1);
 await assert.rejects(self.activate.staticCall());
 await open(addresses[1],12,investor.address,1);
 await open(addresses[2],12,investor.address,1);
 assert.equal(await vault.qualifiedInvestors(investor.address),3n);
 await open(addresses[3],12,investor.address,1);
 await assert.rejects(tier2.activate.staticCall());
 await open(addresses[4],12,investor.address,1);
 const now=(await p.getBlock('latest')).timestamp;
 const midnight=(Math.floor(now/86400)+1)*86400;
 await rpc.request({method:'evm_setTime',params:[(midnight-15)*1000]});
 await mined(tier2.activate());
 assert.equal((await vault.balances(tier2.target)).income,0n);
 await rpc.request({method:'evm_setTime',params:[midnight*1000]});
 await rpc.request({method:'evm_mine',params:[]});
 assert.equal((await vault.balances(tier2.target)).income,dollars(7.5));
 assert.equal((await vault.balances(tier2.target)).available,dollars(6));
 const tier3=await makeReceipt(investor.address,200,ZeroAddress,3);
 await assert.rejects(tier3.activate.staticCall());
 for(const who of addresses.slice(5,9))await open(who,12,tier2.target,1);
 await assert.rejects(tier3.activate.staticCall());
 await open(addresses[9],12,tier2.target,1);
 assert.equal(await vault.qualifiedInvestors(investor.address),10n);
 await mined(tier3.activate());
 for(const [tier,under,over] of [[2,'49.99','1500.01'],[3,'199.99','2500.01']]){
   for(const principal of [under,over])await assert.rejects(factory.prepareTier.staticCall(hexlify(randomBytes(32)),investor.address,dollars(principal),ZeroAddress,tier));
 }
 await rpc.request({method:'evm_setTime',params:[(midnight+21*86400)*1000]});
 await rpc.request({method:'evm_mine',params:[]});
 assert.equal((await vault.balances(tier2.target)).income,dollars(112.5));
 assert.equal((await vault.balances(tier3.target)).income,dollars(800));
 assert.equal((await vault.balances(tier3.target)).principal,dollars(200));
});
