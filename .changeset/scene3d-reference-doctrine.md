---
"@nodaro/prompts": minor
---

Scene3D layout-reference doctrine: `SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE`, `buildScene3DLayoutScopingLine`, `renderScene3DLayoutScopingLine` and `hasScene3DLayoutScopingLine` — the scoping caption a Scene3D clay render needs when it is attached to a video model as a reference (what it is FOR: positions, occlusion, framing, camera angle and motion, cuts, timing; what to IGNORE: the grey clay look, placeholder colours, materials, lighting, empty background), built as a rail caption for `referenceVideoCaptions[N]`. Plus `buildScene3DUnreferencedFiguresWarning` (`scene3d_unreferenced_figures`): every figure that must look real needs its own character reference, or it inherits the clay look.
