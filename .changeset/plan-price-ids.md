---
"@nodaro/sdk": minor
---

`billing.plans()` names each price's Stripe id: `prices.monthly.priceId` and `prices.yearly.priceId` on a plan (what `checkout()` and `changePlan()` take, and what the subscription's `stripe_price_id` matches), and `priceId` on a credit pack (`null` when the pack has no fixed Stripe price; a pack can always be bought as a load of its amount).
