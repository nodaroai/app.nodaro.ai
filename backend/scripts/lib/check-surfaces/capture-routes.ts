/**
 * Child-process entry for `check:surfaces --runtime`: boot the app as the
 * edition this process was started as and write every route it registers.
 *
 *   capture-routes.ts <out.json>
 *
 * Spawned by runtime-routes.ts with the whole environment set (see
 * tool-surface.ts captureEnv for why it is hermetic). Not run by hand.
 */
import { writeFileSync } from "node:fs"
import { register } from "node:module"

const outPath = process.argv[2]
if (!outPath) {
  console.error("capture-routes.ts <out.json>")
  process.exit(2)
}

const routes: Array<{ method: string; url: string }> = []
;(globalThis as { __checkSurfacesRoutes?: typeof routes }).__checkSurfacesRoutes = routes
// Every Fastify instance the app creates gets the onRoute collector: a bare
// `fastify` import anywhere but in the shim resolves to the shim.
const shim = new URL("./fastify-route-log.mjs", import.meta.url).href
// registerHooks (Node 22.15+) runs in this thread; register() is the older,
// off-thread form for earlier releases.
const nodeModule = (await import("node:module")) as unknown as {
  registerHooks?: (hooks: {
    resolve: (specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => unknown) => unknown
  }) => void
}
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    resolve: (specifier, context, next) =>
      specifier === "fastify" && context.parentURL !== shim ? { url: shim, shortCircuit: true } : next(specifier, context),
  })
} else {
  register("./fastify-route-loader.mjs", import.meta.url, { data: { shim } })
}

const { buildApp } = await import("../../../src/app.js")
const app = await buildApp()
await app.ready()
writeFileSync(outPath, JSON.stringify(routes))
// The app holds Redis and timers open; the capture is done.
process.exit(0)
