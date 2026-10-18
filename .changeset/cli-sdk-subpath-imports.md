---
"@nodaro/cli": patch
---

Import `@nodaro/sdk` by subpath entry (`@nodaro/sdk/client`, `@nodaro/sdk/errors`, …) instead of the package root. No CLI change. These subpaths exist only from the `@nodaro/sdk` minor released alongside, so this release raises the `@nodaro/sdk` dependency range to that version.
