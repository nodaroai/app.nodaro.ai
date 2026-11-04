import type { UnitPayload } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

// The orchestrator payload: the video-queue job worker.ts runs, reserving the
// type's own row. The wired video wins over the node's own field (as every
// video-processing node's), and `frames` is the node's toggle (off by default).
export const payload: UnitPayload = (kit) =>
  kit.ffmpegResult(descriptor.type, {
    jobId: kit.jobId,
    videoUrl: kit.resolvedInputs.videoUrl || kit.data.videoUrl,
    frames: kit.data.frames === true,
    usageLogId: kit.usageLogId,
  })
