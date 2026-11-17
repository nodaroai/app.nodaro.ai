/**
 * Video Remake's Style choice, as clients read it (Cloud: registered under
 * `hasCredits()`, beside the trends routes). Public: no credential is needed
 * and none is read (middleware/auth.ts lists the path), so a guest's page
 * hides its Style control too.
 *
 *   GET /v1/video-remake/style-choice   { engines: { "nodaro-prism": Choice, "nodaro-pulse": Choice },
 *                                      styleOnly: { "nodaro-prism": boolean, "nodaro-pulse": boolean },
 *                                      preciseArtStyle: { "nodaro-prism": boolean, "nodaro-pulse": boolean },
 *                                      preciseArtStyleAlone: { "nodaro-prism": boolean, "nodaro-pulse": boolean } }
 *
 * TRANSITION SHIM (the 2026-11-17 engine ids): each map also answers every
 * engine under its previous id (`"motion-prism"`, `"motion-pulse"`), the same
 * value, for a client built before (`withPreviousEngineIds`). Remove once no
 * client reads those keys.
 *
 * `Choice = "user" | "precise" | "flex"`: `"user"` = people choose a direct
 * run's style (Precise or Flex) as before; `"flex"` = every direct run and
 * quote of that engine runs Flex whatever the request's `style` says;
 * `"precise"` = a client runs Precise, and the engine (from plugin 0.456.0)
 * makes a request that asks for Flex a Flex run. Either way a client shows no
 * Style control for it. Read
 * from the admin's setting (`nodaro_motion_style`, lib/nodaro-motion-style.ts)
 * through the settings cache (about 60 s), never the database per request.
 *
 * Every engine is answered `"user"` when this environment's Cast Swap engine
 * does not enforce the setting (`castSwap.styleChoice`): it would take the
 * request's `style`, so the control must stay. A settings read that failed is
 * answered the same way, uncached (`no-store`), keeping the answer's shape.
 * A trend run keeps its own trend's style whatever this says.
 *
 * `styleOnly` says, per engine, whether a direct style-only run (a Flex run
 * with an art style and nothing to swap: no role with pictures, no fixed
 * reference) is accepted there: Nodaro Prism while this environment's
 * engine declares `castSwap.styleOnly`, Nodaro Pulse never (it takes
 * no art style). It follows the engine alone, never the settings, so every
 * answer carries it, the failed-read one included. A client reading a server
 * from before it finds no `styleOnly` and treats every engine as false.
 *
 * `preciseArtStyle` says, per engine, whether a direct Precise run takes an
 * art style there (as a Flex run does): Nodaro Prism while this
 * environment's engine declares `castSwap.preciseArtStyle`, Nodaro
 * Pulse never (it takes no art style). Like `styleOnly` it follows the engine
 * alone and is in every answer; a client reading a server from before it
 * finds none and offers an art style on Flex alone. The request is taken either
 * way: while the admin's Precise art-style route is on (lib/nodaro-motion-precise-style-route.ts)
 * the engine runs it as Flex, which this does not say and the estimate shows.
 *
 * `preciseArtStyleAlone` says, per engine, whether an art style alone is a
 * direct Precise run's change there, so the run needs no role, reference or
 * prompt: Nodaro Prism while this environment's engine declares
 * `castSwap.preciseArtStyleAlone`, Nodaro Pulse never (it takes no art
 * style). It too follows the engine alone and is in every answer; a client
 * reading a server from before it finds none and treats every engine as false.
 * Such a request may run as Flex all the same: while the admin's Precise
 * art-style route is on the engine runs it as Flex, which this does not say and
 * the estimate shows.
 */
import type { FastifyInstance, RouteHandlerMethod } from "fastify"
import { NODARO_MOTION_ENGINES, NODARO_MOTION_LEGACY_ENGINE_OF, type NodaroMotionEngine } from "@nodaro/shared/models"
import { getAppSettings, settingsReadFailed } from "../../lib/app-settings.js"
import { engineTakesStyleChoice, styleChoices } from "../../lib/nodaro-motion-style.js"
import { engineTakesStyleOnly } from "../../lib/nodaro-motion-style-only.js"
import { engineTakesPreciseArtStyle, engineTakesPreciseArtStyleAlone } from "../../lib/nodaro-motion-precise-art-style.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"

