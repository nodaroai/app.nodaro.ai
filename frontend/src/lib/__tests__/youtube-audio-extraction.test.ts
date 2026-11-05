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

// The node's content rights box (`node-link-rights.ts`): which link it is ticked for, and the confirmation made for one fetch.
const rights = vi.hoisted(() => ({ ticked: new Map<string, string>(), confirmNodeLink: vi.fn() }))
vi.mock("@/lib/node-link-rights", () => ({
  isNodeLinkRightsTicked: (nodeId: string, link: string) => link.trim() !== "" && rights.ticked.get(nodeId) === link.trim(),
  confirmNodeLink: rights.confirmNodeLink,
}))
vi.mock("@/lib/content-rights", () => ({
  DeclarationChangedError: class DeclarationChangedError extends Error {},
}))

import { DeclarationChangedError } from "@/lib/content-rights"
import {
  ReferenceAudioNotConfirmedError,
  extractReferenceAudio,
  isReferenceAudioExtracting,
  runYouTubeAudioExtraction,
  referenceAudioMediaPatch,
} from "../youtube-audio-extraction"

const LINK = "https://youtu.be/x"
const DONE = { id: "job-1", status: "completed", output_data: { audioUrl: "https://cdn/a.mp3" } }
const patches = (write: ReturnType<typeof vi.fn>) => write.mock.calls.map(([patch]) => patch)

beforeEach(() => {
  vi.clearAllMocks()
  rights.ticked.clear()
  mocks.extractYouTubeAudioApi.mockResolvedValue({ jobId: "job-1" })
})

describe("extractReferenceAudio — the reference-audio node's import of its link", () => {
  it("asks, writes and fetches nothing while the node's box is not ticked for that link", async () => {
    const write = vi.fn()
    await expect(extractReferenceAudio("r1", LINK, write)).rejects.toBeInstanceOf(ReferenceAudioNotConfirmedError)
    rights.ticked.set("r1", "https://youtu.be/other")
    rights.ticked.set("r2", LINK)
    await expect(extractReferenceAudio("r1", LINK, write)).rejects.toBeInstanceOf(ReferenceAudioNotConfirmedError)
    expect(write).not.toHaveBeenCalled()
    expect(rights.confirmNodeLink).not.toHaveBeenCalled()
    expect(mocks.extractYouTubeAudioApi).not.toHaveBeenCalled()
    expect(isReferenceAudioExtracting("r1")).toBe(false)
  })

  it("marks the node extracting, confirms the link on that node for this one fetch, extracts under it, then writes the media", async () => {
    rights.ticked.set("r1", LINK)
    rights.confirmNodeLink.mockResolvedValueOnce("conf-1")
    mocks.getJobStatusLean.mockResolvedValueOnce(DONE)
    const write = vi.fn()
    await extractReferenceAudio("r1", LINK, write)
    expect(patches(write)).toEqual([{ extractionStatus: "extracting" }, referenceAudioMediaPatch("https://cdn/a.mp3")])
    expect(rights.confirmNodeLink).toHaveBeenCalledWith("r1", LINK)
    expect(mocks.extractYouTubeAudioApi).toHaveBeenCalledWith(LINK, { confirmationId: "conf-1" })
    expect(rights.confirmNodeLink.mock.invocationCallOrder[0]).toBeLessThan(mocks.extractYouTubeAudioApi.mock.invocationCallOrder[0]!)
  })

  it("a changed declaration writes idle (the node waits for a new tick), any other failure writes failed, and neither fetches past it", async () => {
    rights.ticked.set("r1", LINK)
    rights.confirmNodeLink.mockRejectedValueOnce(new DeclarationChangedError())
    const changed = vi.fn()
    await extractReferenceAudio("r1", LINK, changed)
    expect(patches(changed)).toEqual([{ extractionStatus: "extracting" }, { extractionStatus: "idle" }])
    expect(mocks.extractYouTubeAudioApi).not.toHaveBeenCalled()

    rights.confirmNodeLink.mockRejectedValueOnce(new Error("refused"))
    const refused = vi.fn()
    await extractReferenceAudio("r1", LINK, refused)
    expect(patches(refused)).toEqual([{ extractionStatus: "extracting" }, { extractionStatus: "failed" }])
    expect(mocks.extractYouTubeAudioApi).not.toHaveBeenCalled()
  })

  it("one extraction per node on this page: a second call while it runs gets it, and the node counts as extracting until its end is written", async () => {
    rights.ticked.set("r1", LINK)
    let confirm: (id: string) => void = () => undefined
    rights.confirmNodeLink.mockReturnValueOnce(new Promise<string>((resolve) => { confirm = resolve }))
    mocks.getJobStatusLean.mockResolvedValueOnce(DONE)
    const seen: Array<[unknown, boolean]> = []
    const first = extractReferenceAudio("r1", LINK, (patch) => seen.push([patch, isReferenceAudioExtracting("r1")]))
    expect(isReferenceAudioExtracting("r1")).toBe(true)
    expect(extractReferenceAudio("r1", LINK, vi.fn())).toBe(first)
    confirm("conf-1")
    await first
    expect(rights.confirmNodeLink).toHaveBeenCalledTimes(1)
    expect(mocks.extractYouTubeAudioApi).toHaveBeenCalledTimes(1)
    expect(seen.at(-1)).toEqual([referenceAudioMediaPatch("https://cdn/a.mp3"), true])
    expect(isReferenceAudioExtracting("r1")).toBe(false)
  })
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

  it("hands the confirmation it is given to the request, and none when it has none", async () => {
    const done = { id: "job-1", status: "completed", output_data: { audioUrl: "https://cdn/a.mp3" } }
    mocks.getJobStatusLean.mockResolvedValueOnce(done).mockResolvedValueOnce(done)
    await runYouTubeAudioExtraction("https://youtu.be/x", { confirmationId: "conf-9" })
    expect(mocks.extractYouTubeAudioApi).toHaveBeenLastCalledWith("https://youtu.be/x", { confirmationId: "conf-9" })
    await runYouTubeAudioExtraction("https://youtu.be/x")
    expect(mocks.extractYouTubeAudioApi).toHaveBeenLastCalledWith("https://youtu.be/x", {})
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
