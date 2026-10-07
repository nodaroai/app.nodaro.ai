---
"@nodaro/shared": minor
---

`LEGACY_SOURCE_HANDLE_ALIASES` now maps the output id ten nodes used to declare onto the pip each one renders:
- `video` → `video-out` on Add Captions, Loop Video, Merge Video & Audio, Resize Video and Trim Video;
- `audio` → `audio-out` on Adjust Volume, Audio FX, Combine Audio and Mix Audio;
- `asset` → `out` on Save to Storage.

So an edge written with the old id still connects. `RENDERED_OUTPUT_HANDLES` is now empty, because every node definition declares the pips its node renders.
