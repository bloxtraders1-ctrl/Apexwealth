# 12x12

12x12 accepts manual cryptocurrency deposits into a USD wallet. After the cashier approves the deposit, the user can invest from that balance. Existing Base vault receipts and their separate settlement flow remain supported.

## Production release checks

Restore a copy of the current production database into an isolated staging service. Apply migrations 0016 through 0018 there, compare account IDs and wallet balances before and after, verify an investment through its next payday and rehearse deposit review, payout and restore. Check the front-end hostname actually points to that backend before accepting deposits. Verify how the operator will fund withdrawals from actual settlement funds. The included service and data disclosures reflect the code and require the operator’s verified legal identity, contact details, policies and jurisdiction-specific review before public release.

## Wallet paydays

Starting with migration 0016, remaining wallet investment and recurring referral credits use eligible UTC weekdays. Saturday, Sunday, and observed nationwide U.S. federal holidays do not count toward a plan’s 12, 15, or 20 credits. Credits keep their scheduled UTC time of day. Earlier credits remain on the original schedule, and a separately returned principal matures with the final credit. The calendar table includes recurring nationwide holidays through 2199. Admins can skip an additional date in Admin cashier → Payday exceptions. Enter the UTC date and an internal reason before any scheduled credits have posted for the date. The date is excluded from the remaining credit count. Existing Base vault contracts and cashier withdrawal processing are unchanged.

## Run on your computer or Render

Use Node 22.13 or newer. From the extracted project folder:

```sh
npm install
npm start
```

Open http://localhost:3000. The activity page uses confirmed transactions.

### Host on Render

Create a Node Web Service pointing to this project folder. Set the build command to `npm ci --omit=dev` and the start command to `npm start`. Use Node 22.13 or newer, and set the health check path to `/healthz`.

Set `PUBLIC_ORIGIN` to the service's HTTPS URL without a trailing slash. Attach a [Render persistent disk](https://render.com/docs/disks) and set `APEX_DB_PATH` to an absolute SQLite path on it, such as `/opt/render/project/src/storage/accounts.sqlite` for a disk mounted at `/opt/render/project/src/storage`. Keep a backup of that database. It contains the receipt information required to recover transfers.

`BASE_RPC_URL` accepts a Base mainnet RPC endpoint that supports the safe block tag. `APEX_CONFIG_JSON` accepts the content of the version 5 configuration exported from Vault setup. This lets a hosting environment load the vault and cashier addresses without editing source files. Leave it unset for local layout and account testing without live assets.

The hosted Worker stores 12x12 email/password accounts in D1. Self-hosting uses SQLite. Existing Sites identities and previous self-hosted recovery keys can still access their original receipts. /register and /login create and access Apex accounts. Customer cashier links open the wallet popup. The manual cashier supports configurable SOL, USDT TRC20, TRX, LTC, DOGE, ETH, BTC, and USDC on Ethereum or Base. Its operator checks and pays transfers externally. The existing Base investment vault has its own separate on-chain workflows and configuration. Public pages and the calculator work before cashier activation.

### Host the frontend on Vercel

1. Run this same project as the backend of a Render Node Web Service with a persistent disk. Use the commands and health check above. Set `APEX_DB_PATH` on the disk and set `PUBLIC_ORIGIN` to the exact HTTPS origin visitors use on Vercel. The backend uses it for session cookies and origin checks. Use one backend and a separate database for each environment.
2. If moving existing accounts from SQLite or D1, back up the source first. Restore to an isolated database and compare account IDs, ledger totals, available and reserved balances, pending requests, and support threads. Quiesce writes for the final export and stop serving payment writes on the old instance before switching traffic. Never upload a database file or secrets to Git or Vercel.
3. Import the project into Vercel with the framework preset set to Other. The checked-in configuration uses `npm ci` and `npm run build:vercel`. Set `APEX_API_ORIGIN` in Vercel to the HTTPS origin of the corresponding Render backend. The build emits static files and routes `/api/*`, `/config.json`, `/healthz`, and older cashier links to that backend on the visitor’s origin. It preserves the homepage and other page routes.
4. In the deployed environment, check `/healthz`, login, the wallet popup, the admin dashboard, and support. Check login cookies over HTTPS. Restart the isolated backend and check that the same account and ticket remain. Use the isolated environment to exercise deposit review, payout review, and reconciliation before using the production database.
5. Set `APEX_CASHIER_ADMIN_IDS` on the backend to the intended administrator account IDs. In Admin cashier → Networks and limits, verify that each desired network is enabled with its own receiving address, fees, minimums, and confirmations. Confirm receiving address ownership and outbound payments externally. Check Coinbase and Kraken reachability from the backend. Fund the reward reserve independently and reconcile it to its backing assets. If servicing old Base vault receipts, also supply `APEX_CONFIG_JSON` and `BASE_RPC_URL`.

