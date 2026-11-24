// @test-watches backend/src/middleware/*.ts backend/src/lib/cast-swap-*.ts
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A Video Remake request's `engine` may name a Flash choice (Nodaro Prism Flash, Nodaro Pulse Flash): a hook or helper that applies
 * an engine's settings to a run must read the engine OF THE RUN (`castSwapEngineOfRun`), which reads a Flash choice
 * as its engine. `castSwapEngineFrom` reads it as no engine, so the run would silently miss its engine's settings.
 *
 * Only these may still call `castSwapEngineFrom`, each with its reason.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "middleware/nodaro-motion-engine.ts": "rewrites an ENGINE id to its internal id, after it has handled a Flash choice itself",
  "lib/cast-swap-engines.ts": "reads the engines an engine DECLARES, not a run's engine",
}

const SRC = join(__dirname, "..", "..")
const files = [
  ...readdirSync(join(SRC, "middleware")).filter((f) => f.endsWith(".ts")).map((f) => `middleware/${f}`),
  ...readdirSync(join(SRC, "lib")).filter((f) => /^cast-swap-.*\.ts$/.test(f)).map((f) => `lib/${f}`),
]

describe("Video Remake run-engine readers", () => {
  it("read a run's engine with castSwapEngineOfRun, never castSwapEngineFrom (a Flash choice is its engine's run)", () => {
    const offenders = files.filter((f) => !ALLOWED[f] && /\bcastSwapEngineFrom\(/.test(readFileSync(join(SRC, f), "utf8")))
    expect(offenders).toEqual([])
  })

  it("every allowance still names a file that calls it (held both ways)", () => {
    for (const f of Object.keys(ALLOWED)) expect(readFileSync(join(SRC, f), "utf8"), f).toMatch(/\bcastSwapEngineFrom\(/)
  })
})
