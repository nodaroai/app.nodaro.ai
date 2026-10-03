---
"@nodaro/shared": minor
---

Add the multicam checks every edit-plan caller runs before dispatch: `applyAudioSyncOffsets(sources, result)` writes an audio-sync result's measured offsets onto a planner's `sources[].offsetMs`, re-based onto the master's clock (the `master-audio` source, else the first; a hand-set `offsetMs` wins); `resolveEditPlanSources(sources, { offsets, transcriptSourceId })` adds the master-offset and transcript-clock checks; `describeAudioSyncOffsetIssue` phrases each issue (a source not measured, a weak match under `AUDIO_SYNC_MIN_CONFIDENCE` = 0.5, an unmeasured master, a transcript made from a source off the master's clock); `editPlanTranscriptOrigin` traces a canvas transcript to the recording it was made from.
