# Billing System (Paddle) -- Cloud Edition Only

Nodaro.ai uses [Paddle](https://www.paddle.com/) as its Merchant of Record for the Cloud edition.
Billing is gated behind `BILLING_PROVIDER=paddle` and `EDITION=cloud` environment variables.

---

## Architecture Overview

```
User (Frontend)
  |
  |-- /pricing page --> Paddle.js checkout (new subscriber)
  |                 --> POST /v1/billing/change-plan (existing subscriber)
  |-- /billing page --> GET /v1/billing/subscription
  |                 --> GET /v1/billing/transactions
  |                 --> POST /v1/billing/manage-subscription (portal URL)
  |
  v
Next.js Proxy (rewrites /v1/* --> backend:8000/v1/*)
  |
  v
Backend (Fastify)
  |-- routes/billing.ts         (subscription, transactions, change-plan, portal)
  |-- routes/paddle-webhook.ts  (POST /v1/billing/paddle-webhook)
  |-- billing/paddle-config.ts  (price IDs, tier mappings, credit allocations)
  |-- billing/paddle-client.ts  (Paddle SDK singleton)
  |-- billing/provision-credits.ts (webhook event handlers)
  |-- billing/cleanup-service.ts   (R2 media cleanup)
  |-- billing/cleanup-cron.ts      (scheduled cleanup jobs)
  |
  v
Supabase (PostgreSQL)
  |-- subscriptions table
  |-- transactions table
  |-- paddle_customers table
  |-- profiles table (tier, credits, storage)
```

---

## Subscription Tiers

| Tier | Monthly | Annual | Credits/mo | LLM Requests | Storage | Paddle Price Key |
|------|---------|--------|-----------|-------------|---------|-----------------|
| Free | $0 | $0 | 50 | 20 | 1 GB | n/a |
| Basic | $24/mo | $19/mo ($228/yr) | 95 | 100 | 10 GB | `basic_monthly` |
| Standard | $49/mo | $39/mo ($468/yr) | 235 | 300 | 25 GB | `standard_monthly` |
| Pro | $99/mo | $79/mo ($948/yr) | 530 | 1,000 | 50 GB | `pro_monthly` |
| Business | $189/mo | $149/mo ($1,788/yr) | 1,120 | Unlimited | 200 GB | `business_monthly` |

## Top-up Packages

| Package | Price | Credits | Per Credit | Paddle Price Key |
|---------|-------|---------|------------|-----------------|
| Pack A | $10 | 55 | $0.18 | `credits_55` |
| Pack B | $25 | 150 | $0.17 | `credits_150` |
| Pack C | $50 | 330 | $0.15 | `credits_330` |
| Pack D | $100 | 700 | $0.14 | `credits_700` |

Top-up credits never expire and are deducted after subscription credits.

---

## API Routes

### Backend: `routes/billing.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/billing/subscription?userId=` | Current subscription info |
| GET | `/v1/billing/transactions?userId=` | Transaction history (limit 50) |
| POST | `/v1/billing/manage-subscription` | Get Paddle customer portal URL |
| POST | `/v1/billing/change-plan` | Change subscription tier via Paddle API |

### Backend: `routes/paddle-webhook.ts`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/billing/paddle-webhook` | Paddle webhook receiver |

---

## Subscription Lifecycle

### New Subscription
1. User visits `/pricing`, clicks "Subscribe"
2. `openCheckout()` opens Paddle.js overlay with `customData: { userId }`
3. Paddle processes payment, redirects to `/billing?success=true`
4. Paddle fires `subscription.created` webhook
5. `handleSubscriptionCreated()`: inserts subscription row, updates profile (tier, credits, storage)

### Plan Change (Upgrade/Downgrade)
1. Subscribed user visits `/pricing`, clicks "Switch Plan"
2. Frontend calls `POST /v1/billing/change-plan` with `{ userId, newPriceId }`
3. Backend calls `paddle.subscriptions.update()` with `prorationBillingMode: "prorated_immediately"`
4. Paddle fires `subscription.updated` webhook
5. `handleSubscriptionUpdated()`:
   - **Upgrade**: grants credit difference immediately via `add_subscription_credits` RPC
   - **Downgrade**: updates tier immediately, credits adjust at next renewal

**Note:** After step 3, the backend now immediately updates the local DB (subscriptions + profiles tables) with the new tier, credits, and storage limit. The webhook in step 4-5 serves as backup reconciliation.

**IMPORTANT**: Never call `openCheckout()` for subscribed users -- this creates a duplicate subscription.

### Subscription Renewal
1. Paddle fires `subscription.updated` webhook with new billing period
2. `handleSubscriptionUpdated()` detects `currentPeriodStart` changed (renewal)
3. Resets `subscription_credits` to tier allocation, resets `llm_requests_used` to 0

### Cancellation (Immediate Downgrade)
1. User cancels via Paddle customer portal (accessed via `POST /v1/billing/manage-subscription`)
2. Paddle fires `subscription.canceled` webhook (fires immediately for instant cancel, or at period end for scheduled cancel)
3. `handleSubscriptionCanceled()` always downgrades the user immediately:
   - Sets subscription status to `canceled` with `canceled_at` timestamp
   - Downgrades profile: `tier = "free"`, `subscription_credits = min(current, 50)`, `storage_limit_bytes = 1 GB`
   - Sets `subscription_ended_at = now` (starts 60-day media grace period)
4. Topup credits are NOT affected (they never expire)
5. After 60 days past `subscription_ended_at`: R2 media cleanup cron deletes stored files

**Safety net**: The `expireSubscriptions` cron (hourly) catches any canceled subscriptions where the webhook-based downgrade failed. It checks if the user is still on a paid tier and downgrades if so, then marks the subscription as `expired` to prevent reprocessing.

### Other Status Events
- `subscription.past_due`: updates status, logs warning
- `subscription.paused`: updates status to "paused"
- `subscription.resumed`: updates status to "active"
- `transaction.payment_failed`: logs error (no automatic action)

---

## Top-up Purchase Flow

1. User visits `/billing`, clicks a top-up pack
2. `openCheckout()` opens Paddle.js with top-up price ID + `customData: { userId }`
3. Paddle fires `transaction.completed` webhook
4. `handleTransactionCompleted()`:
   - Skips subscription-related transactions (`subscriptionId` present)
   - Checks idempotency (transaction already recorded?)
   - Resolves user via `paddle_customers` table or `customData.userId` fallback
   - Calls `add_topup_credits` RPC to grant credits
   - Records transaction in `transactions` table

---

## Webhook System

### Endpoint
`POST /v1/billing/paddle-webhook`

The webhook URL configured in the Paddle dashboard **must** match the deployment domain:
- Local testing: `https://<ngrok-id>.ngrok-free.app/v1/billing/paddle-webhook`
- Production: `https://yourdomain.com/v1/billing/paddle-webhook`

### Signature Verification
Uses `paddle.webhooks.unmarshal(rawBody, PADDLE_WEBHOOK_SECRET, signature)`.
The raw body is captured via a scoped Fastify content-type parser (does not affect other routes).

### Idempotency
All webhook handlers check for existing records before inserting:
- `subscription.created`: checks `paddle_subscription_id` exists
- `transaction.completed`: checks `paddle_transaction_id` exists

### Events Handled

| Event | Handler | Action |
|-------|---------|--------|
| `subscription.created` | `handleSubscriptionCreated` | Create sub row, update profile |
| `subscription.updated` | `handleSubscriptionUpdated` | Tier change or renewal |
| `subscription.canceled` | `handleSubscriptionCanceled` | Downgrade to free tier immediately |
| `subscription.past_due` | `updateSubscriptionStatus` | Update status to past_due |
| `subscription.paused` | `updateSubscriptionStatus` | Update status to paused |
| `subscription.resumed` | `updateSubscriptionStatus` | Update status to active |
| `transaction.completed` | `handleTransactionCompleted` | Grant top-up credits |
| `transaction.payment_failed` | (log only) | Log error |

---

## Dual-Pool Credit System

Credits are stored in two pools on the `profiles` table:
- `subscription_credits` -- granted monthly, reset at each billing period
- `topup_credits` -- purchased via top-up packs, never expire

**Deduction order**: subscription credits first, then topup credits.
Handled atomically by the `deduct_credits` PostgreSQL RPC function with `FOR UPDATE` locks.

### Credit Flow Per Job
1. **Reserve**: Before job creation, `creditGuard` middleware checks balance + reserves credits
2. **Process**: Job runs (API call to provider)
3. **Commit**: On success, commit actual cost, refund overestimate difference
4. **Refund**: On failure, full refund of reserved credits

---

## Frontend Files

| File | Purpose |
|------|---------|
| `app/pricing/page.tsx` | Subscription tiers, plan change, new checkout |
| `app/(dashboard)/billing/page.tsx` | Current plan, credit balance, transaction history, top-ups |
| `lib/paddle.ts` | Paddle.js initialization + `openCheckout()` |
| `lib/pricing-data.ts` | Tier and top-up constants (prices, credits, features) |
| `lib/api.ts` | `getSubscription()`, `changePlan()`, `getManageSubscriptionUrl()` |
| `components/credits/CreditBalance.tsx` | Toolbar balance widget (auto-refresh 30s) |
| `components/credits/GenerateButton.tsx` | Config panel button with cost display |
| `components/credits/InsufficientCreditsModal.tsx` | Insufficient balance modal |
| `components/credits/StorageExceededModal.tsx` | Storage quota exceeded modal |
| `app/(dashboard)/library/page.tsx` | File management with storage summary |

---

## Database Tables

### `subscriptions`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (FK profiles) | |
| paddle_subscription_id | TEXT | Paddle sub ID |
| paddle_price_id | TEXT | Current price ID |
| tier | TEXT | basic/standard/pro/business |
| status | TEXT | active/past_due/paused/canceled/expired |
| current_period_start | TIMESTAMPTZ | |
| current_period_end | TIMESTAMPTZ | |
| canceled_at | TIMESTAMPTZ | When user canceled |
| updated_at | TIMESTAMPTZ | Last webhook update |
| created_at | TIMESTAMPTZ | |

### `transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (FK profiles) | |
| paddle_transaction_id | TEXT (UNIQUE) | Idempotency key |
| type | TEXT | subscription/topup |
| amount_usd | NUMERIC | |
| credits_granted | INTEGER | |
| tier | TEXT | null for topups |
| created_at | TIMESTAMPTZ | |

### `paddle_customers`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (FK profiles) | |
| paddle_customer_id | TEXT (UNIQUE) | Paddle customer ID |

---

## Environment Variables

### Backend (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `PADDLE_API_KEY` | Yes | Paddle API key (sandbox or production) |
| `PADDLE_WEBHOOK_SECRET` | Yes | Webhook signature verification secret |
| `PADDLE_PRICE_BASIC` | No | Annual basic tier price ID (current default) |
| `PADDLE_PRICE_STANDARD` | No | Annual standard tier price ID (current default) |
| `PADDLE_PRICE_PRO` | No | Annual pro tier price ID (current default) |
| `PADDLE_PRICE_BUSINESS` | No | Annual business tier price ID (current default) |
| `PADDLE_PRICE_BASIC_MONTHLY` | No | Monthly basic tier price ID (not yet created) |
| `PADDLE_PRICE_STANDARD_MONTHLY` | No | Monthly standard tier price ID (not yet created) |
| `PADDLE_PRICE_PRO_MONTHLY` | No | Monthly pro tier price ID (not yet created) |
| `PADDLE_PRICE_BUSINESS_MONTHLY` | No | Monthly business tier price ID (not yet created) |
| `PADDLE_PRICE_CREDITS_55` | No | Override 55-credit topup price ID |
| `PADDLE_PRICE_CREDITS_150` | No | Override 150-credit topup price ID |
| `PADDLE_PRICE_CREDITS_330` | No | Override 330-credit topup price ID |
| `PADDLE_PRICE_CREDITS_700` | No | Override 700-credit topup price ID |
| `BILLING_PROVIDER` | Yes | Set to `paddle` to enable billing |
| `EDITION` | Yes | Set to `cloud` for billing features |

**Note:** Currently only annual Paddle price IDs exist. The `PADDLE_PRICE_BASIC/STANDARD/PRO/BUSINESS` env vars hold the **annual** price IDs. Monthly price IDs need to be created in the Paddle dashboard and added via the `_MONTHLY` env vars. Until then, the frontend falls back to `null` for monthly prices and the monthly toggle option will not trigger a checkout.

### Frontend (.env.local)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | Yes | Paddle client-side token |
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | Yes | `sandbox` or `production` |
| `NEXT_PUBLIC_PADDLE_PRICE_BASIC` | No | Annual basic tier price ID |
| `NEXT_PUBLIC_PADDLE_PRICE_STANDARD` | No | Annual standard tier price ID |
| `NEXT_PUBLIC_PADDLE_PRICE_PRO` | No | Annual pro tier price ID |
| `NEXT_PUBLIC_PADDLE_PRICE_BUSINESS` | No | Annual business tier price ID |
| `NEXT_PUBLIC_PADDLE_PRICE_BASIC_MONTHLY` | No | Monthly basic tier price ID (not yet created) |
| `NEXT_PUBLIC_PADDLE_PRICE_STANDARD_MONTHLY` | No | Monthly standard tier price ID (not yet created) |
| `NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY` | No | Monthly pro tier price ID (not yet created) |
| `NEXT_PUBLIC_PADDLE_PRICE_BUSINESS_MONTHLY` | No | Monthly business tier price ID (not yet created) |
| `NEXT_PUBLIC_EDITION` | Yes | Set to `cloud` for billing UI |

---

## Testing with ngrok

Paddle rejects `localhost` for checkout and webhooks. Use ngrok for testing:

1. Start backend: `npm run dev` (port 8000)
2. Start frontend: `npm run dev` (port 3000)
3. Start ngrok: `ngrok http 3000`
4. Set Paddle webhook URL to `https://<ngrok-id>.ngrok-free.app/v1/billing/paddle-webhook`
5. Add ngrok URL to Supabase Auth > Redirect URLs: `https://*.ngrok-free.app/**`
6. Access app via ngrok URL (Next.js proxy routes API calls to backend automatically)

The Google OAuth `redirectTo` in `use-auth.ts` already uses `window.location.origin`,
so it redirects back to the ngrok URL after login.

---

## Storage Management

### Quota Enforcement
- **Single source of truth:** `TIER_STORAGE_LIMITS` in `backend/src/billing/paddle-config.ts` (Free=1GB, Basic=10GB, Standard=25GB, Pro=50GB, Business=200GB)
- DB-first check: `storage_limit_bytes` in profiles takes precedence (supports admin overrides), falls back to `TIER_STORAGE_LIMITS[tier]`
- Enforced in `credit-guard.ts` middleware (before credit check) and upload routes
- Self-hosted (`hasCredits() = false`): no enforcement
- HTTP 413 `storage_limit_exceeded` error with usedBytes/quotaBytes/remainingBytes/tier

### Admin Override
- `PUT /v1/admin/users/:id/storage` -- set custom storage limit per user
- Admin Users page shows storage progress bar per user with tier presets + custom GB input

### Frontend UI
- **StorageExceededModal** (`components/credits/StorageExceededModal.tsx`): shown on execution errors (`workflow-editor.tsx`) and upload errors (`use-file-upload.ts`), with "Upgrade Plan" and "Manage Files" CTAs
- **Billing page storage section**: usage bar between Credit Balance and Transaction History, upgrade prompt at 70%+, "Manage Files" link to /library
- **Library page** (`/library`): file management with storage summary, filter tabs, thumbnails, multi-select delete, cursor pagination, `owned=true` filter

---

## Cleanup and Retention

- **Active subscribers**: media files kept indefinitely
- **Free/canceled users**: 60-day grace period, then R2 media cleanup
- **Workflows**: never deleted (only media files)
- **Cleanup cron**: runs hourly (expire subscriptions safety net) + daily 3AM UTC (R2 media)
- **Subscription statuses**: `active` -> `canceled` (webhook downgrade) -> `expired` (cron marks processed)
- **Storage tracking**: `profiles.storage_used_bytes` updated on file upload/delete
- **Storage limit**: enforced at upload time, limit set per tier in `TIER_STORAGE_LIMITS`
