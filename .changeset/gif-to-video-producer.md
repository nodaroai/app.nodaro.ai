---
"@nodaro/shared": patch
---

`@nodaro/shared`: `VIDEO_PRODUCER_TYPES` gains `gif-to-video` so the new GIF→MP4 node's output is accepted as a video by every downstream consumer (canvas validators + backend asset-typing read this one set).
