---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Saved posts, the inspiration wall: `@nodaro/shared` adds the `SavedPost` shape and the request and answer types of `/v1/saved-posts`. `@nodaro/sdk` adds `client.savedPosts` (`list`, `save`, `lookup`, `update`, `delete`) and re-exports the types. `@nodaro/cli` adds `nodaro saved-posts` (`list`, `save --file`, `update`, `delete`).
