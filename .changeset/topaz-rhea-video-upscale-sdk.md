---
"@nodaro/sdk": minor
---

`VideoUpscaleParams.provider` accepts `"topaz-rhea"`: Topaz's Rhea model, which scales the clip (up to 4×) so its short side reaches `targetResolution` (720p / 1080p / 4k), at its own frame rate and length, as H.264, priced per second of the clip by the target.
