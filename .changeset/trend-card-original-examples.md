---
"@nodaro/sdk": minor
---

`trends.list()`: each `TrendCard` now carries the trend's `original` (its display copy, the same address as `TrendDetail.original`, without its length and preview start; absent on a version without one) and `examples` (every example's video in order, `{ videoUrl, posterUrl?, width, height }`, without the pictures its slots used; `[]` on a trend with only its original), so a catalog can show and play each clip without reading every trend's page. `cover` is unchanged.
