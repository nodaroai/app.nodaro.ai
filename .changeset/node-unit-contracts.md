---
"@nodaro/shared": patch
---

The producer sets (`VIDEO_PRODUCER_TYPES`, `AUDIO_PRODUCER_TYPES`, `IMAGE_PRODUCER_TYPES`, `DYNAMIC_PRODUCER_TYPES` in `@nodaro/shared/nodes`) now also take their members from generated per-node contract rows (a node type and its producer kind). There are none yet, so every set is unchanged.
