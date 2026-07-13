import { promises as fs } from "node:fs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { ensureFixtures, type FixtureSet } from "./fixtures.js"
import { ffmpegVersionString, measureAudio, measureImage, measureVideo, type Metrics } from "./measure.js"
import { compareMetrics } from "./compare.js"
import { OPERATIONS, type RenderedOutput } from "./operations.js"
import {
  DEFAULT_GOLDEN_FILE,
  goldenFileNameForVersion,
  loadGolden,
  saveGolden,
  type GoldenFile,
  type GoldenOutput,
} from "./golden.js"

/**
 * ffmpeg OUTPUT characterization — the safety net this repo's other ffmpeg
 * tests cannot be: they assert the argument strings we pass INTO ffmpeg,
 * which stays green through a 6 dB rendered-output change (that exact
 * incident: afir's intrinsic gain is ×2 on ffmpeg 5.1 and ×1 on ffmpeg 8).
 * This suite renders synthetic fixtures through every real operation and
 * asserts measured properties of the DECODED result against committed golden
 * values.
 *
 * OPT-IN BY DESIGN — `.char.ts` is outside the default `*.test.ts` glob and
 * only vitest.characterize.config.ts collects it. It must NEVER join the
 * default suite: `npm test` runs on bare GitHub runners and dev laptops,
 * whose ffmpeg is NOT production's binary, and a harness that fails
 * everywhere except production's image teaches everyone to ignore it within
 * a week. Run it via:
 *
 *     backend/scripts/characterize-in-image.sh check   # or bless / report
 *
 * which executes it inside node:22-slim with the apt-pinned production
 * ffmpeg — the same binary the Dockerfile installs. The version guard below
 * enforces this: a check run against any other binary fails immediately.
 *
 * NETWORK: none. The production functions take URLs, but their download
 * layer (`safeFetch`) hard-rejects loopback by design — so instead of
 * serving fixtures over HTTP (or, worse, punching a test hole in the SSRF
 * guard), the suite partial-mocks ONLY `downloadFile` to copy local lavfi
 * fixtures to the destination the module chose. Everything else in
 * ffmpeg-utils — runFfmpeg, runFfprobe, work dirs, the concurrency
 * semaphore — is the real implementation.
 */
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string, dest: string): Promise<void> => {
      const { fixtureLocalPath } = await import("./fixtures.js")
      const { promises: fsp } = await import("node:fs")
      await fsp.copyFile(fixtureLocalPath(url), dest)
    },
  }
})

const MODE: "bless" | "check" = process.env.CHARACTERIZE_MODE === "bless" ? "bless" : "check"
const GOLDEN_OVERRIDE = process.env.CHARACTERIZE_GOLDEN

let fixtures: FixtureSet
let golden: GoldenFile | null = null
let measuredVersion = ""
const blessed: Record<string, GoldenOutput[]> = {}

async function measureOutput(output: RenderedOutput): Promise<Metrics> {
  if (output.kind === "audio") {
    const metrics = await measureAudio(output.path)
    if (!metrics) throw new Error(`expected an audio stream in ${output.path}`)
    return metrics
  }
  if (output.kind === "video") return measureVideo(output.path)
  return measureImage(output.path)
}

beforeAll(async () => {
  fixtures = await ensureFixtures()
  measuredVersion = await ffmpegVersionString()

  if (MODE === "check") {
    golden = await loadGolden(GOLDEN_OVERRIDE ?? DEFAULT_GOLDEN_FILE)
    if (golden.ffmpegVersion !== measuredVersion) {
      throw new Error(
        `characterization version guard: this run's ffmpeg is "${measuredVersion}" but the golden ` +
          `values were blessed against "${golden.ffmpegVersion}".\n` +
          `Comparing outputs of two different binaries is exactly the mistake this harness exists ` +
          `to catch (Homebrew ffmpeg on a laptop, the bare GitHub runner's ffmpeg — neither is ` +
          `production). Run inside the production image:\n` +
          `    backend/scripts/characterize-in-image.sh check\n` +
          `If you are DELIBERATELY upgrading ffmpeg: bless a new golden under the new binary, ` +
          `review the report diff, and update the Dockerfile pin + DEFAULT_GOLDEN_FILE together.`,
      )
    }
  }
})

describe("ffmpeg output characterization", () => {
  for (const op of OPERATIONS) {
    it(op.name, async () => {
      const result = await op.run(fixtures)
      try {
        const outputs: GoldenOutput[] = []
        for (const output of result.outputs) {
          outputs.push({ label: output.label, metrics: await measureOutput(output) })
        }

        if (MODE === "bless") {
          blessed[op.name] = outputs
          return
        }

        const expected = golden?.operations[op.name]
        expect(
          expected,
          `operation "${op.name}" is missing from the golden file — re-bless inside the production image`,
        ).toBeDefined()

        const failures: string[] = []
        if (expected!.length !== outputs.length) {
          failures.push(
            `output count: golden ${expected!.length} vs actual ${outputs.length} ` +
              `(labels golden=[${expected!.map((o) => o.label).join(",")}] actual=[${outputs.map((o) => o.label).join(",")}])`,
          )
        } else {
          for (let i = 0; i < outputs.length; i++) {
            const diffs = compareMetrics(expected![i].metrics, outputs[i].metrics, op.tolerances)
            failures.push(...diffs.map((d) => `[${outputs[i].label}] ${d}`))
          }
        }
        expect(failures, `"${op.name}" drifted from golden (${golden!.ffmpegVersion})`).toEqual([])
      } finally {
        for (const dir of result.cleanupDirs) {
          await fs.rm(dir, { recursive: true, force: true })
        }
      }
    })
  }
})

afterAll(async () => {
  if (MODE !== "bless") return
  // A partial golden is worse than none — it would silently drop coverage
  // for every op that failed to render. Refuse to write one.
  const missing = OPERATIONS.filter((op) => !(op.name in blessed)).map((op) => op.name)
  if (missing.length > 0) {
    throw new Error(
      `bless aborted — ${missing.length} operation(s) failed to render, golden NOT written: ${missing.join(", ")}`,
    )
  }
  const file = GOLDEN_OVERRIDE ?? goldenFileNameForVersion(measuredVersion)
  const path = await saveGolden({ ffmpegVersion: measuredVersion, operations: blessed }, file)
  // The one legitimate console line in this suite: bless is an interactive,
  // deliberate act and the operator needs the artifact path.
  process.stdout.write(`\n[characterize] blessed ${Object.keys(blessed).length} operations → ${path}\n`)
})
