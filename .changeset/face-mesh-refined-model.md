---
"@nodaro/shared": patch
---

Video Face Mesh: `VIDEO_FACE_MESH_RECIPE` is now `2026-11-02`. The points come from MediaPipe's refined face landmark model (478 points, read from a 256 × 256 crop) instead of the basic one, so the same clip draws a different mesh: the lips and eyes follow the face more closely. The request, the output and the lines' tones and widths are unchanged.
