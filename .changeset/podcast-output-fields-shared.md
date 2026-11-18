---
"@nodaro/shared": minor
---

The podcast use-case runs' results are typed (`@nodaro/shared/edl`): `ClipPackClip` and `ClipPackOutputData` (each clip's place in the recording: `sourceStartMs`, `sourceEndMs` and, for a clip cut from several stretches, `sourceSpans`), `ClipPackFailedClip` (`failedClipList`: the clips that could not be rendered, by name, in plan order), and `UseCaseSpeaker` with `TightenEpisodeOutputData` and `SpeakerLayoutOutputData` (`speakers`: each speaker's label, the name the request gave it and how long they talk). Every field is optional: a run that finished before them has none.
