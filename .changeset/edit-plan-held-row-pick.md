---
"@nodaro/shared": minor
---

`pickHeldRow(rows, edge, iterating)` reads one value off a row-aligned list whose empty rows mean "nothing here" (an Edit Plan's clips as a review leaves them), for a wire that does not iterate it: a range or list selector that leaves one kept row reads that row, one that leaves none reads nothing, and an item pick on an empty row reads nothing. Both engines call it, so a wire never falls back to the list's first kept row when its selection does not hold it. Also `HeldRowPick`. `editPlanBasis` now hashes a plan object once and reuses the result. Additive.
