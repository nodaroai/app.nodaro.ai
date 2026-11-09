---
"@nodaro/shared": minor
---

The runtime config contract (`@nodaro/shared/runtime-config`) gains one optional top-level key, `mediaOrigin`: the https origin a white-label deployment serves user media from, so a page can trust images from that host. `parseRuntimeConfig` keeps it only when it is an https origin spelled exactly as a browser spells one (no path, trailing slash or credentials), and the new `isHttpsOrigin` guard states that rule for a reader that handles the raw value. The key is absent on every other deployment, and absent means a reader behaves as it does today.
