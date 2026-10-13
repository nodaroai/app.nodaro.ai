---
"@nodaro/shared": minor
---

Whole-run quote ids for every run priced per unit: `unitQuoteCreditId(rateId, units)` names the exact price of `units` of a one-unit price row (`<rateId>:<units>u` — the minutes of an Apply EDL or Speaker View render, the 5-second units of Trim / Loop / Combine Videos / Assemble Narrated Video / Mask Composite, the seconds of an LTX 2.3 Pro extend or retake), which `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost` answer with the figure the run is charged; `parseUnitQuoteCreditId` reads one back. A run is priced as a whole and rounded once, so a client quotes that answer instead of multiplying the one-unit row by the units, which can come to more. `speechQuoteCreditId` is this id on a speech model's per-100-characters row.
