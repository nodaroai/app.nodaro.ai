import type { FastifyInstance, FastifyRequest } from "fastify"
import { getAppSettings, settingsReadFailed } from "../lib/app-settings.js"
import {
  engineTakesPrismReferenceAudio,
  isPrismRun,
  prismReferenceAudioSent,
  type CastSwapPrismReferenceAudioSent,
} from "../lib/cast-swap-prism-reference-audio.js"
import { internalSecretMatches } from "../lib/internal-caller.js"
import { firstHeaderValue } from "../lib/request-helpers.js"

/**
 * A DIRECT Nodaro Motion run or quote (`POST /v1/cast-swap`, `POST
 * /v1/cast-swap/estimate`, both served by the Cast Swap engine of the cloud
 * plugin) gets its Prism reference audio from the admin's setting
 * (`nodaro_motion_prism_reference_audio`,
 * lib/cast-swap-prism-reference-audio.ts), never from the caller: any
 * `prismReferenceAudio` the body carries is dropped, and a Prism run (one
 * naming Prism, or no engine at all) is sent the setting as the loaded engine
 * takes it (`prismReferenceAudioSent`): its non-"full" resolutions as an
 * object to an engine declaring `castSwap.prismReferenceAudioPerResolution`,
 * or the mode of the run's own resolution (a draft is 480p) to one declaring
 * only `castSwap.prismReferenceAudio`. Whatever reads as the full audio leaves
 * the key out, so a run is sent exactly the body it was sent before the
 * setting. A settings read that failed reads as the full audio. The run and its quote go
 * through the same hook, so the quote prices what the run sends (the voice
 * split is priced in).
 *
 * A trend run is left as it is: its body is the platform's own composition
 * (`composeTrendRun`, which sends the trend's own choice). It is told by its
 * `trendRun` key on an INTERNAL request (the orchestrator secret matches);
 * `trendRun` on any other request is a direct run here. Checked against the
 * secret directly: this runs before the auth hook (preValidation), as the
 * engine id rewrite does (nodaro-motion-engine.ts).
 */
const ENGINE_ROUTES: ReadonlySet<string> = new Set(["/v1/cast-swap", "/v1/cast-swap/estimate"])

function isTrendRun(req: FastifyRequest, body: Record<string, unknown>): boolean {
  return body.trendRun !== undefined && internalSecretMatches(firstHeaderValue(req.headers["x-internal-orchestrator-secret"]))
}

export function registerNodaroMotionPrismReferenceAudioHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    if (req.method !== "POST" || !ENGINE_ROUTES.has(req.routeOptions?.url ?? "")) return
    const body = req.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const rec = body as Record<string, unknown>
    if (isTrendRun(req, rec)) return
    const { prismReferenceAudio: _sent, ...rest } = rec
    let added: { prismReferenceAudio?: CastSwapPrismReferenceAudioSent } = {}
    // The setting is read only for a Prism run on an engine that takes it (a Pulse run never needs it).
    if (isPrismRun(rest.engine) && engineTakesPrismReferenceAudio()) {
      const settings = await getAppSettings()
      added = prismReferenceAudioSent(rest, settingsReadFailed(settings) ? null : settings.nodaro_motion_prism_reference_audio)
    }
    const next = { ...rest, ...added }
    // Untouched unless something changes: a body without the key keeps its own object.
    if ("prismReferenceAudio" in rec || "prismReferenceAudio" in next) req.body = next
  })
}
