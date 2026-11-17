import { sunoSpeechProblem, sunoSpeechRun } from "@nodaro/render-rules"
import type { UnitPayload } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

// The orchestrator payload: the video-queue job worker.ts runs, holding the
// node's flat row, as the route does. Wired text (the `prompt` pip) is the
// mode's own text — the brief in Brief mode, the script in Script mode — and
// wins over the node's own field. A run that could not be sent (an empty
// text, one over its limit) fails here, before anything is reserved.
export const payload: UnitPayload = (kit) => {
  const mode = kit.data.mode
  const wired = typeof kit.resolvedInputs.prompt === "string" && kit.resolvedInputs.prompt.trim() !== "" ? kit.resolvedInputs.prompt : undefined
  const run = sunoSpeechRun({
    ...kit.data,
    ...(wired !== undefined ? (mode === "script" ? { script: wired } : { prompt: wired }) : {}),
  })
  const problem = sunoSpeechProblem(run)
  if (problem) throw new Error(problem)
  return kit.ffmpegResult(descriptor.type, { jobId: kit.jobId, ...run, usageLogId: kit.usageLogId })
}
