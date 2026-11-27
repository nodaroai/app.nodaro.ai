// @test-watches backend/src/**/*.ts
/**
 * EVERY RENDER IS TOLD ITS TABS AND ITS ENCODER'S THREADS — a build-enforced invariant.
 *
 * The renderer sizes both by the cores it can see: half of them as browser
 * tabs (up to 8) and an encoder with a thread and a half per core. Every tab
 * and every thread counts toward the one limit a container has on processes
 * and threads, and on 2026-11-25 two renders left to themselves used all of it
 * (`render-shortage.ts`). A `renderMedia` call written without the two
 * arguments would run that way again, silently, until the next busy hour.
 * This scan fails the build instead.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

/** The argument text of every `renderMedia({ … })` call in `source`: from its opening brace to the matching one. */
function renderMediaCalls(source: string): string[] {
  const calls: string[] = []
  for (const m of source.matchAll(/\brenderMedia\s*\(\s*\{/g)) {
    let depth = 0
    for (let k = m.index + m[0].length - 1; k < source.length; k++) {
      if (source[k] === "{") depth += 1
      else if (source[k] === "}" && --depth === 0) {
        calls.push(source.slice(m.index, k + 1))
        break
      }
    }
  }
  return calls
}

describe("render thread caps census", () => {
  it("recognizes a render call and what it was given", () => {
    // Guards the matcher: a scan that found nothing would be a test that can never fail.
    const sample = `await renderMedia({ serveUrl, codec: "h264", onProgress: ({ progress }) => { void p(progress) } })\nconst x = 1`
    expect(renderMediaCalls(sample)).toEqual([`renderMedia({ serveUrl, codec: "h264", onProgress: ({ progress }) => { void p(progress) } }`])
  })

  it("every renderMedia call states its tabs and passes the encoder's thread counts", () => {
    const found: string[] = []
    const missing: string[] = []
    for (const file of walk(SRC_DIR)) {
      const source = readFileSync(file, "utf8")
      for (const call of renderMediaCalls(source)) {
        const where = relative(SRC_DIR, file)
        found.push(where)
        // The tabs: computed in the call, or just above it into the variable the call passes.
        if (!/\bconcurrency\s*:/.test(call) || !/\bremotionConcurrencyFor\s*\(/.test(source)) missing.push(`${where}: no tab count from remotionConcurrencyFor`)
        if (!/\bffmpegOverride\s*:\s*renderFfmpegArgs\b/.test(call)) missing.push(`${where}: no ffmpegOverride: renderFfmpegArgs`)
      }
    }
    expect(missing).toEqual([])
    // Both render paths were seen: the render worker and a 3D scene's child render.
    expect([...new Set(found)].sort()).toEqual(["workers/render-worker.ts", "workers/scene3d-render-child.ts"])
  })
})
