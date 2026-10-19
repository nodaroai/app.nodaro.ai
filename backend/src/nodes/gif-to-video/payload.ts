import type { UnitPayload } from "../kit.js"

// The orchestrator payload: the video-queue job worker.ts runs, reserving the
// "gif-to-video" row. The GIF arrives as an image input (an uploaded .gif) or
// from the node's own upload (data.gifUrl).
export const payload: UnitPayload = (kit) =>
  kit.ffmpegResult("gif-to-video", {
    jobId: kit.jobId,
    gifUrl: kit.resolvedInputs.imageUrl || kit.data.gifUrl,
    loopToMinimum: kit.data.loopToMinimum ?? true,
    targetDuration: kit.data.targetDuration ?? 3,
    interpolate: kit.data.interpolate ?? true,
    alphaBackground: kit.data.alphaBackground ?? "white",
    usageLogId: kit.usageLogId,
  })
