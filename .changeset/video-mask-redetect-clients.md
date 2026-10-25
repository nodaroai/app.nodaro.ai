---
"@nodaro/sdk": patch
"@nodaro/cli": minor
---

Video Mask re-detection: `nodaro media video-mask --redetect-every <sec>` (0 = off, or 1–10) sends `redetectEverySec`, and `client.media.videoMask` documents it — the subject is detected again every that many seconds, so someone who walks in or turns to the camera mid-shot is masked. Slower; same price.
