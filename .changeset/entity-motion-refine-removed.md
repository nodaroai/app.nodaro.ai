---
"@nodaro/sdk": minor
---

`refineFromVideoUrl` is removed from `GenerateObjectMotionInput` and `GenerateCreatureMotionInput` (`objects.generateMotion()`, `creatures.generateMotion()`). The option could not run: a motion clip is made from `sourceImageUrl` on an image-to-video model, and none of the models these routes accept takes a clip as its source, so a request that set it failed. `POST /v1/generate-location-motion`, `/v1/generate-object-motion` and `/v1/generate-creature-motion` now refuse a body that sends it with a 400 `validation_error` (path `refineFromVideoUrl`) before anything is reserved. Code that sets the field no longer type-checks: drop it. To keep a clip's motion, camera and timing and change what is in it, use Video Remake (`client.videoRemake`, `POST /v1/video-remake`); to edit a clip by instruction, `POST /v1/video-to-video`. A request without the field is unchanged.
