---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Camera Switch `lagMs`: delay each cut by this long, in whole milliseconds (0–5000, default 0), the counterpart of `leadMs`. `CAMERA_SWITCH_BOUNDS` gains `lagMs`, and the new `CAMERA_SWITCH_NODE_SETTINGS` lists the four numeric settings a Camera Switch node carries (`lagMs` is a request setting only, so `cameraSwitchSettingsPayload` never sends it). The SDK's `CameraSwitchInput` gains `lagMs` and `client.edit.cameraSwitch` sends it; the CLI gains `nodaro edit switch-cameras --lag-ms <ms>`.
