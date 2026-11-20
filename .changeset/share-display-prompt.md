---
"@nodaro/sdk": patch
---

`SharedJob` (`client.shares.getPublic()` / `publicItems()`) gains `displayPrompt?: string | null`: the shared prompt as a person reads it, each reference token shown as the name on its pill — `@maya:1` → `@Maya`, `@image-1:1:background` → `@Image 1` when the reference has no name of its own, `{video:1:clip}` → `@clip`. Show it on a share page; `prompt` stays exactly as sent, for reuse. `null` for a trend run, absent from an older server.
