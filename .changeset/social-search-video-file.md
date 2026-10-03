---
"@nodaro/shared": minor
---

Social Search → Video Analysis: `socialSearchPostVideo` reads what a post wired into Video Analysis hands it — its own video file while the platform's signed link is valid (`signedLinkExpiresAt` reads the link's end), else its page link, or that the file's link has expired. `socialPostsLongestVideoSec` is the length the editor quotes for the posts a wire hands on.
