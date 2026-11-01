---
"@nodaro/shared": minor
---

Video Face Mesh: the lines are drawn in tones of the picture under them instead of blue and green — gray on a gray depth map or a blurred face, and, on a coloured depth map, a colour of that map. `VideoFaceMeshRequest` takes `colormap` (one of `VIDEO_DEPTH_COLORMAPS`) and `depthUrl` (the grayscale depth render of the clip); `VideoFaceMeshOutput` reports the `colormap` used. `VIDEO_FACE_MESH_RECIPE` is now `2026-11-01`.
