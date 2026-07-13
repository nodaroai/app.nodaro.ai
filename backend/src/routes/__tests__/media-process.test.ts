import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const R2_PREFIX = "https://pub-test.r2.dev/"

vi.mock("@/lib/storage.js", () => ({
  uploadBufferToR2: vi.fn(async (_buf: Buffer, key: string) => `${R2_PREFIX}${key}`),
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  // Same contract as the real origin-anchored extractor, pinned to the test CDN
  // prefix: our URLs → key, anything else → null.
  r2KeyFromOurUrl: vi.fn((url: string) =>
    url.startsWith(R2_PREFIX) ? url.slice(R2_PREFIX.length) : null,
  ),
}))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  // The route reads the output file back, so the mock must actually write the
  // path it was asked to produce (last ffmpeg arg).
  runFfmpeg: vi.fn(async (args: string[]) => {
    await fs.writeFile(args[args.length - 1], "processed-bytes")
    return ""
  }),
  runFfprobe: vi.fn().mockResolvedValue(JSON.stringify({ streams: [], format: {} })),
  createWorkDir: vi.fn(),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { safeMediaExt, mediaProcessRoutes } from "../media-process.js"
import { supabase } from "../../lib/supabase.js"
import { uploadBufferToR2, deleteFromR2 } from "../../lib/storage.js"
import { updateStorageUsage } from "../../utils/file-validation.js"
import { createWorkDir } from "../../providers/video/ffmpeg-utils.js"

// ---------------------------------------------------------------------------
// safeMediaExt (pure unit tests, pre-existing)
// ---------------------------------------------------------------------------

describe("safeMediaExt (path-traversal guard for /v1/media/process)", () => {
  it("returns the real extension for normal media URLs", () => {
    expect(safeMediaExt("https://cdn.x/clip.mp4", "mp4")).toBe("mp4")
    expect(safeMediaExt("https://cdn.x/song.mp3?token=abc", "mp3")).toBe("mp3")
    expect(safeMediaExt("https://cdn.x/a.WEBM", "mp4")).toBe("webm") // case-normalized
    expect(safeMediaExt("https://cdn.x/voice.m4a", "mp3")).toBe("m4a")
  })

  it("clamps unknown or malicious extensions to the fallback (never shapes a path)", () => {
    const attacks = [
      "https://e.com/x.mp4/../../../../etc/passwd",
      "https://e.com/a." + "../".repeat(10) + "etc/passwd",
      "https://e.com/x./etc/passwd",
      "https://e.com/file", // no extension at all
      "https://e.com/x.mov", // real container, but not an allowed output format
      "https://e.com/report.pdf",
    ]
    for (const url of attacks) {
      const ext = safeMediaExt(url, "mp4")
      expect(ext).toBe("mp4")
      // The returned extension can NEVER contain a path separator or dot segment.
      expect(ext).not.toMatch(/[/\\.]/)
    }
  })
})

// ---------------------------------------------------------------------------
// Route tests — POST /v1/media/process with deleteSource
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const SOURCE_KEY = "uploads/audio/source-original.mp3"
const OUR_SOURCE_URL = `${R2_PREFIX}${SOURCE_KEY}`
const OWNED_SOURCE_ASSET = {
  id: "src-asset-1",
  user_id: TEST_USER_ID,
  r2_key: SOURCE_KEY,
  size_bytes: 4242,
}

type ChainResult = { data?: unknown; error?: unknown; count?: number | null }

/**
 * Thenable supabase chain stub: every method returns the chain; awaiting it
 * (directly or via .single()/.maybeSingle()) resolves the given result.
 */
function chain(result: ChainResult) {
  const target: Record<string, unknown> = {}
  const proxy: Record<string, unknown> = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: ChainResult) => void) =>
          resolve({ data: null, error: null, count: null, ...result })
      }
      return () => proxy
    },
  })
  return proxy
}

/** Each supabase.from() call consumes the next queued result (last one repeats). */
function queueSupabaseResults(...results: ChainResult[]) {
  const q = [...results]
  vi.mocked(supabase.from).mockImplementation(
    () => chain(q.length > 1 ? q.shift()! : q[0] ?? { data: null, error: null }) as never,
  )
}

/** Results for the full owned-delete flow, in supabase.from() call order. */
function ownedFlowResults(): ChainResult[] {
  return [
    { data: { id: "new-output-asset" }, error: null }, // insert of the processed output's asset row
    { data: OWNED_SOURCE_ASSET, error: null },         // ownership lookup (r2_key + user_id)
    { count: 0, error: null },                         // other assets rows referencing the key
    { count: 0, error: null },                         // jobs output_data->>imageUrl
    { count: 0, error: null },                         // jobs output_data->>videoUrl
    { count: 0, error: null },                         // jobs output_data->>audioUrl
    { error: null },                                   // delete of the source asset row
  ]
}

