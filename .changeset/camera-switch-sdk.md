---
"@nodaro/sdk": minor
---

Add `edit.cameraSwitch({ edl, transcript, speakerMap?, speakerNames?, minShotMs?, leadMs?, maxShotMs?, wideEvery?, layoutHints? })`: put each cut of an EDL on the camera of whoever is speaking (Cloud; flat price). A transcript with no speaker labels rejects with a `NodaroError` (`code: "no_speakers"`) before any request.
