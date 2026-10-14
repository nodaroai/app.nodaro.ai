// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve, relative } from "node:path"

const mocks = vi.hoisted(() => ({
  extractYouTubeAudioApi: vi.fn(),
  getJobStatusLean: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  extractYouTubeAudioApi: mocks.extractYouTubeAudioApi,
  getJobStatusLean: mocks.getJobStatusLean,
}))

import { runYouTubeAudioExtraction, referenceAudioMediaPatch } from "../youtube-audio-extraction"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.extractYouTubeAudioApi.mockResolvedValue({ jobId: "job-1" })
})

describe("runYouTubeAudioExtraction", () => {
  it("returns the audio url WITH the worker-measured length", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: "job-1", status: "completed",
      output_data: { audioUrl: "https://cdn/a.mp3", durationSeconds: 3564.2 },
    })
    expect(await runYouTubeAudioExtraction("https://youtu.be/x")).toEqual({
      audioUrl: "https://cdn/a.mp3", durationSeconds: 3564.2,
    })
  })

  it("omits the length for a job that carries none (pre-existing jobs, failed probe)", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: "job-1", status: "completed", output_data: { audioUrl: "https://cdn/a.mp3" },
    })
    const out = await runYouTubeAudioExtraction("https://youtu.be/x")
    expect(out).toEqual({ audioUrl: "https://cdn/a.mp3" })
    expect("durationSeconds" in out).toBe(false)
  })

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, "3564", null])(
    "drops a non-positive / non-finite / non-numeric length (%s) rather than bucketing on it",
    async (bad) => {
      mocks.getJobStatusLean.mockResolvedValueOnce({
        id: "job-1", status: "completed", output_data: { audioUrl: "https://cdn/a.mp3", durationSeconds: bad },
      })
      expect(await runYouTubeAudioExtraction("https://youtu.be/x")).toEqual({ audioUrl: "https://cdn/a.mp3" })
    },
  )

  it("rejects on a failed job", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({ id: "job-1", status: "failed", error_message: "private video" })
    await expect(runYouTubeAudioExtraction("https://youtu.be/x")).rejects.toThrow("private video")
  })
})

describe("referenceAudioMediaPatch", () => {
  it("writes the url and its length together", () => {
    expect(referenceAudioMediaPatch("https://cdn/a.mp3", 3564.2)).toEqual({
      extractedAudioUrl: "https://cdn/a.mp3",
      extractionStatus: "ready",
      // Stamped with the media it was measured from — the shared reader trusts
      // the length only while this still equals the node's media.
      metadata: { durationSeconds: 3564.2, mediaUrl: "https://cdn/a.mp3" },
    })
  })

  it("the stamp always equals the url written beside it", () => {
    const patch = referenceAudioMediaPatch("https://cdn/ep42.mp3", 10_800)
    expect(patch.metadata?.mediaUrl).toBe(patch.extractedAudioUrl)
  })

  // THE invariant: the key is always present. A patch that merely omitted
  // `metadata` would leave last week's length on the node after the media was
  // swapped for a longer episode — and Edit Plan would under-quote the new one.
  it("ALWAYS carries a `metadata` key — explicitly undefined when the length is unknown", () => {
    const patch = referenceAudioMediaPatch("https://example.com/direct.mp3")
    expect("metadata" in patch).toBe(true)
    expect(patch.metadata).toBeUndefined()
    // Merged the way updateNodeData merges, the stale length is gone.
    const stale: Record<string, unknown> = { metadata: { durationSeconds: 720 } }
    const merged = { ...stale, ...patch }
    expect(merged.metadata).toBeUndefined()
  })

  it("clears the media — url, status AND length — for an empty url (source-type switch)", () => {
    expect(referenceAudioMediaPatch("")).toEqual({
      extractedAudioUrl: "", extractionStatus: "idle", metadata: undefined,
    })
  })

  it("refuses a nonsense length rather than storing it", () => {
    expect(referenceAudioMediaPatch("https://cdn/a.mp3", 0).metadata).toBeUndefined()
    expect(referenceAudioMediaPatch("https://cdn/a.mp3", Number.NaN).metadata).toBeUndefined()
  })
})

// Every in-editor writer of a reference-audio node's media goes through the
// patch builder, so new media always gets its own length (or an explicit
// "unknown") instead of a ceiling quote. This scan is an ACCURACY guard for
// editor code, deliberately simple: it sees the explicit `extractedAudioUrl:`
// key spelling every writer here uses, not shorthand / computed keys, and it
// cannot see backend or data-driven writers at all. SAFETY does not rest on it —
// a writer it misses leaves a `mediaUrl` stamp that no longer matches, which the
// shared reader (`editPlanSourceDurationSec`) treats as unknown. See
// packages/shared/src/__tests__/video-duration.test.ts.
describe("every extractedAudioUrl writer goes through referenceAudioMediaPatch", () => {
  const SRC = resolve(__dirname, "../..")
  const ALLOWED = new Set([
    "lib/youtube-audio-extraction.ts", // the builder itself
    "types/nodes.ts",                  // the type + NODE_DEFINITIONS default ("")
  ])

  function* sourceFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) yield* sourceFiles(full)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
    }
  }

  it("no other source file writes the field in an object literal", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file)
      if (ALLOWED.has(rel)) continue
      const text = readFileSync(file, "utf8")
      // `extractedAudioUrl:` as an object-literal KEY (a write). Member reads
      // (`.extractedAudioUrl`) never match. A destructuring rename or an inline
      // type literal in a new file WOULD match — a loud, safe false positive:
      // add the file to ALLOWED with a reason.
      text.split("\n").forEach((line, i) => {
        if (/(^|[\s{,(])extractedAudioUrl\s*:/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders, `write the media through referenceAudioMediaPatch():\n${offenders.join("\n")}`).toEqual([])
  })
})