let app: FastifyInstance
let workDir: string
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.clearAllMocks()
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

  workDir = await fs.mkdtemp(join(tmpdir(), "media-process-test-"))
  vi.mocked(createWorkDir).mockResolvedValue(workDir)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") {
      req.userId = body.userId
    }
  })
  await app.register(async (instance) => {
    await mediaProcessRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  warnSpy.mockRestore()
  await app.close()
  await fs.rm(workDir, { recursive: true, force: true })
})

function post(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/media/process",
    payload: {
      userId: TEST_USER_ID,
      type: "audio",
      trim: { startTime: 1, endTime: 2 },
      ...body,
    },
  })
}

describe("POST /v1/media/process — deleteSource", () => {
  it("flag omitted → processes fine and deletes nothing", async () => {
    queueSupabaseResults({ data: { id: "new-output-asset" }, error: null })

    const res = await post({ sourceUrl: OUR_SOURCE_URL })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.url).toContain(`${R2_PREFIX}uploads/audio/`)
    expect(deleteFromR2).not.toHaveBeenCalled()
    // Only the output-asset insert touches the DB — no ownership/referrer reads.
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it("deleteSource:false → deletes nothing", async () => {
    queueSupabaseResults({ data: { id: "new-output-asset" }, error: null })

    const res = await post({ sourceUrl: OUR_SOURCE_URL, deleteSource: false })
    expect(res.statusCode).toBe(200)
    expect(deleteFromR2).not.toHaveBeenCalled()
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it("deleteSource must be a boolean", async () => {
    const res = await post({ sourceUrl: OUR_SOURCE_URL, deleteSource: "yes" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("flag on + our URL + owned → source deleted AFTER the output upload; row removed; quota decremented", async () => {
    queueSupabaseResults(...ownedFlowResults())

    const res = await post({ sourceUrl: OUR_SOURCE_URL, deleteSource: true })
    expect(res.statusCode).toBe(200)

    expect(deleteFromR2).toHaveBeenCalledExactlyOnceWith(SOURCE_KEY)
    // Ordering guarantee: the new output must be fully uploaded first.
    expect(vi.mocked(deleteFromR2).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(uploadBufferToR2).mock.invocationCallOrder[0],
    )
    // insert, ownership, asset-refs, jobs×3, row delete — in that table order.
    expect(vi.mocked(supabase.from).mock.calls.map((c) => c[0])).toEqual([
      "assets", "assets", "assets", "jobs", "jobs", "jobs", "assets",
    ])
    expect(updateStorageUsage).toHaveBeenCalledExactlyOnceWith(
      TEST_USER_ID,
      -OWNED_SOURCE_ASSET.size_bytes,
    )
  })

  it("foreign URL → silently skipped (nothing beyond the output insert)", async () => {
    queueSupabaseResults({ data: { id: "new-output-asset" }, error: null })

    const res = await post({ sourceUrl: "https://cdn.elsewhere.com/clip.mp3", deleteSource: true })
    expect(res.statusCode).toBe(200)
    expect(deleteFromR2).not.toHaveBeenCalled()
    expect(updateStorageUsage).not.toHaveBeenCalled()
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it("no asset record ties the requester to the object (unowned) → skip with a warn, still 200", async () => {
    queueSupabaseResults(
      { data: { id: "new-output-asset" }, error: null },
      { data: null, error: null }, // ownership lookup: no row for (r2_key, THIS user)
    )

    const res = await post({ sourceUrl: OUR_SOURCE_URL, deleteSource: true })
    expect(res.statusCode).toBe(200)
    expect(deleteFromR2).not.toHaveBeenCalled()
    expect(updateStorageUsage).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deleteSource skipped"))
  })

  it("another referrer holds the object → R2 delete skipped, the user's row still removed", async () => {
    queueSupabaseResults(
      { data: { id: "new-output-asset" }, error: null },
      { data: OWNED_SOURCE_ASSET, error: null },
      { count: 1, error: null }, // another assets row references the same r2_key
      { error: null },           // delete of the source asset row
    )

    const res = await post({ sourceUrl: OUR_SOURCE_URL, deleteSource: true })
    expect(res.statusCode).toBe(200)
    expect(deleteFromR2).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("kept R2 object"))
    // The row (and its quota charge) still goes — same as library.ts.
    expect(updateStorageUsage).toHaveBeenCalledWith(TEST_USER_ID, -OWNED_SOURCE_ASSET.size_bytes)
  })

  it("deleteFromR2 throwing never fails the request", async () => {
    queueSupabaseResults(...ownedFlowResults())
    vi.mocked(deleteFromR2).mockRejectedValueOnce(new Error("R2 unavailable"))

    const res = await post({ sourceUrl: OUR_SOURCE_URL, deleteSource: true })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.url).toContain(`${R2_PREFIX}uploads/audio/`)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("R2 delete failed"),
      expect.any(Error),
    )
  })
})
