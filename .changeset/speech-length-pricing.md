---
"@nodaro/shared": minor
---

Length-based speech pricing, the shape of it: `speechPriceUnits(chars)` (every started 100 characters, at least `SPEECH_FLOOR_UNITS` = 8), `speechCredits(chars, perUnitCredits)`, `speechUnitCreditId(modelId)` (the model's `:per-100-chars` price-row id; the legacy `elevenlabs` alias prices as turbo), `SPEECH_PRICE_UNIT_CHARS` and `SPEECH_UNIT_CREDIT_SUFFIX`. The amount of a unit is the platform's price row, which these functions take as an argument. Additive; nothing changes for any request until a platform turns the pricing on.
