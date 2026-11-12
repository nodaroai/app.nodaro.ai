---
"@nodaro/shared": minor
---

`NodaroLoadVideoPayload` (`@nodaro/shared/media`) takes an optional `saveExit`. `"video"` asks the editor's Save & Exit to render the timeline and answer with `FREECUT_EXPORT_COMPLETE`: the video and the project JSON. Absent or `"project"`, Save & Exit answers as it does today, with the project JSON alone.
