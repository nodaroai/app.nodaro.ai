---
"@nodaro/shared": patch
---

The runtime config contract gains three optional keys for a deployment that has moved its app pages to a host of their own: `flowUiOrigin`, `legacyUiHosts` and `linkOrigin`. Absent on every other deployment, so nothing changes for a reader that does not use them.
