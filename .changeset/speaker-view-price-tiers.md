---
"@nodaro/shared": minor
---

`speakerViewCreditId(quality, tier)` names Speaker View's four per-output-minute rows: `speaker-view` / `speaker-view:proxy` (the `standard` tier) and `speaker-view:complex` / `speaker-view:complex:proxy` (the `complex` tier); a tier that is not exactly `standard` names the `complex` row. `SPEAKER_VIEW_PRICE_TIERS` and `SPEAKER_VIEW_CREDIT_IDS` list them. The render-node registry's `creditId` takes an optional third argument, the render's `priceTier`, and each descriptor lists the ids it can name (`creditIds`). Ids only: which tier a render is in, and its price, are the platform's.