/** How long a client (or a CDN) may keep the answer: about the settings cache's own life. */
export const STYLE_CHOICE_MAX_AGE_SECONDS = 60

/** Whether each engine takes a style-only run: Prism as its engine declares, Pulse never (no art style). A new object. */
function styleOnlyEngines(castSwap: Parameters<typeof engineTakesStyleOnly>[0]): Record<NodaroMotionEngine, boolean> {
  return { "nodaro-prism": engineTakesStyleOnly(castSwap), "nodaro-pulse": false }
}

/** Whether each engine takes an art style on a Precise run: Prism as its engine declares, Pulse never (no art style). A new object. */
function preciseArtStyleEngines(castSwap: Parameters<typeof engineTakesPreciseArtStyle>[0]): Record<NodaroMotionEngine, boolean> {
  return { "nodaro-prism": engineTakesPreciseArtStyle(castSwap), "nodaro-pulse": false }
}

/** Whether an art style alone is a Precise run's change on each engine: Prism as its engine declares, Pulse never (no art style). A new object. */
function preciseArtStyleAloneEngines(castSwap: Parameters<typeof engineTakesPreciseArtStyleAlone>[0]): Record<NodaroMotionEngine, boolean> {
  return { "nodaro-prism": engineTakesPreciseArtStyleAlone(castSwap), "nodaro-pulse": false }
}

type PreviousEngineId = (typeof NODARO_MOTION_LEGACY_ENGINE_OF)[NodaroMotionEngine]

/** A map by engine with each value also under the engine's previous id (a new object). */
export function withPreviousEngineIds<T>(byEngine: Record<NodaroMotionEngine, T>): Record<NodaroMotionEngine | PreviousEngineId, T> {
  const out = { ...byEngine } as Record<NodaroMotionEngine | PreviousEngineId, T>
  for (const engine of NODARO_MOTION_ENGINES) out[NODARO_MOTION_LEGACY_ENGINE_OF[engine]] = byEngine[engine]
  return out
}

/** The answer: every map with the previous ids beside the current ones. */
function answer(engines: Record<NodaroMotionEngine, unknown>, maps: Record<"styleOnly" | "preciseArtStyle" | "preciseArtStyleAlone", Record<NodaroMotionEngine, boolean>>) {
  return {
    engines: withPreviousEngineIds(engines),
    styleOnly: withPreviousEngineIds(maps.styleOnly),
    preciseArtStyle: withPreviousEngineIds(maps.preciseArtStyle),
    preciseArtStyleAlone: withPreviousEngineIds(maps.preciseArtStyleAlone),
  }
}

export async function castSwapStyleChoiceRoutes(app: FastifyInstance) {
  // Both prefixes, each written out so the route scans read them (lib/video-remake-paths.ts).
  app.get("/v1/video-remake/style-choice", styleChoiceHandler)
  app.get("/v1/cast-swap/style-choice", styleChoiceHandler)
}

const styleChoiceHandler: RouteHandlerMethod = async (req, reply) => {
  const castSwap = getPluginSupports().castSwap
  const styleOnly = styleOnlyEngines(castSwap)
  const preciseArtStyle = preciseArtStyleEngines(castSwap)
  const preciseArtStyleAlone = preciseArtStyleAloneEngines(castSwap)
  if (!engineTakesStyleChoice(castSwap)) {
    return reply
      .header("Cache-Control", `public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
      .send(answer(styleChoices(null), { styleOnly, preciseArtStyle, preciseArtStyleAlone }))
  }
  let settings: Awaited<ReturnType<typeof getAppSettings>> | null = null
  try {
    settings = await getAppSettings()
  } catch (e) {
    req.log.warn({ err: e }, "cast-swap style-choice: the app settings could not be read")
  }
  if (!settings || settingsReadFailed(settings)) {
    return reply.header("Cache-Control", "no-store").send(answer(styleChoices(null), { styleOnly, preciseArtStyle, preciseArtStyleAlone }))
  }
  return reply
    .header("Cache-Control", `public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
    .send(answer(styleChoices(settings.nodaro_motion_style), { styleOnly, preciseArtStyle, preciseArtStyleAlone }))
}
