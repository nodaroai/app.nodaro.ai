---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Plans and prices: `client.billing` — `plans()` lists the plans and credit packs on sale with what each costs (`GET /v1/billing/plans`, public: it works signed out, Nodaro Cloud only); `subscription()` returns the account's subscription and the tier its entitlements follow (`effectiveTier` — match it to a plan `id` to mark the current plan); `surface()` and `account()` read how the deployment bills and the caller's plan and balance in its unit. Prices are `{ amount, currency }` in the currency's major unit; each price carries what it grants (`credits: { amount, per }`, `null` when not stated), the free plan its one-time `signupCredits`; a price that cannot be stated right now is `null`, never free. Buying stays in the Nodaro app. New CLI commands: `nodaro billing plans | subscription | account | surface` — `plans` and `surface` need no sign-in (`--base-url` to ask another instance).
