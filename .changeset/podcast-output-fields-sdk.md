---
"@nodaro/sdk": minor
---

`edit.tightenEpisode` and `edit.speakerLayout` take `speakerNames` (speaker label → the name to show): the job keeps the names and returns them on `output_data.speakers[].name`, and the run itself never reads them. The results of the podcast runs are typed and exported from `@nodaro/sdk/edit`: `ClipPackClip` / `ClipPackOutputData` (each clip's `sourceStartMs`, `sourceEndMs` and `sourceSpans` in the recording, and `failedClipList`, the clips that could not be rendered, as `ClipPackFailedClip`) and `UseCaseSpeaker` / `TightenEpisodeOutputData` / `SpeakerLayoutOutputData` (`speakers`, with each one's `talkMs`). Every field is optional: a run that finished before them has none.
