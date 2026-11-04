/**
 * Nodaro Motion's Style choice, as clients read it (Cloud: registered under
 * `hasCredits()`, beside the trends routes). Public: no credential is needed
 * and none is read (middleware/auth.ts lists the path), so a guest's page
 * hides its Style control too.
 *
 *   GET /v1/cast-swap/style-choice   { engines: { "motion-prism": Choice, "motion-pulse": Choice },
 *                                      styleOnly: { "motion-prism": boolean, "motion-pulse": boolean } }
 *
 * `Choice = "user" | "precise" | "flex"`: `"user"` = people choose a direct
 * run's style (Precise or Flex) as before; `"precise"` / `"flex"` = every
 * direct run and quote of that engine runs in that style whatever the
 * request's `style` says, so a client shows no Style control for it. Read
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
 * reference) is accepted there: Nodaro Motion Prism while this environment's
 * engine declares `castSwap.styleOnly`, Nodaro Motion Pulse never (it takes
 * no art style). It follows the engine alone, never the settings, so every
 * answer carries it, the failed-read one included. A client reading a server
 * from before it finds no `styleOnly` and treats every engine as false.
 */
import type { FastifyInstance } from "fastify"
import type { NodaroMotionEngine } from "@nodaro/shared/models"
import { getAppSettings, settingsReadFailed } from "../../lib/app-settings.js"
import { engineTakesStyleChoice, styleChoices } from "../../lib/nodaro-motion-style.js"
import { engineTakesStyleOnly } from "../../lib/nodaro-motion-style-only.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"

/** How long a client (or a CDN) may keep the answer: about the settings cache's own life. */
export const STYLE_CHOICE_MAX_AGE_SECONDS = 60

/** Whether each engine takes a style-only run: Prism as its engine declares, Pulse never (no art style). A new object. */
function styleOnlyEngines(castSwap: Parameters<typeof engineTakesStyleOnly>[0]): Record<NodaroMotionEngine, boolean> {
  return { "motion-prism": engineTakesStyleOnly(castSwap), "motion-pulse": false }
}

export async function castSwapStyleChoiceRoutes(app: FastifyInstance) {
  app.get("/v1/cast-swap/style-choice", async (req, reply) => {
    const castSwap = getPluginSupports().castSwap
    const styleOnly = styleOnlyEngines(castSwap)
    if (!engineTakesStyleChoice(castSwap)) {
      return reply
        .header("Cache-Control", `public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
        .send({ engines: styleChoices(null), styleOnly })
    }
    let settings: Awaited<ReturnType<typeof getAppSettings>> | null = null
    try {
      settings = await getAppSettings()
    } catch (e) {
      req.log.warn({ err: e }, "cast-swap style-choice: the app settings could not be read")
    }
    if (!settings || settingsReadFailed(settings)) {
      return reply.header("Cache-Control", "no-store").send({ engines: styleChoices(null), styleOnly })
    }
    return reply
      .header("Cache-Control", `public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
      .send({ engines: styleChoices(settings.nodaro_motion_style), styleOnly })
  })
}
