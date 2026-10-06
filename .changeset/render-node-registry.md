---
"@nodaro/shared": minor
---

`RENDER_NODE_TYPES`: one registry of the render nodes (Apply EDL today), each with a descriptor — the medium its order asks for (`mediumOf`), its credit id (`creditId`, the existing `applyEdlCreditId` for Apply EDL), where its player maps the clock from (`clockMapFrom`), whether it lists in its owner's views only (`ownerOnlyListing`), whether an `each` wire reads its latest batch only (`latestBatch`) and what its `json` output carries (`jsonKind`). Helpers: `renderNodeOf`, `isRenderNodeType`, `rendersLatestBatch`, `rendersTranscriptJson`, `RENDER_NODE_TYPE_IDS`, `OWNER_ONLY_LISTING_RENDER_TYPES`. `PREVIEW_RENDER_NODE_TYPES` is now derived from it (same members). Additive; no behaviour change.
