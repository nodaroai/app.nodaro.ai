// @test-watches backend/src/routes/**/*.ts backend/src/nodes/**/*.ts backend/src/ee/routes/**/*.ts backend/src/lib/keyed-batch-replay.ts
/**
 * A ROUTE THAT MAKES A KEYED BATCH ANSWERS ITS REPEAT BEFORE THE CREDIT GUARD.
 *
 * `runJobBatch` keys a batch's jobs `<key>:0..n-1`, but the credit guard's own
 * replay lookup asks for the bare key, so a repeat of a batch that was already
 * charged would run the balance check again and could answer 402 for jobs that
 * exist and are paid for. Every route that calls `runJobBatch` therefore
 * registers a replay preHandler — `keyedBatchReplay({ … jobType: "<type>" … })`
 * (lib/keyed-batch-replay.ts) or generate-image's `replayImageBatch` — and a
 * route's `jobType` must be the type its own jobs record, or the replay would
 * refuse (422) its own earlier jobs. A new batch route that forgets the
 * preHandler fails here, not in production.
 *
 * File-level, like the repo's other route-census guards: a file that calls
 * `runJobBatch` once and registers its replay once passes.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") out.push(...sourceFiles(full))
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full)
  }
  return out
}

/** Route files that call `runJobBatch` (the engine itself and its tests excluded). */
const BATCH_ROUTES = [...sourceFiles(join(SRC, "routes")), ...sourceFiles(join(SRC, "nodes")), ...sourceFiles(join(SRC, "ee", "routes"))]
  .map((file) => ({ file: relative(SRC, file), text: readFileSync(file, "utf8") }))
  .filter(({ text }) => /\brunJobBatch\(/.test(text))

describe("every route that makes a keyed batch registers its replay", () => {
  it("finds the batch routes (the census itself is not empty)", () => {
    expect(BATCH_ROUTES.map((r) => r.file).sort()).toEqual([
      "routes/generate-character.ts",
      "routes/generate-creature.ts",
      "routes/generate-image.ts",
      "routes/generate-location.ts",
      "routes/generate-object.ts",
      "routes/video-sfx.ts",
    ])
  })

  it.each(BATCH_ROUTES.map((r) => [r.file, r.text] as const))("%s registers a replay preHandler", (_file, text) => {
    // Inside a `preHandler` list, ahead of the credit guard.
    const registered =
      /preHandler:\s*\[[^\]]*\bkeyedBatchReplay\(\{[\s\S]*?\}\),[\s\S]*?creditGuard\(/.test(text) ||
      /preHandler:\s*\[[^\]]*\breplayImageBatch,[\s\S]*?creditGuard\(/.test(text)
    expect(registered).toBe(true)
  })

  it.each(BATCH_ROUTES.filter((r) => /\bkeyedBatchReplay\(\{/.test(r.text)).map((r) => [r.file, r.text] as const))(
    "%s: its replay's jobType is the type its own jobs record",
    (_file, text) => {
      const declared = [...text.matchAll(/\bkeyedBatchReplay\(\{[^}]*\bjobType:\s*"([^"]+)"/g)].map((m) => m[1]!)
      expect(declared.length).toBeGreaterThan(0)
      for (const type of declared) {
        // The same literal also names the job: buildJobInputData(…, "<type>") or `type: "<type>"`.
        const written = new RegExp(`buildJobInputData\\([^)]*"${type}"|\\btype:\\s*"${type}"`).test(text)
        expect(written, `${type} is declared as the replay's jobType but no job of the route is written with it`).toBe(true)
      }
    },
  )

  it("generate-image's replay refuses jobs of any other type", () => {
    const text = readFileSync(join(SRC, "lib", "image-batch-replay.ts"), "utf8")
    expect(text).toMatch(/IMAGE_JOB_TYPE = "generate-image"/)
    expect(readFileSync(join(SRC, "routes", "generate-image-plan.ts"), "utf8")).toMatch(/buildJobInputData\(data, "generate-image"\)/)
  })
})
