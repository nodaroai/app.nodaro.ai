---
"@nodaro/shared": patch
---

Catalog projection docs: on a deployment that shows its own pictures (`catalogs.images: "own"`), an option's `imageUrl` and `imageLargeUrl` may be a path on the deployment's own site (`/brand/…`) on the REST replies, resolved against the address the API was called at. The MCP tools give that path absolute.
