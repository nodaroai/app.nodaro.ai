import { explicitFourKOf } from "@nodaro/shared/models"
import { SEEDANCE_LIP_SYNC_SECONDS, seedanceLipSyncResolution, tailExtendResolution } from "@nodaro/shared/credits"
import { isSeedanceExtendProvider } from "@nodaro/shared/models"
import { SEEDANCE_DRAFT_RESOLUTION, isSeedanceDraftCapable } from "@nodaro/shared/model-catalog"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../../providers/kie/models.js"
import { tailRecipeSeconds, TAIL_RECIPES } from "../../lib/extend-recipe.js"
import { resolveSeedance2Inputs } from "@nodaro/prompts/assembly"
import { SEEDANCE_2_REF_LIMITS, VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared/models"
import type { AlternateRouteJobType } from "../../lib/alternate-route-request.js"
import type { PluginAlternateRouteRequest } from "../../lib/private-plugins/types.js"
import { seedanceSentAspect } from "../../lib/seedance-request-shape.js"

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
export const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.length > 0) : [])
export const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : undefined
}

/**
 * The request as it is known at admission, from the job's input (the request
 * body as the route stored it). Media URLs are the person's, before any
 * re-encoding; reference lengths are the measured ones when the route
 * already probed them (`refVideoDurationsSec`), else left out.
 */
export function admissionRouteRequest(args: {
  jobId: string
  jobType: AlternateRouteJobType
  model: string
  parent: { jobId: string; jobType: string } | null
  service: string
  input: Record<string, unknown>
  /** The output seconds the job's price id names (`:8s:`), used when the input asks for none (Auto, or a lane with a fixed length). */
  pricedSec?: number
}): PluginAlternateRouteRequest {
  const i = args.input
  const lipSync = args.jobType === "lip-sync"
  const provider = str(i.provider) ?? (args.jobType === "extend-video" ? args.model + "-extend" : args.model)
  const extend = args.jobType === "extend-video" && isSeedanceExtendProvider(provider) ? provider : undefined
  const recipe = extend ? TAIL_RECIPES[extend] : undefined
  const t2v = args.jobType === "text-to-video" || (recipe && !recipe.startImage)
  const defaults = (t2v ? KIE_TEXT_TO_VIDEO_MODELS : KIE_VIDEO_MODELS)[args.model]?.extraParams
  const source = str(i.videoUrl) ?? str(i.video)
  const referenceVideoUrls = strList(i.referenceVideoUrls)
    .concat(str(i.referenceVideoUrl) ? [str(i.referenceVideoUrl)!] : [])
    .concat(extend && source ? [source] : [])
  const duration = lipSync ? SEEDANCE_LIP_SYNC_SECONDS
    : extend ? tailRecipeSeconds(extend, i.duration)
    : num(i.duration) ?? num(defaults?.duration) ?? args.pricedSec
  const resolution = i.draft === true && isSeedanceDraftCapable(args.model) ? SEEDANCE_DRAFT_RESOLUTION : lipSync ? seedanceLipSyncResolution(args.model, i.resolution)
    : extend ? tailExtendResolution(extend, i.resolution)
    // A 4K spelling (`2160p`, `UHD`) reads as `4k` here too: a job input written past the HTTP
    // pre-check (a workflow payload) must quote and key its factor exactly as `4k` does.
    : explicitFourKOf(args.model, i.resolution) ?? str(i.resolution) ?? str(defaults?.resolution)
  const voiced = Array.isArray(i.dialogue) && i.dialogue.length > 0 && typeof i.characterVoices === "object" && i.characterVoices !== null
  const generateAudio = lipSync || voiced ? false : typeof i.generateAudio === "boolean" ? i.generateAudio : typeof i.sound === "boolean" ? i.sound : defaults?.generate_audio === true
  const taskType = recipe?.referenceTaskType ?? str(i.referenceTaskType)
  const aspect = taskType === "extend" || taskType === "edit" ? "adaptive" : str(i.aspectRatio) ?? str(defaults?.aspect_ratio)
  const prompt = typeof i.prompt === "string" ? i.prompt : ""
  const firstFrame = str(i.startFrameUrl) ?? str(i.imageUrl) ?? str(i.sourceImageUrl) ?? (recipe?.startImage ? "https://frame.invalid/last.png" : undefined)
  return {
    jobId: args.jobId,
    jobType: args.jobType,
    model: args.model,
    parent: args.parent,
    service: args.service,
    kind: "generate",
    prompt: recipe && duration !== undefined ? recipe.prompt(prompt, duration) : lipSync ? prompt || "A person speaking naturally" : prompt,
    draft: i.draft === true,
    referenceImageUrls: strList(i.referenceImageUrls),
    referenceVideoUrls,
    referenceAudioUrls: voiced
      ? [VOICE_TRACK_STAND_IN]
      : strList(i.referenceAudioUrls).concat(str(i.audioUrl) && args.jobType === "lip-sync" ? [str(i.audioUrl)!] : []),
    ...(taskType ? { referenceTaskType: taskType } : {}),
    ...(resolution ? { resolution } : {}),
    ...(i.outputFormat === "mov" ? { outputFormat: "mov" as const } : {}),
    ...(aspect ? { aspectRatio: aspect } : {}),
    ...(duration !== undefined ? { durationSec: duration } : {}),
    // The length asked for; an edit's output is its source's length, which the
    // route reads from the measured clips (`referenceVideoDurationsSec`).
    ...(duration !== undefined && duration > 0 && taskType !== "edit" ? { outputSec: duration } : {}),
    ...(generateAudio !== undefined ? { generateAudio } : {}),
    ...(firstFrame ? { firstFrameUrl: firstFrame } : {}),
    ...(str(i.endFrameUrl) ? { lastFrameUrl: str(i.endFrameUrl) } : {}),
  }
}

