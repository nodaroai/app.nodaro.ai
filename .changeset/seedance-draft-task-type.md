---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

A Seedance 2.5 draft now declares its reference task type. `resolveSeedanceTaskType` (`@nodaro/shared/models`) no longer drops a declaration on a draft: a `draft: true` request declares `reference`, `edit` or `extend`, and is forced to the same aspect ratio and length, exactly as the same request without Draft. The `draft` field of `SeedanceTaskTypeFacts` is now optional and deprecated: it is not read, and a caller that still passes it compiles unchanged.

`@nodaro/sdk`: the `referenceTaskType` comments on `GenerateVideoParams` and `VideoToVideoParams` say that a draft takes the setting like any other run (at 480p). No type changes.
