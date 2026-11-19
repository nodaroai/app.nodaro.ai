---
"@nodaro/sdk": minor
---

`videoRemake.advanced()` (`GET /v1/video-remake/advanced`, public) answers `{ show: boolean }` (`VideoRemakeAdvanced`, also from `@nodaro/sdk/video-remake`): whether the Video Remake page shows `prepareReferences` and `prePrompt` under its Advanced options, `false` until Nodaro turns them on. It describes the page only: `run()` and `estimate()` take both fields as sent. No sign-in needed; the answer may be up to a minute old.
