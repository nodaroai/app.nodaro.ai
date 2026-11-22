---
"@nodaro/sdk": patch
---

`videoRemake.planRoles()` now waits 200 s by default, whatever the client's `timeoutMs`: the plan and the checks the server runs on it can take up to about three minutes. Pass a second argument `{ timeoutMs?, signal? }` to wait another time or to cancel.
