---
"@nodaro/prompts": patch
---

Fix `texture-shower-fresh-wet`'s `promptHint` to carry the `"with "` lead-in every other independent-dimension skin-texture hint uses (`"with fresh, water-dappled skin as if just out of the shower"`), so it no longer joins mid-fragment as "…sheen on the skin, fresh, water-dappled skin…". `term` and `label` are unchanged.
