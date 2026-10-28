---
"@nodaro/sdk": minor
---

`Character`, `Creature`, `Location` and `Object` carry their Nodaro Keepers shelf state: `catalog` (on the shared shelf), `catalogSort` (the shelf order) and `catalogCategory` (the shelf heading) — what `setCatalog` writes, now readable from the item's own `get` and `list`. `false` / `0` / `null` on everyone else's rows and on every copy.
