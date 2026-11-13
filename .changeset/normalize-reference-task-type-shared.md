---
"@nodaro/shared": minor
---

A video node's stored Seedance reference task type is held to the models the node runs. On a `generate-video`, `image-to-video`, `text-to-video` or `video-to-video` node, `referenceTaskType` is kept, the node returned as it came, while a model the node runs lists the value (`MODEL_CATALOG[id].referenceTaskTypes`, matched as `listedSeedanceTaskType` matches it; a node with several providers keeps it while any one lists it). Otherwise that key is removed, so the value can no longer sit unused on a model that ignores it and take effect when the node is later switched to one that reads it. `auto`, and any value no model lists, is removed too: Auto is the key left unset. A node that names no model is judged on the model its run uses by default. Nothing a run sends or is charged changes, since a run already ignores such a value.

- New in `@nodaro/shared/nodes`: `withListedReferenceTaskTypes(nodes)`, that one rule over a stored graph. It removes only that key and nothing else, and returns the same array when no node changes (any value that is not an array is returned as it came). Every path that stores a workflow graph runs it.
- `normalizeNodeModelParams` runs the same rule and reports each removal as an adjustment (`field: "referenceTaskType"`, `to: undefined`); `NodeParamAdjustment.field` now also names `"referenceTaskType"`.
- New in `@nodaro/shared/pipeline`: `isCodecOwnedDocument(nodes, settings)`, whether a workflow document is one a server codec owns (a Studio settings block holding keyframes, sequences or settled jobs, or any node carrying `keyframeId`, `sequenceBinding` or the dependent-frames declaration), whose stored graph only the codec's writer may change. The editor and the server ask the same predicate.
- New in `@nodaro/shared/models`: `LEGACY_VIDEO_NODE_DEFAULT_PROVIDER` (`"kling"`), the model an Image to Video or Text to Video node runs when it names none.
