/**
 * `planExport` — the film export as an ordered PLAN of node runs (spec D8).
 *
 * The studio's `useExport` hook chains the export imperatively in the browser:
 * mux each voiced clip, concatenate, mux the soundtrack, optionally upscale.
 * An agent cannot hold that chain open — three to four minutes-long jobs behind
 * one request is exactly the long-lived call the platform refuses — so the
 * server hands back the SAME steps as data and the caller runs them with the
 * verbs it already has (`merge_video_audio`, `combine_videos`, `video_upscale`,
 * `get_job`), then records the finished film with the `add_cut` op.
 *
 * This module is therefore the hook's `exportMp4` + `upscale4k` with the
 * `runAndWait` calls taken out: same order, same params, same credit model ids.
 * Nothing here runs anything and nothing here reads a clock — the plan for a
 * given production is a pure function of it, so the route may compute it on
 * every read and an agent may re-plan a half-finished export and get the same
 * step ids back.
 *
 * **Steps consume earlier steps.** The concatenate takes the muxed video of a
 * voiced clip, the soundtrack takes the concatenate's output, the upscale takes
 * whatever came last. A step's video parameter is therefore either a literal
 * url or a {@link StepRef} naming the step that produces it; the runner
 * substitutes that step's result `videoUrl`, falling back to the step's OWN
 * input video when the node returned none — the `merged.videoUrl ?? c.clipUrl`
 * the hook writes at each hop.
 *
 * **No SDK import.** Each node's body is typed against a local structural
 * interface below rather than the SDK's request types: the package must not
 * depend on `@nodaro/sdk` (the SDK consumes this package, never the reverse —
 * `package.test.ts` pins it), and these four bodies are small, stable and
 * already pinned from the other side by the routes' own zod schemas.
 */
import type { Production } from "../ops/production"
import type { RequestContext } from "./context"

/**
 * Credit model identifiers — the ids the three routes' `creditGuard` declares
 * (`backend/src/routes/{merge-video-audio,combine-videos,video-upscale}.ts`).
 * They are what `client.credits.modelCosts` is asked for, so a rename on either
 * side shows up here as an unpriced step rather than as a wrong number.
 */
const MERGE_COST_MODEL = "merge-video-audio"
const COMBINE_COST_MODEL = "combine-videos"
/** The 4K upscale runs on `topaz`; the route maps that provider → this model. */
const UPSCALE_COST_MODEL = "topaz-video"

/** A video parameter that is produced by an earlier step of the same plan. */
export interface StepRef {
  /** {@link ExportStep.id} of the step whose result video this is. */
  readonly fromStep: string
}

/** A video parameter: a url that already exists, or an earlier step's output. */
export type StepVideo = string | StepRef

/** `POST /v1/merge-video-audio` — mux one audio track onto one video. */
export interface MergeVideoAudioBody {
  readonly videoUrl: StepVideo
  readonly audioUrl: string
  /** Keep the video's own audio under the new track. Absent ⇒ the route default. */
  readonly keepOriginalAudio?: boolean
  /** Attributes the spend to the production. */
  readonly workflowId?: string
}

/** `POST /v1/combine-videos` — concatenate in order. */
export interface CombineVideosBody {
  readonly videoUrls: ReadonlyArray<StepVideo>
  readonly transition: "cut"
  readonly audioMode: "keep" | "remove"
  readonly workflowId?: string
}

/** `POST /v1/video-upscale` — the explicit, expensive 4K pass. */
export interface VideoUpscaleBody {
  readonly videoUrl: StepVideo
  readonly upscaleFactor: "4"
  readonly provider: "topaz"
  readonly workflowId?: string
}

/** What every step carries, whatever node it runs. */
interface ExportStepBase {
  /**
   * Stable within one plan and derived from the document (`voice-<shotId>`,
   * `combine`, `soundtrack`, `upscale`) — never minted, so re-planning the same
   * production yields the same references.
   */
  readonly id: string
  /** The step's own words, as the studio's progress line says them. */
  readonly label: string
  /** The credit model this step is priced under. */
  readonly creditModel: string
  /** Its price from `ctx.modelCosts`, or `null` when that price is unknown. */
  readonly credits: number | null
}

/** One node run of the export, with the body to POST. */
export type ExportStep =
  | (ExportStepBase & { readonly node: "merge-video-audio"; readonly params: MergeVideoAudioBody })
  | (ExportStepBase & { readonly node: "combine-videos"; readonly params: CombineVideosBody })
  | (ExportStepBase & { readonly node: "video-upscale"; readonly params: VideoUpscaleBody })

/** What the export route returns. */
export interface ExportPlan {
  /**
   * False when the production has fewer than two clips — `combine-videos`
   * requires two inputs, so there is nothing to run. The plan is empty rather
   * than an error: a builder is pure, and the route is the place to refuse.
   */
  readonly canExport: boolean
  /** The steps, in the order they must run. */
  readonly steps: ReadonlyArray<ExportStep>
  /** The step whose output IS the film, or `null` when nothing can run. */
  readonly resultStepId: string | null
  /**
   * Total credits for the whole plan, or `null` when ANY step is unpriced — a
   * partial sum presented as the estimate would understate the spend, and the
   * caller has each step's own `credits` when it wants the breakdown.
   *
   * `combine-videos` is priced dynamically at run (its route computes credits
   * from the transition and the clip lengths), so its catalog cost is a FLOOR,
   * exactly as the studio's own preview treats it.
   */
  readonly estimate: number | null
  /** The credit models with no price, each named once, in step order. */
  readonly unpriced: ReadonlyArray<string>
}

