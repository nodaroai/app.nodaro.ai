---
"@nodaro/sdk": patch
---

`TrendRunDisplaySlot` gains an optional `fromDefault: true`: a slot left empty on a run that the trend's own default pictures filled (`fromExample` is then `false`). Absent on every other slot, so existing runs read exactly as before. Its JSDoc now says that a Full depth trend fills an empty optional slot with the trend's default image for that role if one is set, otherwise the original's look, never an example's pictures.
