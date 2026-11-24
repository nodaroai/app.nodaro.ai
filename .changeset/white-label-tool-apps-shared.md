---
"@nodaro/shared": minor
---

`@nodaro/shared/runtime-config`: three surface keys for a deployment whose header is white-label, each absent unless the deployment sets it. `toolApps` (`menus`, `pages`, `pictures`): whether the tools app's mini apps are offered there, each switch on only for the literal `true`, and the deployment's own pictures by key. `worlds.soon`: worlds it will open later; `worldSoon` answers one, and `worldAllowed` now refuses it. `samples` (`image`, `video`): its own welcome samples, with the types `SurfaceSample` and `SurfaceVideoSample`. Also `ownPictureAddress` (a path on the site or an https address) and the limits `MAX_TOOL_APP_PICTURES`, `MAX_SURFACE_SAMPLES`, `MAX_VIDEO_SAMPLE_PROMPT` and `MAX_SAMPLE_REFERENCES`. `RuntimeSurface` always carries `toolApps` and `samples`, at their defaults when the deployment sets neither.
