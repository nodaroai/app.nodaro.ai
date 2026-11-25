---
"@nodaro/sdk": minor
---

`JobErrorHint` has a new arm, `InputUnusableHint` (`{ kind: "input-unusable", reason: "image" | "no-sound" | "too-large" }`): the platform refused the job's input file from what the file is, before any provider call (a separation sent a picture, a video with no sound, or a video over the size it can take the sound out of), so the same file is refused again. Send a different file. `InputUnusableHint` is exported from `@nodaro/sdk/jobs`.
