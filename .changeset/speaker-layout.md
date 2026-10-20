---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Speaker Layout: frame a whole recording by speaker — the same length, nothing cut. The SDK gains `client.edit.speakerLayout(input, options?)` (`POST /v1/speaker-layout`) and `client.edit.estimateSpeakerLayout(input)` (`POST /v1/speaker-layout/estimate`), with the `SpeakerLayoutInput` type: one recording (`mediaUrl`) or the recordings of one conversation (`mediaUrls`, `masterAudioUrl`, `cameras`), `targetAspect`, `layout`, `switchType`, `emphasisStyle`, `framingSource` and `reviewBeforeRender`. `continueUseCase` continues its runs; a Render final takes no `editedEdl` (refused `400 use_case_no_plan`). The CLI gains `nodaro edit speaker-layout`, and `nodaro edit continue-use-case --type speaker-layout`. Not yet enabled on nodaro.ai.
