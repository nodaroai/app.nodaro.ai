/**
 * Copy-on-import for the bundle's ENTITY images (#1088).
 *
 * `WorkflowExport.assets` was invisible to both halves of this module: an
 * export called a bundle portable while its character portraits sat on a host
 * nobody else can reach, and an import re-created rows pointing at the
 * EXPORTER's bytes — durable only until their delete, their quarantine sweep or
 * their retention reaper got there, none of which the importer controls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { safeFetchMock, uploadMock, r2KeyMock, r2SizeMock, storeImageMock, reserveMock, refundMock, fromMock } =
  vi.hoisted(() => ({
    safeFetchMock: vi.fn<(url: string, init?: unknown) => Promise<Response>>(),
    uploadMock: vi.fn<(buf: Buffer, key: string, mime: string) => Promise<string>>(),
    r2KeyMock: vi.fn<(url: string) => string | null>(),
    r2SizeMock: vi.fn<(key: string) => Promise<number>>(),
    storeImageMock: vi.fn(),
    reserveMock: vi.fn<(userId: string, bytes: number) => Promise<boolean>>(),
    refundMock: vi.fn(),
    fromMock: vi.fn(),
  }))

vi.mock("../safe-fetch.js", () => ({ safeFetch: safeFetchMock }))
vi.mock("../storage.js", () => ({ uploadBufferToR2: uploadMock, r2KeyFromOurUrl: r2KeyMock, getR2ObjectSize: r2SizeMock }))
vi.mock("../media-import.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media-import.js")>()
  return { ...actual, storeImportedImageBuffer: storeImageMock }
})
vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))
vi.mock("../../utils/file-validation.js", () => ({
  reserveStorageIfWithinLimit: reserveMock,
  refundStorage: refundMock,
  checkStorageQuota: vi.fn(),
}))

import { collectAssetMediaUrls, findUnroutableMedia, rehostForeignMedia } from "../media-portability.js"
import type { BundleAssets } from "../media-portability.js"

const USER = "importer-1"
const OUR_PREFIX = "http://localhost:3000/storage/nodaro-assets/"
const KIRA_ID = "11111111-1111-4111-8111-111111111111"
const LIB_ID = "44444444-4444-4444-8444-444444444444"

/** Their instance's copy of a portrait — reachable, but not the importer's. */
const THEIR_PORTRAIT = "https://their-instance.example/uploads/images/kira.png"
const THEIR_SMILE = "https://their-instance.example/uploads/images/kira-smile.png"
/** Under OUR prefix — same instance, someone else's row. */
const SAME_INSTANCE_PORTRAIT = OUR_PREFIX + "uploads/images/kira.png"

function imageResponse(): Response {
  return new Response(new Uint8Array(Buffer.from("png-bytes")), {
    status: 200,
    headers: { "content-type": "image/png" },
  })
}

function bundle(overrides: Partial<BundleAssets> = {}): BundleAssets {
  return {
    characters: [
      {
        id: KIRA_ID,
        nodeId: "node-1",
        name: "Kira",
        sourceImageUrl: THEIR_PORTRAIT,
        expressions: [{ name: "smile", url: THEIR_SMILE }],
      },
    ],
    objects: [],
    locations: [],
    ...overrides,
  }
}

/** `assets` rows whose `r2_key` the IMPORTER owns — drives `importerOwnsBytes`. */
const ownedKeys = new Set<string>()

