---
"@nodaro/sdk": minor
---

`VideoUpscaleParams` takes `mode` (`"transparent"` or `"sharp"`) for `nodaro-video-upscale`. With no mode a run is transparent: it keeps the clip's original colours and look, takes 720p / 1080p / 2k / 4k, and is priced per second of the clip at its exact length. Sharp adds crisp detail and takes 1080p / 2k / 4k, as before. With no mode, a clip Transparent cannot serve at the chosen resolution runs as Sharp at Sharp's price instead of being refused; an explicit `"transparent"` keeps its refusals.
