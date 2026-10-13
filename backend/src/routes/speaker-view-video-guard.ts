import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
  preValidationHookHandler,
} from "fastify"
import { speakerViewVideoModeLive } from "@nodaro/render-rules"
import { measureClip, peekClip, type MeasuredClip } from "../lib/clip-measure.js"
import { clipMeasureStartLimiter } from "../lib/clip-measure-limit.js"
import { getSizeLimit } from "../utils/file-validation.js"
import {
  speakerViewVideoFinish,
  speakerViewVideoPrecheck,
  type SpeakerViewVideoBodyDeps,
  type SpeakerViewVideoPending,
} from "../lib/speaker-view-video-body.js"

/**
 * `POST /v1/speaker-view` accepts a `videoUrl` instead of an `edl` (decided
 * 2026-10-11). The route has two owners — the cloud plugin on nodaro.ai and
 * the relay shim on a self-host — and the plugin's contract (`edl`) is
 * unchanged, so the guard is not written into either handler: an `onRoute`
 * hook on the root attaches it to whichever `POST /v1/speaker-view` is
 * registered, exactly as the Edit Plan mode guard does.
 *
 * Two hooks, because the clip measurement downloads a file and auth is a
 * `preHandler` hook (middleware/auth.ts), which runs AFTER every
 * `preValidation` hook:
 *  - `preValidation` (first): the checks that cost nothing — one input, the
 *    price gate, the address, the transcript. The route's schema requires an
 *    `edl`, so a passing body goes on carrying the idle one-clip edit; nothing
 *    is downloaded and an unauthenticated caller learns nothing about any URL.
 *  - `preHandler` (first of the route's own, so after the global auth, orgs and
 *    billing hooks and BEFORE the route's credit guard, which prices the edit
 *    it reads): the one measurement, then the real edit, replacing the idle one,
 *    or the clip's own refusal (source not wider, unreadable, no speakers).
 *
 * Call it before any route is registered: an `onRoute` hook sees only the
 * routes registered after it.
 */

const SPEAKER_VIEW_PATH = "/v1/speaker-view"

/**
 * What the measuring phase is bounded by (decided 2026-10-12, R3 applied to this
 * entry too): the SAME per-user limit on starting a measurement that `POST
 * /v1/media/clip-length` applies (one shared counter, so the two doors cannot
 * add up to twice the allowance), and the plan's upload size limit on the
 * download. An address already measured is answered from the cache and costs
 * neither.
 */
export interface SpeakerViewVideoGuardDeps extends SpeakerViewVideoBodyDeps {
  /** The cached measurement for an address, never downloading. */
  readonly peek?: (url: string) => Promise<MeasuredClip | null>
  /** The per-user limit on STARTING a measurement; replies itself (429) when over. */
  readonly startLimit?: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  /** The most the download may write. */
  readonly maxBytes?: number
}

const guardLimit = clipMeasureStartLimiter()

const defaultDeps = (): SpeakerViewVideoGuardDeps => ({
  videoModeLive: speakerViewVideoModeLive(),
  measure: (url, opts) => measureClip(url, undefined, opts),
  peek: (url) => peekClip(url),
  startLimit: guardLimit,
  maxBytes: getSizeLimit("video"),
})

const list = <T>(h: T | T[] | undefined): T[] => (h ? (Array.isArray(h) ? [...h] : [h]) : [])

export function registerSpeakerViewVideoGuard(app: FastifyInstance, deps: () => SpeakerViewVideoGuardDeps = defaultDeps): void {
  // What the cheap phase left for the measuring phase, per request.
  const pendingByRequest = new WeakMap<FastifyRequest, SpeakerViewVideoPending>()

  const precheck = async function precheckHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const verdict = speakerViewVideoPrecheck(req.body, deps())
    if (verdict.kind === "refuse") {
      return reply.status(verdict.status).send({ error: { code: verdict.code, message: verdict.message } })
    }
    if (verdict.kind === "defer") {
      pendingByRequest.set(req, verdict.pending)
      req.body = verdict.body
    }
  } as preValidationHookHandler

  const finish = async function measureHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const pending = pendingByRequest.get(req)
    if (!pending) return
    pendingByRequest.delete(req)
    const d = deps()
    // A start costs a download and a demux: limited per user. A cached address does not.
    if (d.startLimit && !(d.peek && (await d.peek(pending.url).catch(() => null)))) {
      await d.startLimit(req, reply)
      if (reply.sent) return reply
    }
    const done = await speakerViewVideoFinish(pending, d.measure, d.maxBytes !== undefined ? { maxBytes: d.maxBytes } : undefined)
    if (done.kind === "refuse") {
      return reply.status(done.status).send({ error: { code: done.code, message: done.message } })
    }
    req.body = { ...(req.body as Record<string, unknown>), edl: done.edl }
  } as preHandlerHookHandler

  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    if (route.url !== SPEAKER_VIEW_PATH || !methods.includes("POST")) return
    route.preValidation = [precheck, ...list(route.preValidation)]
    route.preHandler = [finish, ...list(route.preHandler)]
  })
}