/** What the caller decides about this export, as opposed to the document. */
export interface ExportPlanOptions {
  /** Append the 4K `video-upscale` pass (EXPENSIVE — always explicit). */
  readonly upscale?: boolean
  /**
   * The workflow the spend is attributed to (the production's own id). The
   * document does not carry it — `parseProduction` reads `settings.studio`, not
   * the workflow row — so the route that knows the id passes it here.
   */
  readonly workflowId?: string
}

/** One entry of the ordered clip/voice list the plan is built from. */
interface ExportClip {
  readonly shotId: string
  readonly clipUrl: string
  readonly voiceUrl?: string
}

/**
 * The plan for a production with nothing to stitch — a FRESH object every
 * call, like every other value here, so a caller can never write through one
 * plan's empty arrays into the next one's.
 */
function nothingToExport(): ExportPlan {
  return {
    canExport: false,
    steps: [],
    resultStepId: null,
    estimate: null,
    unpriced: [],
  }
}

/**
 * The ordered export steps for `production`, priced from `ctx.modelCosts`.
 *
 * Pure and copy-on-write: the production is only read, and every returned
 * object is fresh.
 */
export function planExport(
  production: Production,
  options?: ExportPlanOptions,
  ctx?: RequestContext,
): ExportPlan {
  const clips: ExportClip[] = []
  for (const shot of production.shots) {
    // Only a shot with a clip takes part — a voiceover on an unframed shot has
    // no video to ride on, exactly as the hook's `filter((s) => s.clip)` says.
    if (!shot.clip) continue
    const voiceUrl = shot.voice?.url
    clips.push({
      shotId: shot.id,
      clipUrl: shot.clip.url,
      ...(voiceUrl ? { voiceUrl } : {}),
    })
  }
  if (clips.length < 2) return nothingToExport()

  const workflow = options?.workflowId ? { workflowId: options.workflowId } : {}
  const priceOf = (model: string): number | null => {
    const cost = ctx?.modelCosts?.[model]
    return typeof cost === "number" ? cost : null
  }

  const steps: ExportStep[] = []
  const hasVoice = clips.some((c) => c.voiceUrl)

  // 1. Mux each voiced clip. Independent of one another — the runner may do
  //    them in parallel, as the hook's `Promise.all` does — but ordered here so
  //    the plan reads down the timeline.
  const videoUrls: StepVideo[] = clips.map((clip) => {
    if (!clip.voiceUrl) return clip.clipUrl
    const id = `voice-${clip.shotId}`
    steps.push({
      id,
      node: "merge-video-audio",
      label: "Adding voiceovers",
      creditModel: MERGE_COST_MODEL,
      credits: priceOf(MERGE_COST_MODEL),
      params: { videoUrl: clip.clipUrl, audioUrl: clip.voiceUrl, ...workflow },
    })
    return { fromStep: id }
  })

  // 2. Concatenate. Audio survives the stitch only when there is dialogue in it.
  steps.push({
    id: "combine",
    node: "combine-videos",
    label: "Stitching",
    creditModel: COMBINE_COST_MODEL,
    credits: priceOf(COMBINE_COST_MODEL),
    params: {
      videoUrls,
      transition: "cut",
      audioMode: hasVoice ? "keep" : "remove",
      ...workflow,
    },
  })
  let last = "combine"

  // 3. Mux the soundtrack over the whole thing, keeping the voice when present.
  if (production.music) {
    steps.push({
      id: "soundtrack",
      node: "merge-video-audio",
      label: "Adding soundtrack",
      creditModel: MERGE_COST_MODEL,
      credits: priceOf(MERGE_COST_MODEL),
      params: {
        videoUrl: { fromStep: last },
        audioUrl: production.music.url,
        keepOriginalAudio: hasVoice,
        ...workflow,
      },
    })
    last = "soundtrack"
  }

  // 4. The 4K pass, only when asked.
  if (options?.upscale) {
    steps.push({
      id: "upscale",
      node: "video-upscale",
      label: "Upscaling to 4K",
      creditModel: UPSCALE_COST_MODEL,
      credits: priceOf(UPSCALE_COST_MODEL),
      params: {
        videoUrl: { fromStep: last },
        upscaleFactor: "4",
        provider: "topaz",
        ...workflow,
      },
    })
    last = "upscale"
  }

  const unpriced: string[] = []
  for (const step of steps) {
    if (step.credits === null && !unpriced.includes(step.creditModel)) {
      unpriced.push(step.creditModel)
    }
  }
  const estimate = unpriced.length
    ? null
    : steps.reduce((sum, step) => sum + (step.credits ?? 0), 0)

  return { canExport: true, steps, resultStepId: last, estimate, unpriced }
}
