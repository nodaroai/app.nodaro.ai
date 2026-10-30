---
"@nodaro/sdk": minor
---

Trends: every video on a trend's card and page (`cover`, `original`, `examples[]`) may carry `webUrl` and `webSizeBytes`, a light copy the platform made for playback (H.264 ~2.5 Mbit/s, AAC 160 kbit/s) to play as it is, with no CDN transform; absent on an older version until it is made. The shared shape is exported as `TrendVideo`.
