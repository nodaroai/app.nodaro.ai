---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Save to Collection resolves `{Node}` references typed into its title, text, link and duplicate key (#1890).

- `@nodaro/shared`: `fitCollectionField(key, value)` holds a Save to Collection field to the record route's limit, and both engines apply it to a resolved value. A title, text or duplicate key is cut to whole characters; a link over the limit is not sent.
- `@nodaro/prompts`: `computeNodeSendText("collection-write", …)` counts a typed field with its `{Node}` references resolved, the way the engines send it. A `{Feed || }` over a feed with nothing new is empty, so the node skips instead of failing with an empty record.