To build the Vercel artifact locally in PowerShell, set `$env:APEX_API_ORIGIN = "https://your-backend.example"` and run `npm ci`, `npm test`, and `npm run build:vercel`. The artifact is written to `.vercel/output`.

## Maintain existing Base vault receipts

1. Open /operator.html using the operator's own Base wallet. Deploy a vault or attach an existing compatible vault. The operator pays Base gas in ETH.
2. Choose separate principal or principal-inclusive payouts, and the basis for the daily withdrawal cap, when deploying a new vault. These choices are immutable.
3. Fund the vault's reward reserve with native USDC. With separate principal, a 100 USDC plan with a referral needs 144 USDC of scheduled income plus 24 USDC in referral rewards in sponsor funds.
4. Select **Deploy direct cashier**, then **Register cashier**. The owner binds the factory to this vault once. Download config.json. Either set APEX_CONFIG_JSON to its content and restart the service, or replace dist/config.json and restart locally. Rebuild with npm run build before publishing the bundled Worker if you changed dist/config.json. Keep the database and the operator’s vault address across releases. Verify that /api/settlement-status reports withdrawalReady as true before servicing existing receipts.
5. Open /cashier-review with the vault owner wallet. On self-hosted installations, create or restore a site account first. A short-lived signed message unlocks the review queue. Only the operator signs activation, refund and payout transactions. Keys stay in the operator's wallet.

## Plans

| Plan | Credit per payday | Paydays | USD investment | Funded direct referrals |
| --- | --- | --- | --- | --- |
| 1 | 12% | 12 | $12–$1,200 | 0 |
| 2 | 15% | 15 | $50–$1,500 | 5 |
| 3 | 20% | 20 | $200–$2,500 | 10 |

Wallet investment credits use the invested amount. The cashier’s configured daily withdrawal cap defaults to 12% of recorded invested principal and resets at 00:00 UTC. Prior Base contracts retain their original schedule.

## Investor flow

- Open the wallet to request a cryptocurrency deposit. Send the quoted amount and submit the transaction hash. Funds become available in USD after cashier approval.
- Select **Invest** on an eligible plan and confirm the USD amount. The wallet deducts it once and records plan and referral obligations. The payday schedule above governs credits, and Profile shows the next eligible credit.
- Visit **Referrals** to copy your link after your first investment. You earn 12% of a direct referral’s first funded investment and 1% of each referred plan’s investment amount on each eligible payday.
- Open the profile icon next to the wallet to edit your account name and review all your deposit, withdrawal, investment and credit history. Existing Base receipt and withdrawal requests are listed here too.
- Open the wallet to submit a withdrawal and choose the receiving address for that request. Existing Base vault withdrawals and refund requests can be opened from the corresponding record in Profile. Previous wallet-connected positions can still be accessed at /legacy.html#portfolio.

## Verify and build

Run npm test for the local blockchain and cashier API tests. Run npm run compile after contract edits, then npm run build. The build packages the frontend and cashier endpoints into dist/server/index.js. The D1 migration is in drizzle/. Production receipts and review queues must be served by the backend.

The revised affiliate terms require the updated vault. Existing contracts retain the rules they were deployed with. Mainnet activation requires the operator's deployment, configuration and funding. The contracts have local integration coverage and have not received an independent audit.

## Per-withdrawal destinations

New version 5 receipts use a deposit refund address for refunds and investor identity. For each withdrawal request, investors enter the amount and a new or existing receiving address on Base. The admin cashier shows the queued destination, and a request is marked paid only after the receipt's on-chain record matches the queued destination and amount. Earlier receipts continue to use the receiving address in their original contract. Deploy and fund the updated vault and register the new cashier before accepting version 5 deposits.


## Manual cryptocurrency cashier

The existing 12x12 account is the identity for all manual requests. The additive 0004 migration creates the manual USD ledger, quote snapshots, request queues, and audit trail. Existing on-chain receipts and their balances continue through /profile and /cashier-review. The manual cashier and admin console are the wallet popup and /admin/cashier.

### Set up locally

