/**
 * When a public video node outputs its input unchanged — no job, no charge —
 * because there is nothing for it to do (spec R14). One rule for both engines:
 * the orchestrator asks before any reservation, the canvas block before its API
 * call. The API routes keep their limits (Combine Videos still needs two URLs;
 * an empty overlay request is still `no_layers`).
 */
export type PassThroughWarning = "no_layers" | "no_captions" | "single_input"
export interface PassThrough { readonly videoUrl: string; readonly warning: PassThroughWarning }

const present = (u: string | null | undefined): u is string => typeof u === "string" && u.length > 0

/** Exactly one resolved video → that video, unchanged. */
export function combineVideosPassThrough(videoUrls: ReadonlyArray<string | null | undefined>): PassThrough | null {
  const urls = videoUrls.filter(present)
  return urls.length === 1 ? { videoUrl: urls[0]!, warning: "single_input" } : null
}

/** A wired layer plan that resolved to nothing, with no handle layer either → the base video. */
export function videoOverlayPassThrough(input: {
  readonly videoUrl: string | null | undefined
  readonly planWired: boolean
  readonly layerCount: number
}): PassThrough | null {
  if (!input.planWired || input.layerCount > 0 || !present(input.videoUrl)) return null
  return { videoUrl: input.videoUrl, warning: "no_layers" }
}

/** A wired caption plan whose styling produced no segment → the input video. */
export function captionPlanPassThrough(input: {
  readonly videoUrl: string | null | undefined
  readonly planWired: boolean
  readonly segmentCount: number
}): PassThrough | null {
  if (!input.planWired || input.segmentCount > 0 || !present(input.videoUrl)) return null
  return { videoUrl: input.videoUrl, warning: "no_captions" }
}
