---
"@nodaro/shared": patch
---

A node preset never captures or applies `settingsBeforeAudio` (`PRESET_EXCLUDED_KEYS`): the picture settings an audio recording turned off on a Tighten Episode or Clip Pack node are that node's own memory of its wiring, given back when a video is wired again — never a reusable setting. A preset saved from an audio-locked node carries none.
