---
"@nodaro/sdk": minor
---

Shot Cuts and Split into Chunks' shots mode:

- `client.media.shotCuts({ videoUrl, frames? })` (`POST /v1/shot-cuts`): where every shot of a video starts and ends, measured from the file; with `frames: true` each shot's first and last frame as images. Types `ShotCutsInput`, `ShotCutsResult`, `ShotCutsShot` and `ShotCutsOutput` from `@nodaro/sdk/media`.
- `client.media.splitMedia({ videoUrl, mode: "shots" })` cuts a video into one part per shot; the completed job adds `shotCount` and `shots` (each part's start and end on the video). `SplitMediaInput` is now the union of `SplitMediaByDurationInput` (unchanged fields) and `SplitMediaByShotsInput`; `SplitMediaShot` is the shot type.

Shot Cuts is not yet enabled on nodaro.ai.
