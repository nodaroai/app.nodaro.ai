---
"@nodaro/shared": minor
---

Video Face Mesh takes `layers` in place of `parts`: any set of the wireframe, the eye outlines, the lip outline, the contours (with them on, every line leaves out what a turned face hides), the irises and bold lines (`VIDEO_FACE_MESH_LAYERS`, `VideoFaceMeshLayers`, on `VideoFaceMeshRequest.layers` and `VideoFaceMeshOutput.layers`). Every `parts` value is one set of layers (`videoFaceMeshLayersOfParts`, `videoFaceMeshPartsOfLayers`) and draws exactly as before.
