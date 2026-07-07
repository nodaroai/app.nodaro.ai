---
"@nodaro/shared": minor
---

Relocate provider-rate derivation internals out of the published package (they now live server-side). Wire enums, ids, and credit-price tables are unchanged; if you imported the removed derivation helpers, fetch display costs from the API instead.
