---
"@nodaro/shared": minor
---

The runtime config contract has an optional `storageOrigins` key: the https origins of the deployment's own storage that its download routes accept. `parseRuntimeConfig` keeps only the https origins it lists, and drops the key when there are none.
