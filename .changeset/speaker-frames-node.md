---
"@nodaro/shared": minor
---

`speaker-frames` joins the `transcript` input lane, folds its `edl` wire (`FAN_IN_TARGETS`: a clip pack runs once over the union of its clips' spans), and declares its `tracks` output as JSON of kind `other` (the stored track file's descriptor). Ids only; no price is set.
