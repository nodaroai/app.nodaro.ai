import type { UnitPayload } from "../kit.js"

// The orchestrator payload: the video-queue job worker.ts runs, reserving the "remove-audio" row.
export const payload: UnitPayload = (kit) =>
  kit.ffmpegResult("remove-audio", {
    jobId: kit.jobId,
    videoUrl: kit.resolvedInputs.videoUrl || kit.data.videoUrl,
    usageLogId: kit.usageLogId,
  })
