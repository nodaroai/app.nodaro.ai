import { isViduQ4Provider } from "@nodaro/shared/models"

/**
 * The inputs a Vidu Q4 run must carry before anything is reserved — ONE rule,
 * shared by `/v1/generate-video` (a 400 before the reservation) and the DAG
 * payload builder (a throw before any jobs row exists).
 *
 * Vidu Q4 picks its KIE endpoint from what is wired: any reference image or
 * reference audio means reference-to-video, whose schema REQUIRES a non-empty
 * prompt and at least one reference image (a start frame counts — the runner
 * demotes it into the reference images). Image-to-video takes an optional
 * prompt, so a frame-only run needs nothing here.
 *
 * The prompt checked is the one the run SENDS (after composition): the runner
 * adds a frame-binding sentence of its own, so an empty user prompt has to be
 * caught before that point. Returns null when the run is legal, or for any
 * other provider.
 */
export function viduQ4InputProblem(args: {
  provider: string | undefined
  prompt: string | undefined
  hasStartFrame: boolean
  referenceImageCount: number
  referenceAudioCount: number
}): { code: "image_required" | "validation_error"; message: string } | null {
  if (!isViduQ4Provider(args.provider)) return null
  const referenceMode = args.referenceImageCount > 0 || args.referenceAudioCount > 0
  if (!referenceMode) return null
  if (!args.hasStartFrame && args.referenceImageCount === 0) {
    return {
      code: "image_required",
      message: "Vidu Q4 reference audio needs a start frame or at least one reference image to go with it.",
    }
  }
  if (!args.prompt?.trim()) {
    return {
      code: "validation_error",
      message: "Vidu Q4 needs a prompt when reference images or audio are connected — describe the shot and name each reference.",
    }
  }
  return null
}
