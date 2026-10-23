---
"@nodaro/sdk": minor
"@nodaro/cli": patch
---

Trends: a trend can offer only some chips on a slot. `TrendDetailSlot.chips` (always present) lists the chips you may set on that slot, in its kind's order (`[]` = none), and `defaults` covers only those; the new `TrendChipKey` type names a chip. A chip of the slot's kind that it does not list is fixed by the trend, and `estimate()` / `run()` refuse sending it with `400 chip_not_offered` (`err.details` is `{ slot, chip }`). The CLI's `--choice` help says to send only the chips `trends get` lists.
