---
"@nodaro/sdk": minor
---

`nodes.run("suno-add-vocals", …)` and `nodes.run("suno-add-instrumental", …)` are typed: `SunoAddVocalsParams` / `SunoAddInstrumentalParams` (and the shared `SunoAddTrackParams`, all from `@nodaro/sdk/nodes`). The song is `uploadUrl` (a direct link to its audio file) or a Suno track made on Nodaro (`taskId` + `audioId`). New optional direction: `style`, `title`, `negativeTags`, `vocalGender` (`"male"` / `"female"`), `styleWeight`, `weirdnessConstraint`, `audioWeight` (0 to 1), and on Add Vocals `prompt` (the lyrics, or a direction for the voice). With no `style`, the original song's style is used when it is a Suno song of your own; otherwise the call answers `400 suno_add_track_style`. The price does not change with these fields.
