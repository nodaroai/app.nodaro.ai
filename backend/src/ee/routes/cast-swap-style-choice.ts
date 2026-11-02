/**
 * Nodaro Motion's Style choice, as clients read it (Cloud: registered under
 * `hasCredits()`, beside the trends routes). Public: no credential is needed
 * and none is read (middleware/auth.ts lists the path), so a guest's page
 * hides its Style control too.
 *
 *   GET /v1/cast-swap/style-choice   { engines: { "motion-prism": Choice, "motion-pulse": Choice } }
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
 */
import type { FastifyInstance } from "fastify"
import { getAppSettings, settingsReadFailed } from "../../lib/app-settings.js"
import { engineTakesStyleChoice, styleChoices } from "../../lib/nodaro-motion-style.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"

/** How long a client (or a CDN) may keep the answer: about the settings cache's own life. */
export const STYLE_CHOICE_MAX_AGE_SECONDS = 60

export async function castSwapStyleChoiceRoutes(app: FastifyInstance) {
  app.get("/v1/cast-swap/style-choice", async (req, reply) => {
    if (!engineTakesStyleChoice(getPluginSupports().castSwap)) {
      return reply.header("Cache-Control", `public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`).send({ engines: styleChoices(null) })
    }
    let settings: Awaited<ReturnType<typeof getAppSettings>> | null = null
    try {
      settings = await getAppSettings()
    } catch (e) {
      req.log.warn({ err: e }, "cast-swap style-choice: the app settings could not be read")
    }
    if (!settings || settingsReadFailed(settings)) {
      return reply.header("Cache-Control", "no-store").send({ engines: styleChoices(null) })
    }
    return reply
      .header("Cache-Control", `public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
      .send({ engines: styleChoices(settings.nodaro_motion_style) })
  })
}
