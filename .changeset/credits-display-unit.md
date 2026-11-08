---
"@nodaro/sdk": minor
---

The credit reads carry an optional `display` object on a deployment that shows its own unit instead of credits: the same figures, converted by the server, with the unit's label and decimals. `client.credits.balance()` (`UserBalance.display`), `client.credits.modelCosts()` (`ModelCostsResult.display`) and the single-id lookup's `ModelCostResult.display`. Render these instead of converting credits yourself; `null` in them means unavailable, never zero. `UserBalance` also types `allowance`, the per-user allowance the server sends on a deployment with a single payer. Absent elsewhere, and every existing field is unchanged.
