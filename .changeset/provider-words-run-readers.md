---
"@nodaro/shared": patch
---

`NodeExecutionStateWire.errorDetail` is documented as reaching only a reader who can open the workflow the run executed: a person running someone else's share link, like a published app's runner, never receives it. The type is unchanged.
