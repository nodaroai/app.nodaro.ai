---
"@nodaro/shared": patch
---

`speaker-view`'s `tracks` input (Speaker Frames' face-track descriptor) joins the non-prompt input lanes: a list fanned through it is never written into a prompt. Ids only.
