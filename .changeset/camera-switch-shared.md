---
"@nodaro/shared": minor
---

Add the camera-switch contract: `transcriptSpeakerLabels` (a transcript's speaker labels in order — none means camera-switch refuses before charging), `cameraSwitchCameras` (an EDL's camera sources, without the mic / wide / screen), `defaultSpeakerMap` (the speaker table pre-filled by order, keeping the person's choices; `""` = no camera of their own, sent as `""`), `cameraSwitchEdlProblem` (the route's `invalid_edl` refusal: one master-clock edit, never a clip set), `CAMERA_SWITCH_BOUNDS` + `clampCameraSwitchSetting` + `cleanSpeakerNames` (the route's accepted ranges), `cameraSwitchSettingsPayload` (what a Camera Switch node sends besides its inputs), `CAMERA_SWITCH_DEFAULTS` and `CAMERA_SWITCH_CREDIT_ID`. `NON_PROMPT_TEXT_LANES` routes camera-switch's `edl` and `transcript` inputs off the prompt.

Add per-handle fan-out defaults: `FAN_OUT_EACH_HANDLES`, `defaultEdgeOutputMode(sourceType, sourceHandle)` (the outputMode an edge has when none is set — `FAN_OUT_EACH_TYPES` members on every handle, plus the listed handles of a per-handle node) and `listResultsServeHandle` (whether an edge from that handle reads the node's per-iteration results). Camera Switch's `edl` handle defaults to "each"; its `transcript` handle never reads the per-clip list.