1. From the project folder, run **npm ci --omit=dev** and **npm start**. Open [the wallet popup](http://localhost:3000/?wallet=deposit) and register or log in with the account that will operate the cashier.
2. Open the profile icon and copy the **Account ID**.
3. Stop the server and run these commands in PowerShell. For multiple administrators, use comma-separated account IDs.

       $env:APEX_CASHIER_ADMIN_IDS = "paste-the-cashier-account-id"
       npm start

4. Open [Admin cashier](http://localhost:3000/admin/cashier) → **Networks and limits**. Enter real receiving addresses you control. Set minimums, maximums, withdrawal fees, and required withdrawal confirmations. Verify the wallet and quote before enabling each option. Signed-in users see the address on a deposit quote. The initial deposit minimum is $12 and deposit fees are zero.
5. On Render keep the existing database path and hosting commands. Add **APEX_CASHIER_ADMIN_IDS** to the service environment. For Sites, add the same server-side variable and deploy the Worker build with all pending migrations, including 0016 through 0018. Allow outbound HTTPS to Kraken and Coinbase for USD spot quotes. The cashier uses Kraken first and falls back to Coinbase. These public endpoints require no API key. A failed quote leaves the request uncreated. Operators pay externally with their existing wallets.

### Reconcile wallet obligations

The admin funding balance is an internal bookkeeping figure. Players do not fund it to earn credits. Separately reconcile the actual crypto available for withdrawals against outstanding wallet balances and obligations.

### Review and settlement

- A quote records the market rate, provider, and crypto amount. The cashier can review a submitted deposit any time after the user submits its transaction hash.
- In **Deposit queue**, open **Verify deposit**. Compare the transfer with the quote in the explorer and record the verified network, receiving address, amount, token contract if applicable, confirmations, UTC block time and transfer index when required. Verify that it belongs to the depositor before approving. Migration 0017 rejects new evidence-free approvals and preserves historical approvals.
- After a quote expires, review is still possible if the transfer was included in a block during the original quote window. A late or mismatched transfer stays pending for manual reconciliation. Check custody records and arrange any refund externally before rejecting, then record the reconciliation in the rejection note.
- The manual USD balance is separate from the Base investment vault. The manual cap starts at **12% of recorded invested USD principal**, per UTC day, including wallet investments and eligible legacy receipts. It includes fees and all outstanding or paid requests created that day. Accounts with no recorded funded principal have no manual withdrawal allowance. Approved deposits add USD cash, and investment is a separate action from the Plans page.
- Withdrawal confirmation reserves the quoted USD amount plus its flat fee. The quote ID is the idempotency key. After an interruption, reopen the cashier in the same tab or inspect history. A user can cancel a pending request and an admin can reject and refund it before the broadcast lock.
- In **Withdrawal queue**, choose **Approve** to claim the payout, or **Reject** to refund the reservation. The cashier who approves sends once from an external wallet, then reopens **Approve** to record the hash and verify the transfer. If sending is interrupted, check the wallet before attempting a transfer again. Rejection is unavailable once the payout has been approved for sending.
- Bitcoin and Litecoin support mainnet Base58Check and SegWit. Dogecoin uses Base58Check. The administrator configures availability and terms for the bundled choices.

Run **npm ci**, **npm test**, and **npm run build** for development validation. The tests use local databases and fixture prices. Verify live quotes and your actual custody paths for each intended network before using customer funds.

### Cashier user management

Open Admin cashier → Users to find accounts by username or account ID, review their USD balance, reserved withdrawals, manual ledger, and Base receipt history. Holds prevent new manual quotes, withdrawal reservations, and the start of a payout. Deposit submissions under prior quotes and in-flight payouts can still be reconciled. Each hold or resume is recorded with its reason and administrator ID. IDs and accounts are drawn from existing 12x12 logins, receipts, quotes, and requests.

The operator supplied opening totals of $356,651.25 deposited and $324,849.65 paid out from the prior project. Migration 0006 snapshots any already confirmed activity in the current database to avoid counting it twice. Newly confirmed deposits and payouts increase the corresponding homepage total. This import creates no customer balance or transaction entries.

### Email sign-in

New accounts register and log in with an email address and password. Existing username accounts can choose **Link email to an existing account** on the login page, enter their existing credentials, and link an unused email address. The original account ID, balances, and cashier permissions remain in effect. The registration form does not send an email verification or password-reset message.

### Google sign-in

Create a **Web application** OAuth client in Google Auth Platform. Register
`https://www.12x12.online/api/google/callback` as the authorized redirect URI for
production (use your exact frontend origin for other deployments). Register
a separate client and callback for staging. For local development the callback
can be `http://localhost:3000/api/google/callback`.

Set these variables on the backend (Render Node service or the Worker):

- `GOOGLE_CLIENT_ID` — the Google OAuth web client ID.
- `GOOGLE_CLIENT_SECRET` — the OAuth client secret. Keep it in the backend's secret settings.
- `GOOGLE_REDIRECT_URI` — the exact registered callback, including `/api/google/callback`.

For a Vercel frontend and Render backend, set Render's `PUBLIC_ORIGIN` to
`https://www.12x12.online`. The existing Vercel `/api/*` rewrite sends the
start and callback requests to Render on the frontend origin. The Google buttons
appear on the login and registration pages. They start Google authentication
when all three settings match the current origin. Email/password works independently.

Node service startup applies migration 0019 automatically to SQLite or Turso.
Apply it to the bound D1 database before deploying the Worker. Existing
members must sign in with their password and confirm it in Profile to link
Google. A Google-only account uses the same account and session tables.
