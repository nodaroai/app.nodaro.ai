/**
 * Whether a Nodaro Motion page shows its Advanced options, as clients read it
 * (Cloud: registered under `hasCredits()`, beside the trends routes). Public:
 * no credential is needed and none is read (middleware/auth.ts lists the
 * path), so a guest's page shows or hides them too.
 *
 *   GET /v1/cast-swap/advanced   { show: boolean }
 *
 * `show` = whether the page shows its Advanced options (Prepare references and
 * the pre-prompt); false until an admin turns them on. One answer for the
 * whole page, whatever the engine. Read from the admin's setting
 * (`nodaro_motion_advanced`, lib/nodaro-motion-advanced.ts) through the
 * settings cache (about 60 s), never the database per request. A settings
 * read that failed is answered `{ show: false }`, uncached (`no-store`).
 *
 * A page option only: a run and a quote take `prepareReferences` and
 * `prePrompt` exactly as sent, whatever this says.
 */
import type { FastifyInstance } from "fastify"
import { getAppSettings, settingsReadFailed } from "../../lib/app-settings.js"
import { advancedShown } from "../../lib/nodaro-motion-advanced.js"

/** How long a client (or a CDN) may keep the answer: about the settings cache's own life. */
export const ADVANCED_MAX_AGE_SECONDS = 60

export async function castSwapAdvancedRoutes(app: FastifyInstance) {
  app.get("/v1/cast-swap/advanced", async (req, reply) => {
    let settings: Awaited<ReturnType<typeof getAppSettings>> | null = null
    try {
      settings = await getAppSettings()
    } catch (e) {
      req.log.warn({ err: e }, "cast-swap advanced: the app settings could not be read")
    }
    if (!settings || settingsReadFailed(settings)) {
      return reply.header("Cache-Control", "no-store").send(advancedShown(null))
    }
    return reply
      .header("Cache-Control", `public, max-age=${ADVANCED_MAX_AGE_SECONDS}`)
      .send(advancedShown(settings.nodaro_motion_advanced))
  })
}
