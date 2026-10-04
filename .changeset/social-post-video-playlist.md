---
"@nodaro/shared": patch
---

`socialSearchPostVideo` reads a streaming playlist link (an HLS `.m3u8`, as some LinkedIn videos are) as no video file, so Video Analysis reads that post by its page instead of downloading a playlist.
