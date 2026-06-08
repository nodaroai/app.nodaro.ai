---
"@nodaro/shared": minor
"@nodaro/client": minor
"@nodaro/cli": minor
---

Admins can now share/unshare community listings via the SDK + CLI. `@nodaro/client`: `community.publish()`, `community.unpublish()`, `community.sharedListing()`. `@nodaro/cli`: `community publish/unpublish/shared-status`. (All require an admin token; publishing requires owning the source entity and, for characters, a likeness attestation.)
