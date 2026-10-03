---
"@nodaro/shared": minor
---

`VIDEO_CRITIC_RESERVED_CREDITS_PER_SHOT`: the credits a story-to-video pipeline reserves per shot for the Video Critic, by frame mode (20 / 30 / 40, a worst case; unused credits refund when the pipeline completes). The editor quotes them in the Generative Pipeline settings. A backend test fails when they differ from what the estimate reserves: the panel read ~2 / ~3 / ~4 after the credit re-denomination.
