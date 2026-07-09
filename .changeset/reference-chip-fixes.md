---
"@nodaro/shared": patch
---

Fix reference chips when an entity node feeds one generate node via both its identity handle and its plain `image` handle. New `sourceRefKey()` scopes an entity's image-handle ref to `${nodeId}::image` so the identity ref and the plain-image ref no longer collide on the node-id-keyed assembly maps (which previously dropped one non-deterministically — a literal `@name:N` token + lost character, or the image missing from the picker).
