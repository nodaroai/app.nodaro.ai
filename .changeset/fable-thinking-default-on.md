---
"@nodaro/shared": patch
---

`claude-fable-5` now declares `thinkingDefaultOn: true`. Its thinking is always on, so consumers give every call the reasoning output floor (`reasoningOutputFloor`, 32768) instead of the plain 16384 cap its reasoning used to share with the answer.
