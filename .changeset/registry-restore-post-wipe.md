---
"@nodaro/shared": patch
"@nodaro/prompts": patch
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.
