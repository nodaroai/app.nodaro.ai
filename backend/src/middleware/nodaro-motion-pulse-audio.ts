import type { FastifyInstance, FastifyRequest } from "fastify"
import { castSwapEngineFrom } from "@nodaro/shared/models"
import { getAppSettings, settingsReadFailed } from "../lib/app-settings.js"
import { engineTakesPulseAudio, pulseAudioSent } from "../lib/cast-swap-pulse-audio.js"
import { internalSecretMatches } from "../lib/internal-caller.js"
import { firstHeaderValue } from "../lib/request-helpers.js"

/**
 * A DIRECT Nodaro Motion run or quote (`POST /v1/cast-swap`, `POST
 * /v1/cast-swap/estimate`, both served by the Cast Swap engine of the cloud
 * plugin) gets its Pulse audio from the admin's setting
 * (`nodaro_motion_pulse_audio`, lib/cast-swap-pulse-audio.ts), never from
 * the caller: any `pulseAudio` the body carries is dropped, and a Pulse run
 * is sent `pulseAudio: "generated"` only when the setting says so and the loaded
 * engine declares `castSwap.pulseAudio`. Otherwise the key is left out (the
 * original audio), so a run is sent exactly the body it was sent before the
 * setting. A settings read that failed reads as the original audio.
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

export function registerNodaroMotionPulseAudioHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    if (req.method !== "POST" || !ENGINE_ROUTES.has(req.routeOptions?.url ?? "")) return
    const body = req.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const rec = body as Record<string, unknown>
    if (isTrendRun(req, rec)) return
    const { pulseAudio: _sent, ...rest } = rec
    let added: { pulseAudio?: "generated" } = {}
    // The setting is read only for a Pulse run on an engine that takes it (a Prism run never needs it).
    if (castSwapEngineFrom(rest.engine) === "kling-4" && engineTakesPulseAudio()) {
      const settings = await getAppSettings()
      added = pulseAudioSent(rest.engine, settingsReadFailed(settings) ? null : settings.nodaro_motion_pulse_audio)
    }
    const next = { ...rest, ...added }
    // Untouched unless something changes: a body without the key keeps its own object.
    if ("pulseAudio" in rec || "pulseAudio" in next) req.body = next
  })
}