/**
 * The frames and references seated as the default provider's Seedance path
 * seats them (`resolveSeedance2Inputs`, the one resolver it uses): with any
 * reference present the frames ride as reference images, so a lip-sync
 * (portrait + voice) or a voiced run is judged as the reference run it
 * really is, never as frames combined with references.
 */
export function seatedLikeTheProvider(req: PluginAlternateRouteRequest): PluginAlternateRouteRequest {
  const limits = { ...SEEDANCE_2_REF_LIMITS, ...(VIDEO_REF_LIMITS_BY_PROVIDER[req.model] ?? {}) }
  const r = resolveSeedance2Inputs({
    prompt: req.prompt,
    firstFrameUrl: req.firstFrameUrl,
    lastFrameUrl: req.lastFrameUrl,
    refImageUrls: req.referenceImageUrls,
    refVideoUrls: req.referenceVideoUrls,
    refAudioUrls: req.referenceAudioUrls,
    limits,
  })
  const { firstFrameUrl: _f, lastFrameUrl: _l, aspectRatio: _a, ...rest } = req
  // The aspect it is sent at, decided after the seating as the provider decides it.
  const aspectRatio = seedanceSentAspect(req.model, req.aspectRatio, {
    ...(r.firstFrameUrl ? { firstFrameUrl: r.firstFrameUrl } : {}),
    ...(r.lastFrameUrl ? { lastFrameUrl: r.lastFrameUrl } : {}),
    referenceImageCount: r.referenceImageUrls.length,
    referenceVideoCount: r.referenceVideoUrls.length,
  })
  return {
    ...rest,
    prompt: r.promptSuffix ? [req.prompt, r.promptSuffix].filter(Boolean).join("\n\n") : req.prompt,
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    referenceImageUrls: r.referenceImageUrls,
    referenceVideoUrls: r.referenceVideoUrls,
    referenceAudioUrls: r.referenceAudioUrls,
    ...(r.firstFrameUrl ? { firstFrameUrl: r.firstFrameUrl } : {}),
    ...(r.lastFrameUrl ? { lastFrameUrl: r.lastFrameUrl } : {}),
    // Measured lengths stay index-aligned only while the clip list is unchanged.
    ...(req.referenceVideoDurationsSec && r.referenceVideoUrls.length === req.referenceVideoUrls.length ? { referenceVideoDurationsSec: req.referenceVideoDurationsSec } : {}),
  }
}


/**
 * The voice track a voiced run synthesises only after admission: its shape (an
 * MP3, one reference audio) is what the route judges and prices, so it stands
 * in for the file the run will send.
 */
export const VOICE_TRACK_STAND_IN = "https://voice-track.invalid/track.mp3"
