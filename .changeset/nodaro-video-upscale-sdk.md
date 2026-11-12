---
"@nodaro/sdk": minor
---

`VideoUpscaleParams` takes `provider: "nodaro-video-upscale"` and `targetResolution: "2k"`: Nodaro Video Upscale upscales a clip of up to 60 seconds and 50 MB into a 1080p, 2K or 4K frame, priced per second of the clip (`"2k"` is its target only: every other provider still refuses it with a 400). It is offered only where `models.list` lists it; elsewhere the request is refused with `403 model_not_available`. Its other refusals: `400` for a clip past a limit or one that cannot be read, `403 link_imports_disabled` for a link to another site where the deployment turned such links off, `422 upload_blocked` where its upload policy refuses the clip, and `429 input_busy` or `503 input_timed_out` / `input_failed` when the clip could not be fetched just now. Every refusal comes before anything is charged.
