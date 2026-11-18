---
"@nodaro/sdk": minor
---

Trends: `TrendDetailSlot.emptyFill` says, on each optional slot of a trend's page, what a run takes when you leave that slot empty: `"default"` (its original look, `defaultImages`), `"example"` (the chosen example's pictures for it; none when that example has none) or `"original"` (no pictures: the role stays as in the original). Absent on a required slot. The doc comments state the rule behind it: an empty optional slot takes its original look when it has one, whatever its kind; without one, a person takes the chosen example's pictures and a place, product or pet stays as in the original. A Full depth trend never uses an example, and a trend that hides its original fills every such slot from the example.
