// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IUSDC {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// A finite, sponsor-funded programme. No external yield strategy or admin claim on liabilities.
contract ApexVault {
    IUSDC public immutable token;
    address public immutable owner;
    bool public immutable separatePrincipal;
    bool public immutable capOnBalance;
    uint256 public locked;
    uint256 public constant MIN = 12e6;
    uint256 public constant MAX = 1200e6;
    uint256 private constant MAX_TERM = 20;
    address public cashier;
    mapping(address => address) private receiptOwners;
    mapping(address => uint256) public qualifiedInvestors;
    mapping(address => bool) private previouslyInvested;
    mapping(address => uint8) public positionTier;
    mapping(address => address) private referralSponsor;
    mapping(address => uint256) private rewardCheckpoint;
    mapping(address => mapping(uint256 => uint256)) private rewardsOnDay;

    function setCashier(address factory) external {
        require(msg.sender == owner && cashier == address(0) && factory.code.length > 0, "Invalid cashier");
        cashier = factory;
    }
    function registerReceipt(address receipt, address beneficiary) external {
        require(msg.sender == cashier && receiptOwners[receipt] == address(0) && beneficiary != address(0), "Invalid receipt");
        receiptOwners[receipt] = beneficiary;
    }
    function identityOf(address position) public view returns (address) {
        address beneficiary = receiptOwners[position];
        return beneficiary == address(0) ? position : beneficiary;
    }
    function terms(uint8 tier) public pure returns (uint256 minimum, uint256 maximum, uint256 rate, uint256 daysInTerm, uint256 referrals) {
        if (tier == 1) return (MIN, MAX, 12, 12, 0);
        if (tier == 2) return (50e6, 1500e6, 15, 15, 5);
        require(tier == 3, "Unknown plan");
        return (200e6, 2500e6, 20, 20, 10);
    }

    struct Plan {
        uint256 principal;
        uint256 start;
        uint256 paid;
        uint256 principalPaid;
        address referrer;
    }
    struct Account {
        uint256 bonus;
        uint256 totalBonus;
        uint256 referredPlans;
        uint256 totalWithdrawn;
        uint256 day;
        uint256 spent;
        uint256 limit;
    }
    mapping(address => Plan) public plans;
    mapping(address => Account) private accountRecords;
    event Opened(address indexed investor, uint256 amount, address indexed referrer);
    event Withdrawal(address indexed investor, uint256 amount);
    event Commission(address indexed referrer, address indexed investor, uint256 amount);
    event Funded(address indexed sponsor, uint256 amount);

    constructor(address usdc, bool returnPrincipal, bool balanceBasedCap) {
        require(IUSDC(usdc).decimals() == 6, "Expected a six-decimal token");
        token = IUSDC(usdc);
        owner = msg.sender;
        separatePrincipal = returnPrincipal;
        capOnBalance = balanceBasedCap;
    }
    function reserve() public view returns (uint256) {
        return token.balanceOf(address(this)) - locked;
    }
    function fund(uint256 amount) external {
        require(amount > 0 && token.transferFrom(msg.sender, address(this), amount), "Funding failed");
        emit Funded(msg.sender, amount);
    }
    function releaseReserve(uint256 amount) external {
        require(msg.sender == owner && amount <= reserve(), "Unallocated reserve only");
        require(token.transfer(owner, amount), "Transfer failed");
    }
    function scheduled(uint256 amount) public pure returns (uint256) {
        return scheduledFor(1, amount);
    }
    function scheduledFor(uint8 tier, uint256 amount) public pure returns (uint256) {
        (,,uint256 rate,uint256 term,) = terms(tier);
        return (amount * rate / 100) * term;
    }
    function referralTerms(uint8 tier, address investor, uint256 amount, address referrer)
        public view returns (address sponsor, uint256 initialBonus, uint256 dailyBonus, uint256 total)
    {
        investor = identityOf(investor);
        sponsor = referralSponsor[investor];
        if (sponsor == address(0)) sponsor = referrer;
        else require(referrer == address(0) || referrer == sponsor, "Existing referrer cannot change");
        if (sponsor == address(0)) return (address(0), 0, 0, 0);

        require(identityOf(sponsor) != investor && plans[sponsor].principal != 0, "Invalid referrer");
        (,,,uint256 term,) = terms(tier);
        initialBonus = previouslyInvested[investor] ? 0 : amount * 12 / 100;
        dailyBonus = amount / 100;
        total = initialBonus + dailyBonus * term;
    }
    function accruedReferral(address sponsor) private view returns (uint256 accrued) {
        uint256 checkpoint = rewardCheckpoint[sponsor];
        if (checkpoint == 0) return 0;

        uint256 today = block.timestamp / 1 days;
        // Every schedule starts at a checkpoint and extends at most MAX_TERM days.
        uint256 through = checkpoint + MAX_TERM;
        if (today < through) through = today;
        for (uint256 day = checkpoint + 1; day <= through; day++) {
            accrued += rewardsOnDay[sponsor][day];
        }
    }
    function settleReferral(address sponsor) private {
        uint256 accrued = accruedReferral(sponsor);
        rewardCheckpoint[sponsor] = block.timestamp / 1 days;
        accountRecords[sponsor].bonus += accrued;
        accountRecords[sponsor].totalBonus += accrued;
    }
    function accounts(address who) external view returns (
        uint256 bonus, uint256 totalBonus, uint256 referredPlans, uint256 totalWithdrawn,
        uint256 day, uint256 spent, uint256 limit
    ) {
        Account storage account = accountRecords[who];
        uint256 accrued = accruedReferral(who);
        return (
            account.bonus + accrued, account.totalBonus + accrued, account.referredPlans,
            account.totalWithdrawn, account.day, account.spent, account.limit
        );
    }
    function scheduleReferral(uint8 tier, address investor, uint256 amount, address referrer)
        private returns (address sponsor, uint256 total)
    {
        uint256 first;
        uint256 daily;
        (sponsor, first, daily, total) = referralTerms(tier, investor, amount, referrer);
        if (sponsor == address(0)) return (sponsor, total);

        referralSponsor[investor] = sponsor;
        settleReferral(sponsor);
        Account storage account = accountRecords[sponsor];
        if (!previouslyInvested[investor]) {
            qualifiedInvestors[identityOf(sponsor)]++;
            account.referredPlans++;
        }
        account.bonus += first;
        account.totalBonus += first;
        if (first != 0) emit Commission(sponsor, msg.sender, first);

        (,,,uint256 term,) = terms(tier);
        uint256 today = block.timestamp / 1 days;
        for (uint256 offset = 1; offset <= term; offset++) {
            rewardsOnDay[sponsor][today + offset] += daily;
        }
    }
    function open(uint256 amount, address referrer) external {
        openTier(1, amount, referrer);
    }
    function openTier(uint8 tier, uint256 amount, address referrer) public {
        (uint256 minimum,uint256 maximum,,,uint256 required) = terms(tier);
        require(amount >= minimum && amount <= maximum, "Deposit outside plan limits");
        address investor = identityOf(msg.sender);
        require(qualifiedInvestors[investor] >= required, "More funded referrals required");
        Plan storage old = plans[msg.sender];
        if (old.principal != 0) {
            require(old.paid == scheduledFor(positionTier[msg.sender], old.principal) && (!separatePrincipal || old.principalPaid == old.principal), "Finish current plan first");
        }
        uint256 full = scheduledFor(tier, amount);
        uint256 liability = full + (separatePrincipal ? amount : 0);
        (address sponsor, uint256 referralTotal) = scheduleReferral(tier, investor, amount, referrer);
        liability += referralTotal;
        previouslyInvested[investor] = true;
        positionTier[msg.sender] = tier;
        require(reserve() >= liability - amount, "Sponsor reserve too low");
        require(token.transferFrom(msg.sender, address(this), amount), "Deposit failed");
        locked += liability;
        plans[msg.sender] = Plan(amount, block.timestamp, 0, 0, sponsor);
        emit Opened(msg.sender, amount, sponsor);
    }
    function balances(address who) public view returns (uint256 income, uint256 principal, uint256 bonus, uint256 available) {
        Plan memory plan = plans[who];
        Account storage account = accountRecords[who];
        if (plan.principal == 0) return (0,0,0,0);
        (,,uint256 rate,uint256 term,) = terms(positionTier[who]);
        uint256 daysElapsed = block.timestamp / 1 days - plan.start / 1 days;
        if (daysElapsed > term) daysElapsed = term;
        income = plan.principal * rate / 100 * daysElapsed - plan.paid;
        principal = separatePrincipal && daysElapsed == term ? plan.principal - plan.principalPaid : 0;
        bonus = account.bonus + accruedReferral(who);
        uint256 ready = income + principal + bonus;
        uint256 limit = account.day == block.timestamp / 1 days ? account.limit : dailyLimit(plan.principal, ready);
        uint256 spent = account.day == block.timestamp / 1 days ? account.spent : 0;
        available = limit > spent ? limit - spent : 0;
        if (available > ready) available = ready;
    }
    function dailyLimit(uint256 principal, uint256 ready) private view returns (uint256) {
        // Round the balance-based cap up to one atomic USDC unit so a final dust amount can clear.
        return capOnBalance ? (ready * 12 + 99) / 100 : principal * 12 / 100;
    }
    function claim(uint256 amount) external {
        settleReferral(msg.sender);
        (uint256 income, uint256 principal, uint256 bonus, uint256 available) = balances(msg.sender);
        require(amount > 0 && amount <= available, "Exceeds withdrawable amount");
        Plan storage plan = plans[msg.sender];
        Account storage account = accountRecords[msg.sender];
        uint256 day = block.timestamp / 1 days;
        if (account.day != day) {
            account.day = day;
            account.limit = dailyLimit(plan.principal, income + principal + bonus);
            account.spent = 0;
        }
        account.spent += amount;
        account.totalWithdrawn += amount;
        uint256 incomeTaken = amount < income ? amount : income;
        uint256 rest = amount - incomeTaken;
        uint256 bonusTaken = rest < bonus ? rest : bonus;
        account.bonus -= bonusTaken;
        plan.principalPaid += rest - bonusTaken;
        plan.paid += incomeTaken;
        locked -= amount;
        require(token.transfer(msg.sender, amount), "Transfer failed");
        emit Withdrawal(msg.sender, amount);
    }
}
