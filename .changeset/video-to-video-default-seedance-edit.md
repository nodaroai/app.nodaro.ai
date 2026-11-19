---
"@nodaro/shared": minor
"@nodaro/prompts": minor
"@nodaro/sdk": minor
---

The default Video to Video model is now Seedance 2.5 Edit (`seedance-2-5`), which edits the clip by instruction and keeps its length and aspect ratio. A `POST /v1/video-to-video` request, an MCP `modify_video` call, an SDK `nodes.run("video-to-video", …)` call or a Video to Video node that names no model runs it, including a node saved earlier with no model: it needs a prompt (the edit instruction) and a 4–30 second clip, renders at 480p unless a resolution is given, and is priced as a Seedance 2.5 edit. Wan 2.6 (`wan`) and Wan 2.6 Flash (`wan-flash`) stay selectable and unchanged; they make a new clip featuring the input video's subject and are no longer a default.

`@nodaro/shared/models`: `DEFAULT_VIDEO_TO_VIDEO_PROVIDER` is `"seedance-2-5"`; new `videoToVideoProviderOf(named)` (the model a request or node runs on: the one it names, else the default) and `QUEUED_VIDEO_TO_VIDEO_JOB_PROVIDER` (`"wan"`: the model of a `video-to-video` job queued earlier with no provider).

`@nodaro/prompts`: the six Video to Video look presets (Anime, Claymation, Cyberpunk Neon, Oil Painting, 3D Animated, Watercolor) run on `seedance-2-5`, and the node's preset group "Restyle Looks" is renamed "Looks"; the Wan prompt guidance points an edit at an edit model and a restyle at Video Remake.

`@nodaro/sdk`: `VideoToVideoParams.provider` documents the new default. To restyle a clip (keep its motion, camera and timing, change the art style) use `client.videoRemake.run({ …, direction: { style } })`.
