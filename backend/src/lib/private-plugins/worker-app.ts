import type { FastifyInstance } from "fastify"

/**
 * The Fastify app a worker-side handler reaches `/v1` routes through
 * (`tk.http.workerRequest`). The video worker process has none of its own, so
 * it builds the API app here — routes registered, `ready()`, never `listen()`
 * — the same way `src/video-director.ts` does. `buildApp` starts no crons.
 *
 * Built once, on the first call. The video worker makes that call at BOOT
 * when plugins loaded (`video-worker.ts`), so a `buildApp` config fault —
 * which exits the process — stops the worker before it takes a job instead of
 * killing jobs mid-run. (It does not fail the deploy: `supervise` in start.sh
 * restarts the worker in a crash-loop while `/health` stays green.)
 * The PROMISE is memoized (two concurrent first calls must not build two
 * apps); a failed build is forgotten, so a later call tries again.
 *
 * `app.js` is imported dynamically: `app.ts` → `load.ts` → `toolkit.ts`, so a
 * static import from this graph would be a cycle. Only `video-worker.ts`
 * imports this module; `toolkit.ts` receives it as a provider.
 */
let appPromise: Promise<FastifyInstance> | undefined

export function getWorkerApp(): Promise<FastifyInstance> {
  appPromise ??= import("../../app.js")
    .then(async ({ buildApp }) => {
      const app = await buildApp()
      await app.ready()
      return app
    })
    .catch((err: unknown) => {
      appPromise = undefined
      throw err
    })
  return appPromise
}
