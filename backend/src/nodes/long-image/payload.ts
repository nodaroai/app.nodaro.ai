import { longImageInputImages, longImageMode, longImageProblem, longImageRun, longImageRunCreditId, longImageWiredPictures } from "@nodaro/render-rules"
import { applyPromptPolicies } from "../../lib/prompt-policy.js"
import { LONG_IMAGE_MODEL_KEY } from "../../providers/kie/models.js"
import type { UnitPayload } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

// The orchestrator payload: the video-queue job worker.ts runs, charged the row
// the route charges for the same run (longImageRunCreditId). Wired text (the
// `prompt` pip) wins over the node's own prompt. Each picture comes from the
// input it is wired to (the image lane, `unitInputs`), only the mode's own: a
// wired input that holds no picture refuses the run, as does an empty prompt
// or a product page with no product picture — here, before anything is
// reserved. The prompt is policed here, its assembly point on this lane (the
// unit's payload runs before the engine's own prompt step). `model` names the
// provider model to the pickup's safety check, as the route's queue job does.
export const payload: UnitPayload = (kit) => {
  const mode = longImageMode(kit.data.mode)
  const wired = typeof kit.resolvedInputs.prompt === "string" && kit.resolvedInputs.prompt.trim() !== "" ? kit.resolvedInputs.prompt : undefined
  const { pictures, problem: pictureProblem } = longImageWiredPictures(kit.resolvedInputs.unitInputs, mode)
  // The node's own settings (only those: a picture is never read off its data) and its wired pictures.
  const asked = longImageRun({ mode, length: kit.data.length, resolution: kit.data.resolution, prompt: wired ?? kit.data.prompt, ...pictures })
  const problem = pictureProblem ?? longImageProblem(asked)
  if (problem) throw new Error(problem)
  const run = { ...asked, prompt: applyPromptPolicies({ prompt: asked.prompt, negativePrompt: "", kind: "image" }).prompt }
  return kit.ffmpegResult(
    descriptor.type,
    { jobId: kit.jobId, ...run, inputImages: longImageInputImages(run), model: LONG_IMAGE_MODEL_KEY, usageLogId: kit.usageLogId },
    longImageRunCreditId(descriptor.type, run),
  )
}
