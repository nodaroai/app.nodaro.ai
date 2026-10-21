---
"@nodaro/sdk": minor
---

Every Cast Swap role type (`CastSwapPersonRole`, `CastSwapLocationRole`, `CastSwapPetRole`, `CastSwapProductRole`) takes the preview-only settings of the new `CastSwapRolePreviewSettings`: `previewName?: string`, the name used instead of `name` when `preview` is `true`, and `inPreview?: boolean` (default `true`), where `false` leaves the role out of the preview — its images are not sent, prepared or charged. A full run ignores both. A preview with every role left out (always, even with a `prePrompt` or `postPrompt`), or with no role kept in it that has images and no `prePrompt` or `postPrompt`, answers 400 `no_roles_in_preview`. A prompt that would build too long now answers 400 `prompt_too_long` before anything is charged.
