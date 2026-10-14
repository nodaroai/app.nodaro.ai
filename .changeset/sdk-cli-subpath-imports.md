---
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

Import `@nodaro/shared` and `@nodaro/prompts` by subpath entry (`@nodaro/shared/models`, `@nodaro/prompts/person`, …) instead of the package roots. No API change. These subpaths exist only from the `@nodaro/shared` and `@nodaro/prompts` minors released alongside, so this release raises both dependency ranges to those versions.
