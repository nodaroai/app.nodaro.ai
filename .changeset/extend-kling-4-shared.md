---
"@nodaro/shared": minor
---

Kling 4 joins Extend Video: **`kling-4-extend`**, a new `EXTEND_VIDEO_PROVIDERS` member with its own catalog entry (`MODEL_CATALOG["kling-4-extend"]`, made by Kuaishou). It continues any video by URL the way the Seedance extend providers do: the source's last frame opens the new footage and its last seconds ride as the `@video_1` reference, then the two are stitched into one clip. 3–30 s added (default 5), at 720p or 1080p; its sound is always on, and it takes no reference images. Its own catalog entry lets a deployment withhold or release it apart from Kling 4.0 generation.

- New in `@nodaro/shared/models`: `TailExtendProvider` (`seedance-2-5-extend`, `seedance-2-0-extend`, `kling-4-extend`) and `isTailExtendProvider()`, the Extend Video providers that continue a clip from its tail. `isSeedanceExtendProvider()` keeps answering for the two Seedance providers, whose own levers (reference images, the sound switch) Kling 4 does not have.
- New in `@nodaro/shared/credits`: `tailExtendCreditId(provider, duration?, resolution?)` and `tailExtendResolution(provider, resolution?)`, the price row and render resolution of any tail-recipe extend: one row per second added and resolution (`kling-4-extend:<N>s:<720p|1080p>`, as well as the Seedance rows). A resolution the model does not render (`480p` on Kling 4) is priced and rendered at 720p. `seedanceExtendCreditId` and `seedanceExtendResolution` stay, deprecated, as the same builders for the Seedance providers.
- `buildVideoCreditModelIdentifier` prices `kling-4-extend` on its own rows, as it does the Seedance extend providers.
- `MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER["kling-4-extend"]` is 7869: Kling 4.0's 8000, less the room the run's own wording around the prompt takes, so a prompt at the cap reaches the model whole.
