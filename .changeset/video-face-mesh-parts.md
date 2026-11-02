---
"@nodaro/shared": minor
---

Video Face Mesh: `VideoFaceMeshRequest` takes `parts` (one of `VIDEO_FACE_MESH_PARTS`): `"full"` (the default: the wireframe and the eye and lip outlines, as before), `"features"` (the eye and lip outlines only) or `"mouth"` (the lip outline only). `VideoFaceMeshOutput` reports `parts` when it was not the full mesh. `VIDEO_FACE_MESH_RECIPE` is unchanged: the full mesh draws exactly as before.
