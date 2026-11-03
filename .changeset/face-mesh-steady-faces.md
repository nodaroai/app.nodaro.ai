---
"@nodaro/shared": patch
---

Video Face Mesh: `VIDEO_FACE_MESH_RECIPE` is now `2026-11-03`. A face gets lines only when it is found in at least 3 frames of its track (found faces at the same place in frames at most 2 apart), so a face found in only one or two frames (a tiny face far back, a dark gap read as a face) is never drawn. The same clip draws another mesh, and every finished job reports the new recipe (`output_data.recipe`). The request, the output and the lines' tones and widths are unchanged; `framesWithFaces` and `facesDrawn` count the faces drawn.
