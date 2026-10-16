import type { UnitPayload } from "../kit.js"

export const payload: UnitPayload = (kit) =>
  kit.ffmpegResult("fixture-echo", { jobId: kit.jobId, videoUrl: kit.resolvedInputs.videoUrl || kit.data.videoUrl, usageLogId: kit.usageLogId })
