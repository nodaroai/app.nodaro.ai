---
"@nodaro/shared": minor
---

`@nodaro/shared/runtime-config`: `toolApps.apps`, the mini apps a white-label deployment offers, by id. Presence is what narrows: a list offers exactly its apps (each still only while the viewer may run it), `[]` none, and without the key every app the viewer may run is offered, as before. A value that is not a list reads as `[]`. `RuntimeSurface["toolApps"]` carries it only when the deployment set it. Also `isToolAppId` and the limit `MAX_TOOL_APPS`.
