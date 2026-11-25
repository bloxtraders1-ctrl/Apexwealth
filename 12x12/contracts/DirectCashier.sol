// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
interface DepositToken {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}
interface PlanVault {
    function token() external view returns (DepositToken);
    function owner() external view returns (address);
    function openTier(uint8 tier, uint256 amount, address referrer) external;
    function registerReceipt(address receipt,address beneficiary) external;
    function terms(uint8 tier) external pure returns(uint256,uint256,uint256,uint256,uint256);
    function claim(uint256 amount) external;
    function balances(address account) external view returns (uint256,uint256,uint256,uint256);
}
// Each receipt fixes its amount, referrer, investor identity, and deposit refund address.
contract DepositReceipt {
    PlanVault public immutable vault;
    address public immutable beneficiary;
    address public immutable referral;
    uint256 public immutable amount;
    uint8 public immutable tier;
    bool public active;
    bool public cancelled;
    mapping(bytes32 => bool) public processed;
    mapping(bytes32 => bytes32) public paymentCommitment;

    constructor(PlanVault v, address recipient, uint256 principal, address referrer, uint8 planTier) {
        (uint256 min,uint256 max,,,) = v.terms(planTier);
        require(recipient != address(0) && principal >= min && principal <= max);
        tier = planTier;
        vault=v; beneficiary=recipient; amount=principal; referral=referrer;
    }
    function activate() external {
        require(!active && !cancelled && msg.sender == vault.owner(), "Cashier approval required");
        active=true;
        require(vault.token().approve(address(vault),amount));
        vault.openTier(tier,amount,referral);
        returnLooseFunds();
    }
    function refund() external {
        require(msg.sender == vault.owner() || msg.sender == beneficiary, "Unauthorised");
        if(!active) cancelled=true;
        returnLooseFunds();
    }
    function payTo(bytes32 requestId, uint256 requested, address destination) external {
        require(active && !processed[requestId] && msg.sender == vault.owner(), "Invalid withdrawal");
        require(destination != address(0) && destination != address(this) && destination != address(vault), "Invalid destination");
        processed[requestId] = true;
        paymentCommitment[requestId] = keccak256(abi.encodePacked(destination, requested));
        vault.claim(requested);
        require(vault.token().transfer(destination, requested));
    }
    function returnLooseFunds() internal {
        DepositToken t=vault.token();uint256 balance=t.balanceOf(address(this));
        if(balance!=0) require(t.transfer(beneficiary,balance));
    }
}
contract DirectCashier {
    PlanVault public immutable vault;
    constructor(PlanVault v){require(address(v.token())!=address(0));vault=v;}
    function addressFor(bytes32 salt,address recipient,uint256 amount,address referrer) public view returns(address) {
        return addressForTier(salt,recipient,amount,referrer,1);
    }
    function addressForTier(bytes32 salt,address recipient,uint256 amount,address referrer,uint8 tier) public view returns(address) {
        bytes32 initHash=keccak256(abi.encodePacked(type(DepositReceipt).creationCode,abi.encode(vault,recipient,amount,referrer,tier)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff),address(this),salt,initHash)))));
    }
    function prepare(bytes32 salt,address recipient,uint256 amount,address referrer) external returns(address) {
        return prepareTier(salt,recipient,amount,referrer,1);
    }
    function prepareTier(bytes32 salt,address recipient,uint256 amount,address referrer,uint8 tier) public returns(address) {
        address target=addressForTier(salt,recipient,amount,referrer,tier);
        if(target.code.length==0) {
            new DepositReceipt{salt:salt}(vault,recipient,amount,referrer,tier);
            vault.registerReceipt(target,recipient);
        }
        return target;
    }
}
