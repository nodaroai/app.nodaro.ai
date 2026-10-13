---
"@nodaro/shared": minor
---

Speech quotes that equal the charge: `speechQuoteCreditId(model, units)` names the exact price of a whole length-priced speech request (`<model>:per-100-chars:<N>u`), which `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost` answer on an instance that prices speech by length. `parseSpeechQuoteCreditId`, `isSpeechLengthPriceId` and `speechLengthPriceModel` read such ids back. A request is priced as a whole and rounded once, so a client quotes that answer instead of multiplying the per-100-characters row by the units, which can come to more; the `:per-100-chars` row's catalog note now says so.
