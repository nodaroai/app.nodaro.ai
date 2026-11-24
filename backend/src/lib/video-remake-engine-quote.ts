/**
 * Video Remake's two engines as NAMED choices of `POST /v1/video-to-video`.
 *
 * A request to that route whose `provider` is one of Video Remake's public
 * engine ids (`"nodaro-prism"`, `"nodaro-pulse"`) starts nothing there: it is
 * answered with Video Remake's own quote for the same clip and instruction,
 * and with the request to send to `POST /v1/video-remake` to run it. This
 * file holds what that answer is made of: which ids are such a choice, the
 * run Video Remake would make of the request, the estimate asked of the
 * engine's own route, and the two shapes the quote is answered in (the run
 * route's and `POST /v1/quote`'s).
 *
 * The ids are the ROUTE's own accepted values. They are not Video to Video
 * models: not in `VIDEO_TO_VIDEO_NODE_PROVIDERS`, not in the node's menu, and
 * a workflow node cannot run on one (`assertNoVideoRemakeEngineOnNode`).
 *
 * Core reaches the engine as every other caller inside the platform does: an
 * internal request to its estimate route, as the user. Nothing of the engine
 * is imported.
 */
import type { FastifyRequest } from "fastify"
import { WORKSPACE_HEADER_LOWER } from "@nodaro/shared/organizations"
import {
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  NODARO_MOTION_ENGINES,
  VIDEO_REMAKE_FLASH_ENGINE_NAMES,
  castSwapEngineFrom,
  castSwapEngineOfRun,
  nodaroMotionEngineOfFlash,
  videoRemakeFlashEngineFrom,
  type VideoRemakeFlashEngine,
  nodaroMotionEngineName,
  nodaroMotionEngineOf,
  type CastSwapEngine,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
import { config } from "./config.js"
import { callerGrantOf, withJobSubmissionContext } from "./job-submission-context.js"
import { neutralBreakdown, privacyCreditsOf } from "./nodaro-motion-quote.js"
import { CAST_SWAP_PREFIX, VIDEO_REMAKE_PREFIX } from "./video-remake-paths.js"
import { upscaleQuoteOf, type VideoRemakeOutputResolution, type VideoRemakeResolution, type VideoRemakeUpscaleChoice } from "./video-remake-upscale-choice.js"

/** The engine's estimate route, in the spelling every engine version serves. */
export const VIDEO_REMAKE_ESTIMATE_ROUTE = `${CAST_SWAP_PREFIX}/estimate`

/** The route a quoted run is sent to. */
export const VIDEO_REMAKE_RUN_ROUTE = VIDEO_REMAKE_PREFIX

/**
 * The Video Remake engine `provider` names, by its current public id only. An
 * earlier public id or an internal one is not a choice of this route: it is
 * left for the route's own refusal of an unknown model.
 */
export function videoRemakeEngineOf(provider: unknown): NodaroMotionEngine | undefined {
  return NODARO_MOTION_ENGINES.find((engine) => engine === provider)
}

/** A Video Remake choice `provider` names: an engine, or (decided 2026-11-22) a Flash choice beside its engine. */
export interface VideoRemakeProviderChoice {
  /** The engine whose run it is. */
  readonly engine: NodaroMotionEngine
  /** The Flash choice named, when one is (`"nodaro-prism-flash"`, `"nodaro-pulse-flash"`). */
  readonly flash?: VideoRemakeFlashEngine
}

/**
 * The Video Remake choice `provider` names, by its current public id: an engine (`videoRemakeEngineOf`), or a Flash
 * choice (offered only where its engine's Offer Flash is on: the route refuses it otherwise, 409 `flash_not_offered`).
 */
export function videoRemakeChoiceOf(provider: unknown): VideoRemakeProviderChoice | undefined {
  const flash = videoRemakeFlashEngineFrom(provider)
  if (flash) return { engine: nodaroMotionEngineOfFlash(flash), flash }
  const engine = videoRemakeEngineOf(provider)
  return engine ? { engine } : undefined
}

/** The name people read for a choice: the Flash choice's, else the engine's. */
export function videoRemakeChoiceName(choice: VideoRemakeProviderChoice): string {
  return choice.flash ? VIDEO_REMAKE_FLASH_ENGINE_NAMES[choice.flash] : nodaroMotionEngineName(castSwapEngineFrom(choice.engine)!)
}

/** The fields of a Video to Video request Video Remake reads: the clip, the instruction and its own two levers. */
export interface VideoRemakeInstruction {
  readonly videoUrl: string
  readonly prompt: string
  readonly resolution?: "480p" | "720p" | "1080p"
  readonly draft?: boolean
}

/** The `POST /v1/video-remake` body that runs a quoted request: the clip, the instruction, no role. */
export interface VideoRemakeInstructionRun {
  videoUrl: string
  roles: []
  postPrompt: string
  /** The engine, or the Flash choice named. */
  engine: NodaroMotionEngine | VideoRemakeFlashEngine
  resolution?: "480p" | "720p" | "1080p"
  draft?: boolean
}

/**
 * The run Video Remake makes of a Video to Video request: the clip, the
 * prompt as its `postPrompt`, no role, the engine, and `resolution` / `draft`
 * when named. Built field by field: nothing else of the request reaches it.
 */
export function videoRemakeRunOf(engine: NodaroMotionEngine | VideoRemakeFlashEngine, input: VideoRemakeInstruction): VideoRemakeInstructionRun {
  return {
    videoUrl: input.videoUrl,
    roles: [],
    postPrompt: input.prompt,
    engine,
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
    ...(input.draft !== undefined ? { draft: input.draft } : {}),
  }
}

/** Video Remake's quote, as people read it: the neutral key names, the engine by its public id and its name. */
export interface VideoRemakeEngineQuote {
  /** The engine quoted, or the Flash choice. */
  engine: NodaroMotionEngine | VideoRemakeFlashEngine
  engineName: string
  /** What the run holds when it starts. */
  totalCredits: number
  /** What the run is expected to be charged, when the engine says. */
  expectedCredits?: number
  breakdown: Record<string, number>
  /** Charged only if a refused clip is retried; in neither total. */
  privacyCredits?: number
  settlesLower: boolean
  /** The engine's size, where the engine answers the upscale choice (lib/video-remake-upscale-choice.ts). */
  resolution?: VideoRemakeResolution
  /** The size delivered: the next size on a run the choice upscales ("4k" for a 1080p run). */
  outputResolution?: VideoRemakeOutputResolution
  /** The choice the run would be made with ("next" where offered and not turned off in the run's body). */
  upscale?: VideoRemakeUpscaleChoice
  /** Whether the choice is offered for this run. */
  upscaleOffered?: boolean
}

/** The engine's estimate answer (bare, or under `data`) as a quote; undefined when it is not one. */
export function videoRemakeEngineQuoteOf(answer: unknown, asked: NodaroMotionEngine | VideoRemakeFlashEngine): VideoRemakeEngineQuote | undefined {
  const outer = isRec(answer) ? answer : undefined
  const quote = outer && isRec(outer.data) ? outer.data : outer
  if (!quote || typeof quote.totalCredits !== "number" || !Number.isFinite(quote.totalCredits)) return undefined
  // A Flash choice: as the engine answers it, else as it was asked for.
  const flash = videoRemakeFlashEngineFrom(quote.engine) ?? videoRemakeFlashEngineFrom(asked)
  // The engine it priced: its own answer when it names one, else the one asked for.
  const priced: CastSwapEngine = castSwapEngineOfRun(quote.engine) ?? castSwapEngineOfRun(asked) ?? CAST_SWAP_ENGINE_WHEN_OMITTED
  const privacyCredits = privacyCreditsOf(quote)
  return {
    engine: flash ?? nodaroMotionEngineOf(priced),
    engineName: flash ? VIDEO_REMAKE_FLASH_ENGINE_NAMES[flash] : nodaroMotionEngineName(priced),
    totalCredits: quote.totalCredits,
    ...(typeof quote.expectedCredits === "number" && Number.isFinite(quote.expectedCredits) ? { expectedCredits: quote.expectedCredits } : {}),
    breakdown: neutralBreakdown(quote.breakdown),
    ...(privacyCredits !== undefined ? { privacyCredits } : {}),
    settlesLower: quote.settlesLower === true,
    ...upscaleQuoteOf(quote),
  }
}

/** What `POST /v1/video-to-video` answers for a Video Remake engine: the quote and the request that runs it. No job. */
export interface VideoRemakeQuoteAnswer {
  /** Always true: nothing was started and nothing is held. */
  quoteOnly: true
  message: string
  videoRemake: {
    quote: VideoRemakeEngineQuote
    run: { method: "POST"; path: typeof VIDEO_REMAKE_RUN_ROUTE; body: VideoRemakeInstructionRun }
  }
}

export function videoRemakeQuoteAnswer(quote: VideoRemakeEngineQuote, run: VideoRemakeInstructionRun): VideoRemakeQuoteAnswer {
  return {
    quoteOnly: true,
    message: `${quote.engineName} is a Video Remake engine: this is its price quote, and nothing was started. To run it, send videoRemake.run.body to POST ${VIDEO_REMAKE_RUN_ROUTE}.`,
    videoRemake: { quote, run: { method: "POST", path: VIDEO_REMAKE_RUN_ROUTE, body: run } },
  }
}

/** The same quote in the shape `POST /v1/quote` answers for a node: the hold, the expected charge and what to know. */
export function videoRemakeNodeQuote(quote: VideoRemakeEngineQuote): {
  identifier: string
  reserve: number
  expected?: number
  adjustments: { code: string; message: string; credits?: number }[]
  warnings: { code: string; message: string }[]
} {
  const expected = quote.expectedCredits
  return {
    identifier: quote.engine,
    reserve: quote.totalCredits,
    ...(expected !== undefined && expected !== quote.totalCredits ? { expected: Math.min(expected, quote.totalCredits) } : {}),
    adjustments: [],
    warnings: [
      {
        code: "quote_only_provider",
        message: `${quote.engineName} is a Video Remake engine: POST /v1/video-to-video answers this quote and starts nothing. The run is POST ${VIDEO_REMAKE_RUN_ROUTE}.`,
      },
      ...(quote.settlesLower
        ? [{ code: "settles_to_actual", message: "The video's length is left to the model: the run is charged for what it delivers and the rest of the hold is released." }]
        : []),
      ...(quote.privacyCredits !== undefined && quote.privacyCredits > 0
        ? [{
            code: "refused_clip_retry",
            message: `If the video model refuses the clip the run is retried once, for ${quote.privacyCredits} more credits charged only then. They are in neither figure, and a run needs the balance for both.`,
          }]
        : []),
    ],
  }
}

/**
 * Video Remake's estimate for `run`, asked of the engine's own route as the
 * request's user: an internal request carrying the user, the workspace, the
 * caller's grant and, for a web caller on the free pool, that flag. The
 * payload is `run` with the engine by its internal id (the one every engine
 * version takes) and nothing else. Nothing is held or created by it.
 */
export function requestVideoRemakeEstimate(
  req: FastifyRequest,
  run: VideoRemakeInstructionRun,
  opts: { webFreeMode?: boolean } = {},
): Promise<{ statusCode: number; body: string }> {
  const userId = req.userId!
  const grant = callerGrantOf(req)
  // A Flash choice as it is (the engine hook admits it only where offered); an engine by its internal id.
  const payload = { ...run, engine: videoRemakeFlashEngineFrom(run.engine) ?? castSwapEngineFrom(run.engine) }
  return withJobSubmissionContext(
    { userId, method: "POST", url: VIDEO_REMAKE_ESTIMATE_ROUTE, ...(grant !== undefined ? { grant } : {}) },
    () =>
      req.server.inject({
        method: "POST",
        url: VIDEO_REMAKE_ESTIMATE_ROUTE,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
          "x-internal-user-id": userId,
          ...(req.workspaceId ? { [WORKSPACE_HEADER_LOWER]: req.workspaceId } : {}),
          ...(opts.webFreeMode ? { "x-web-free-mode": "true" } : {}),
          "content-type": "application/json",
        },
        payload,
      }),
  )
}

/**
 * A workflow node's refusal of a Video Remake engine as its model: a Video to
 * Video node runs the node's own models only. Thrown with the code
 * `provider_not_supported` before anything is built for the node.
 */
export function assertNoVideoRemakeEngineOnNode(provider: unknown, nodeLabel: string): void {
  // A Flash choice too (Nodaro Prism Flash, Nodaro Pulse Flash): a node runs none of Video Remake's choices.
  const choice = videoRemakeChoiceOf(provider)
  if (!choice) return
  const err = new Error(
    `provider_not_supported: node "${nodeLabel}" cannot run on ${choice.flash ?? choice.engine}. ${videoRemakeChoiceName(choice)} is a Video Remake engine, run through POST ${VIDEO_REMAKE_RUN_ROUTE}; a Video to Video node takes its own models only.`,
  ) as Error & { code?: string }
  err.code = "provider_not_supported"
  throw err
}

function isRec(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}
