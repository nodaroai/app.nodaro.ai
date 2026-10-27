---
"@nodaro/sdk": minor
---

`client.userSettings.get()` / `update(patch)`: the signed-in person's own settings (`GET` / `PATCH /v1/user/settings`) — the interface language, the gallery visibility, the node-menu and canvas preferences, and `monthlyStatementEmail`, the monthly credit statement opt-in. This release is also the first on npm to carry the Stripe price ids on `billing.plans()` (`prices.monthly.priceId`, `prices.yearly.priceId`, a pack's `priceId`), listed under 2.51.0 in the changelog but published after it.
