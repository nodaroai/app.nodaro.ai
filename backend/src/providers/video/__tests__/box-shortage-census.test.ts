// @test-watches backend/src/**/*.ts
/**
 * EVERY LAUNCH RETRY READS THE KERNEL'S COUNT — a build-enforced invariant.
 *
 * `retryOnShortage` alone judges a shortage by what the program printed. The
 * launches that failed on 2026-11-25 printed "Error while opening encoder":
 * nothing in those words says the container had no thread left, so they were
 * failed as the input's fault, and the three tries the others got were over
 * in ten seconds of a shortage that lasted minutes. `retryOnBoxShortage`
 * (`box-shortage.ts`) is the same retry with the kernel's count of refusals
 * wired in. A runner written against the bare one would be back to the words
 * alone, silently. This scan fails the build instead.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, "..", "..", "..")

/** The retry's own file, and the one place that hands it the kernel's count. */
const MAY_NAME_THE_BARE_RETRY = new Set(["providers/video/ffmpeg-shortage-retry.ts", "providers/video/box-shortage.ts"])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

/** Whether `source` uses the bare retry: a call, or the name taken from its module. */
function namesBareRetry(source: string): boolean {
  return /\bretryOnShortage\b/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))
}

describe("box shortage census", () => {
  it("recognizes a use of the bare retry, and not a mention in a comment", () => {
    // Guards the matcher: a scan that found nothing would be a test that can never fail.
    expect(namesBareRetry(`import { retryOnShortage } from "./ffmpeg-shortage-retry.js"`)).toBe(true)
    expect(namesBareRetry(`return retryOnShortage((limitMs) => run(limitMs), { limitMs, label: "ffmpeg" })`)).toBe(true)
    expect(namesBareRetry(`// like retryOnShortage, but for uploads\n/** see retryOnShortage */\nexport const x = 1`)).toBe(false)
    expect(namesBareRetry(`return retryOnBoxShortage((limitMs) => run(limitMs), { limitMs, label: "ffmpeg" })`)).toBe(false)
  })

  it("every runner retries through the one that reads the kernel's count", () => {
    const bare: string[] = []
    const wired: string[] = []
    for (const file of walk(SRC_DIR)) {
      const where = relative(SRC_DIR, file)
      const source = readFileSync(file, "utf8")
      if (/\bretryOnBoxShortage\s*\(/.test(source) && where !== "providers/video/box-shortage.ts") wired.push(where)
      if (namesBareRetry(source) && !MAY_NAME_THE_BARE_RETRY.has(where)) bare.push(where)
    }
    expect(bare, "use retryOnBoxShortage (providers/video/box-shortage.ts): the bare retry cannot see a shortage the program did not name").toEqual([])
    // The runners known to launch programs today; a scan that lost them found nothing.
    expect(wired.sort()).toEqual(["providers/video/ffmpeg-cancellable.ts", "providers/video/ffmpeg-utils.ts", "providers/video/ytdlp-process.ts"])
  })
})
