---
"@nodaro/shared": patch
---

`VIDEO_LINK_TOLERANT_CONSUMER_TYPES` lists `content-recipe`. A Content Recipe cites a Video URL node's page link on its `link` input and never reads the file, so a run whose only reader of a link is a Content Recipe no longer has to download the video, or choose a part of a long one, first.
