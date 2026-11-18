import type { FastifyInstance, FastifyRequest } from "fastify"
import { getAppSettings, settingsReadFailed } from "../lib/app-settings.js"
import {
  engineTakesPulseReferenceAudio,
  isPulseRun,
  pulseAudioOutOf,
  pulseReferenceAudioSent,
  type CastSwapPulseReferenceAudio,
} from "../lib/cast-swap-pulse-reference-audio.js"
import { internalSecretMatches } from "../lib/internal-caller.js"
import { firstHeaderValue } from "../lib/request-helpers.js"
import { castSwapSpelling } from "../lib/video-remake-paths.js"

/**
 * A DIRECT Video Remake run or quote (`POST /v1/video-remake`, `POST
 * /v1/video-remake/estimate`, or the same under `/v1/cast-swap`, all served by
 * the Cast Swap engine of the cloud plugin) gets its Pulse reference audio
 * ("audio in") from the admin's setting (`nodaro_motion_pulse_reference_audio`,
 * lib/cast-swap-pulse-reference-audio.ts), never from the caller: any
 * `pulseReferenceAudio` the body carries is dropped, and a Pulse run on an
 * engine declaring `castSwap.pulseReferenceAudio` is sent the setting's
 * resolutions off the default of the run's audio out (`pulseReferenceAudioSent`).
 * The audio out is the body's `pulseAudio` as the Pulse audio hook left it
 * (middleware/nodaro-motion-pulse-audio.ts), so this hook is registered AFTER
 * that one (app.ts). Whatever reads as the default leaves the key out, so a run
 * is sent exactly the body it was sent before the setting. A settings read that
 * failed reads as the default. The run and its quote go through the same hook,
 * so the quote prices what the run sends (the vocals split is priced in).
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

export function registerNodaroMotionPulseReferenceAudioHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    if (req.method !== "POST" || !ENGINE_ROUTES.has(castSwapSpelling(req.routeOptions?.url ?? ""))) return
    const body = req.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const rec = body as Record<string, unknown>
    if (isTrendRun(req, rec)) return
    const { pulseReferenceAudio: _sent, ...rest } = rec
    let added: { pulseReferenceAudio?: CastSwapPulseReferenceAudio } = {}
    // The setting is read only for a Pulse run on an engine that takes it (a Prism run never needs it).
    if (isPulseRun(rest.engine) && engineTakesPulseReferenceAudio()) {
      const settings = await getAppSettings()
      const stored = settingsReadFailed(settings) ? null : settings.nodaro_motion_pulse_reference_audio
      added = pulseReferenceAudioSent(rest, stored, pulseAudioOutOf(rest.pulseAudio))
    }
    const next = { ...rest, ...added }
    // Untouched unless something changes: a body without the key keeps its own object.
    if ("pulseReferenceAudio" in rec || "pulseReferenceAudio" in next) req.body = next
  })
}
