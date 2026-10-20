// @test-watches backend/src/workers/video-worker.ts
// The worker builds the app `tk.http.workerRequest` reaches AT BOOT, not on a
// handler's first call: `buildApp` exits the process on a config fault
// (surface profile, payer, a plugin load failure), and mid-job that would kill
// every concurrent job on the replica. At boot it exits the worker before it
// takes a job — not a failed deploy: start.sh's `supervise` restarts it in a
// crash-loop while `/health` (server.js) stays green.
// Only when plugins actually loaded (cloud) — the transport serves nothing
// else, so community and other no-plugin editions never build it.
// The memo and the provider are pinned by
// lib/private-plugins/__tests__/worker-request.test.ts; this pins the wiring.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const src = readFileSync(resolve(__dirname, "../video-worker.ts"), "utf8")
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("video-worker warms the worker app at boot", () => {
  it("awaits getWorkerApp() at top level after the plugins load, gated on plugins having loaded, before the queue worker exists", () => {
    expect(code).toMatch(/const \{[^}]*\bloaded: loadedPrivatePlugins\b[^}]*\} = await loadPrivatePlugins\(\{ workerApp: getWorkerApp \}\)/)
    expect(code).toMatch(/^if \(loadedPrivatePlugins\.length > 0\) await getWorkerApp\(\)$/m)
    // No catch: a failed build must reject the module and exit the process at boot.
    expect(code).not.toMatch(/getWorkerApp\(\)\s*\.catch/)

    const load = code.indexOf("await loadPrivatePlugins(")
    const warm = code.indexOf("await getWorkerApp()")
    const consume = code.indexOf("export function createVideoWorker")
    expect(load).toBeGreaterThanOrEqual(0)
    expect(warm).toBeGreaterThan(load)
    expect(consume).toBeGreaterThan(warm)
    expect(code.indexOf("await getWorkerApp()", warm + 1)).toBe(-1)
  })
})
