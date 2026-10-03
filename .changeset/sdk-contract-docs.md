---
"@nodaro/sdk": minor
---

The SDK's types and docs now match the server.

- `runAndWait` / `runMany` take `cancelOnAbort: true` to also cancel the job (and release its credit hold) when `signal` aborts. Without it, aborting stops only the waiting: the job keeps running and is charged. The `JobAbortedError` now always carries the `jobId` once the job was submitted.
- `DeveloperAppScope` is `OAuthScope` from `@nodaro/shared`, the server's own list. It gains `presets:read`, `workspaces:read` and `workspaces:write`.
- `recast.estimate` / `create` / `start` type `segmentSec` as `RecastSegmentPack` (`"max" | "scenes-max" | "scenes"`), the values the server accepts, and the entry point exports them as `RECAST_SEGMENT_PACKS`. It was typed as a number of seconds, which the server rejects.
- The entry point exports `RecastSegmentPack`, plus 20 types that resource methods take or return but callers could not import: `CreatureVoice`, `GenerateLocationMotionInput`, `ModelFamilyGroup`, `ReferenceCaptionParams`, `AssembleNarratedVideoParams`, `RunNodeOptions`, `TextToPickerParams`, `TextToPickerResult`, `PipelineRecord`, `PendingApproval`, `PipelineTimeline`, the five `Pro3DRender*` types, `Collaborator`, `AddCollaboratorInput`, `SharedWorkflow` and `DroppedCollaborator`.
- The README links nodaro.ai/docs, and its agent primer matches the raw copy again (the voice and audio section was missing; voice cloning, retired, is gone from it).
