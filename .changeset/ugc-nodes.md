---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

UGC video nodes (Nodaro Cloud).

`@nodaro/shared`:

- `ugc-node-wires` (new): the request bodies and outputs the editor and the workflow engine share for UGC Creator, UGC Script, UGC Clips, UGC Clip and UGC Cards, with UGC Creator's option reader and its pick helpers (`ugcCreatorCandidates`, `ugcCreatorCallsToRender`, `ugcCreatorCandidate`, `ugcCreatorPick`, `ugcAwaitsPick`), UGC Script's result (`ugcScriptResult`), a kept node's outputs (`ugcKeptOutputs`) and `ugcPipValue`; the readers of a saved script's length and of its screenshot cards, beat by beat (`ugcPlanLengthSec`, `ugcPlanScreenshotCount`), and the script's length bounds (`UGC_SCRIPT_DEFAULT_TARGET_SEC`, `UGC_SCRIPT_MIN_TARGET_SEC`, `UGC_SCRIPT_MAX_TARGET_SEC`); the pickers a creator reads (`UGC_CREATOR_PICKER_TYPES`); and the sentences the UGC nodes fail with, by id (`UGC_NODE_MESSAGES`, `UgcNodeMessageId`, `UGC_SCRIPT_NEEDS_CHANGES`).
- `ugc-run-state`: the waiting-for-a-pick checks (`ugcPickPending`, `ugcRunWaitsForPick`, `UGC_PICK_FIRST_MESSAGE`, `UGC_CREATOR_CANDIDATES_KEY`). `UGC_NODE_RUN_STATE_KEYS` also lists UGC Creator's options, their note and its image, UGC Clip's takes and Re-render marks, and UGC Cards' Notes; `stripUgcRunState` also removes the fields in the new `UGC_PUBLISH_PRIVATE_FIELDS` (UGC Creator's photo).
- `producer-types`: `ugc-clip` joins the video producers, and `ugc-clips` fans out from its Clips output only (`FAN_OUT_EACH_HANDLES`).
- `json-kinds`: the UGC nodes' JSON outputs are declared.
- `entity-image-handle`: an output that carries a plain medium reads as that medium to every classifier (`OUTPUT_PIP_EFFECTIVE_TYPES`, `outputPipSourceType`, read by `resolveEffectiveSourceType`): UGC Creator's image as an image, and UGC Script's category, UGC Clips' transcript and UGC Cards' Notes as one text each.
- `node-runtime-keys`: `NODE_TYPE_EXECUTION_DATA_KEYS`, `isExecutionDataKey` and `executionDataKeysOf`: a run result a node type keeps under a generic name (UGC Clips' `quote`, UGC Clip's `durationSec` and Re-render marks, …) is execution data on that type only. `EXECUTION_DATA_KEYS` gains `__listResultMeta`. `extractPresetData` takes the node type to apply them (`node-preset-extract`; `node-preset-export` passes it), and `stripExportContent` strips them (`workflow-export`).
- `presentation-utils`: UGC Cards' output is text (its Notes).

`@nodaro/sdk`: `JobStatusResult.completed_at`, when the job finished on the server's clock (`null` until it has), on the lean status `jobs.getStatus` returns.
