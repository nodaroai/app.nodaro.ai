---
"@nodaro/shared": patch
---

`VIDEO_LINK_TOLERANT_CONSUMER_TYPES` no longer lists `dubbing`: Dubbing dubs the file wired into it, so `videoLinkNeedOf` and `videoLinkRunNeeds` answer `file` for a Video URL node it reads, and that video is downloaded first. A Dubbing node with its own `sourceUrl` reads nothing wired into it, so `videoLinkRunNeeds` does not count it as a reader.
