---
"@nodaro/cli": patch
---

`nodaro models list` on a model the instance offers under its own label (it names no maker): the table's maker column shows `-`, the fallback it already used for a missing maker, and `--json` leaves `maker` out for it, as the API does. Documented and covered by a test; no behaviour changes.