beforeEach(() => {
  vi.clearAllMocks()
  ownedKeys.clear()
  r2KeyMock.mockImplementation((url) => (url.startsWith(OUR_PREFIX) ? url.slice(OUR_PREFIX.length) : null))
  r2SizeMock.mockResolvedValue(1234)
  reserveMock.mockResolvedValue(true)
  safeFetchMock.mockImplementation(async () => imageResponse())
  uploadMock.mockImplementation(async (_buf, key) => `https://mine.example/${key}`)
  storeImageMock.mockImplementation(async ({ sourceUrl }: { sourceUrl?: string }) => ({
    ok: true,
    url: `https://mine.example/copy-of/${encodeURIComponent(sourceUrl ?? "")}`,
  }))
  fromMock.mockImplementation((table: string) => {
    if (table !== "assets") return { insert: vi.fn().mockResolvedValue({ error: null }) }
    const state: { key?: string; user?: string } = {}
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, value: string) => {
        if (col === "r2_key") state.key = value
        if (col === "user_id") state.user = value
        return builder
      },
      limit: () =>
        Promise.resolve({
          data: state.key && ownedKeys.has(state.key) && state.user === USER ? [{ id: "row-1" }] : [],
          error: null,
        }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }
    return builder
  })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("collectAssetMediaUrls", () => {
  it("finds an entity's portrait, its variants and a location's reference photos", () => {
    const refs = collectAssetMediaUrls(
      bundle({
        locations: [
          {
            id: LIB_ID,
            nodeId: "node-2",
            name: "Old Library",
            sourceImageUrl: "https://their-instance.example/lib.png",
            referencePhotos: [{ kind: "wide", url: "https://their-instance.example/lib-wide.png" }],
          },
        ],
      }),
    )

    expect(refs.map((r) => r.url).sort()).toEqual([
      "https://their-instance.example/lib-wide.png",
      "https://their-instance.example/lib.png",
      THEIR_SMILE,
      THEIR_PORTRAIT,
    ].sort())
    const portrait = refs.find((r) => r.url === THEIR_PORTRAIT)!
    expect(portrait.kind).toBe("character")
    expect(portrait.assetId).toBe(KIRA_ID)
    expect(portrait.nodeLabel).toBe("Kira")
    expect(portrait.field).toBe("assets.characters[0].sourceImageUrl")
    expect(refs.find((r) => r.url.endsWith("lib-wide.png"))!.kind).toBe("location")
  })

  it("is empty when the bundle carries no assets", () => {
    expect(collectAssetMediaUrls(undefined)).toEqual([])
  })
})

describe("findUnroutableMedia — the bundled entities", () => {
  it("reports a character portrait only the exporter's host can serve", () => {
    const unroutable = findUnroutableMedia(
      [{ id: "n1", data: { imageUrl: "https://cdn.example/ok.png" } }],
      bundle({
        characters: [
          { id: KIRA_ID, nodeId: "node-1", name: "Kira", sourceImageUrl: "http://localhost:3000/storage/kira.png" },
        ],
      }),
    )

    expect(unroutable).toHaveLength(1)
    expect(unroutable[0]!.url).toBe("http://localhost:3000/storage/kira.png")
    expect(unroutable[0]!.nodeLabel).toBe("Kira")
    // The wire shape stays a plain WorkflowMediaRef.
    expect(Object.keys(unroutable[0]!).sort()).toEqual(["field", "nodeId", "nodeLabel", "url"])
  })
})

describe("rehostForeignMedia — entity assets", () => {
  it("copies an entity's images into the importer's storage and re-points the bundle", async () => {
    const assets = bundle()
    const result = await rehostForeignMedia([], USER, { assets })

    expect(result.report.rehosted).toBe(2)
    const character = result.assets!.characters[0]!
    expect(character.sourceImageUrl).toBe(`https://mine.example/copy-of/${encodeURIComponent(THEIR_PORTRAIT)}`)
    expect(character.expressions![0]!.url).toBe(`https://mine.example/copy-of/${encodeURIComponent(THEIR_SMILE)}`)
    // The caller's bundle is never mutated.
    expect(assets.characters[0]!.sourceImageUrl).toBe(THEIR_PORTRAIT)
  })

  it("copies an entity image that already sits on THIS instance — they are the exporter's bytes", async () => {
    const assets = bundle({
      characters: [{ id: KIRA_ID, nodeId: "node-1", name: "Kira", sourceImageUrl: SAME_INSTANCE_PORTRAIT }],
    })

    const result = await rehostForeignMedia([], USER, { assets })

    expect(result.report.rehosted).toBe(1)
    expect(result.assets!.characters[0]!.sourceImageUrl).not.toBe(SAME_INSTANCE_PORTRAIT)
  })

  it("leaves bytes the IMPORTER already owns alone — their own production, read back in", async () => {
    ownedKeys.add("uploads/images/kira.png")
    const assets = bundle({
      characters: [{ id: KIRA_ID, nodeId: "node-1", name: "Kira", sourceImageUrl: SAME_INSTANCE_PORTRAIT }],
    })

    const result = await rehostForeignMedia([], USER, { assets })

    expect(result.report.rehosted).toBe(0)
    expect(safeFetchMock).not.toHaveBeenCalled()
    expect(result.assets!.characters[0]!.sourceImageUrl).toBe(SAME_INSTANCE_PORTRAIT)
  })

  it("copies a URL the graph and an entity share ONCE, and rewrites both", async () => {
    const nodes = [{ id: "shot-1", data: { referenceImageUrls: [THEIR_PORTRAIT] } }]
    const result = await rehostForeignMedia(nodes, USER, { assets: bundle() })

    // The portrait + the expression — the shared URL was not fetched twice.
    expect(result.report.rehosted).toBe(2)
    const copied = `https://mine.example/copy-of/${encodeURIComponent(THEIR_PORTRAIT)}`
    expect((result.nodes[0]!.data as any).referenceImageUrls[0]).toBe(copied)
    expect(result.assets!.characters[0]!.sourceImageUrl).toBe(copied)
  })

  it("drops an entity whose copy hit the storage quota — the production still lands", async () => {
    storeImageMock.mockResolvedValue({
      ok: false,
      status: 413,
      code: "storage_limit_exceeded",
      message: "Storage limit exceeded",
    })

    const result = await rehostForeignMedia([{ id: "shot-1", data: {} }], USER, { assets: bundle() })

    expect(result.assets!.characters).toEqual([])
    expect(result.report.assetsSkipped).toEqual([
      { kind: "character", id: KIRA_ID, name: "Kira", reason: "Storage limit exceeded" },
    ])
    // The graph itself is untouched — the workflow imports either way.
    expect(result.nodes).toHaveLength(1)
  })

  it("keeps an entity whose copy failed for a NON-quota reason, and reports the URL", async () => {
    storeImageMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: "validation_error",
      message: "That URL doesn't point to a decodable image",
    })

    const result = await rehostForeignMedia([], USER, { assets: bundle() })

    expect(result.report.assetsSkipped).toBeUndefined()
    expect(result.assets!.characters).toHaveLength(1)
    expect(result.assets!.characters[0]!.sourceImageUrl).toBe(THEIR_PORTRAIT)
    expect(result.report.skipped).toHaveLength(2)
  })

  it("hands the bundle straight back when it references no media at all", async () => {
    const assets: BundleAssets = { characters: [], objects: [], locations: [] }
    const result = await rehostForeignMedia([], USER, { assets })
    expect(result.assets).toBe(assets)
    expect(result.report).toEqual({ rehosted: 0, unreachable: [], skipped: [] })
  })

  it("reports an entity image on a private host as unreachable instead of fetching it", async () => {
    const result = await rehostForeignMedia([], USER, {
      assets: bundle({
        characters: [{ id: KIRA_ID, nodeId: "node-1", name: "Kira", sourceImageUrl: "http://192.168.1.9/kira.png" }],
      }),
    })

    expect(safeFetchMock).not.toHaveBeenCalled()
    expect(result.report.unreachable).toHaveLength(1)
    expect(result.report.unreachable[0]!.nodeLabel).toBe("Kira")
  })
})
