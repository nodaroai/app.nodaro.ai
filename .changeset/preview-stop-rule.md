---
"@nodaro/shared": minor
---

The preview stop rule: a run stops at a render set to Preview, and nothing downstream of it runs until Render final. `previewStops(nodes, edges, run?)` returns the Preview renders the run executes, the saved Previews it would hand on, and `gatedNodeIds` (the forward closure that never runs); `previewGatedNodeIds` and `holdsPreviewRender` are its two questions. `rendersAsPreview(node)`, `PREVIEW_RENDER_NODE_TYPES`, `withRunOverrides(nodes, overrides)` (the graph a run executes once its input overrides are merged, clearing `RUN_OVERRIDE_CLEARED_FIELDS`), the saved-output reader seam `SavedRenderStampReader` / `SAVED_RENDER_STAMPS` / `NO_SAVED_RENDER_STAMPS`, and the stable refusal codes `PREVIEW_REVIEW_REQUIRED` (a run nobody can review holds a Preview render) and `PREVIEW_RENDER_NESTED` (a sub-workflow or component holds one). The saved-preview half reads a teleport pair as the input resolvers do: per consumer wire. Additive.
