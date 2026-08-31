/**
 * Route-level chip-aware bundling (#1088) — the studio shape.
 *
 * A studio production emits NO entity nodes (the minimal-graph rule): its
 * characters and locations are bound only by `@`-chips on
 * `generatedResults[].references[]`. Before P5 such a workflow exported zero
 * assets and imported with every chip pointing at the exporter's rows, whose
 * images the importer does not own and cannot keep.
 *
 * These drive the whole round trip through the HTTP routes: export bundles the
 * chip's entity, import copies its image into the importer's storage, creates
 * the row, and re-points the chip — plus the two edges that decide whether the
 * production still lands (storage quota) and whether a foreign instance's URL
 * is followed at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const { safeFetchMock, uploadMock, r2KeyMock, r2SizeMock, storeImageMock, reserveMock, refundMock } = vi.hoisted(
  () => ({
    safeFetchMock: vi.fn<(url: string, init?: unknown) => Promise<Response>>(),
    uploadMock: vi.fn<(buf: Buffer, key: string, mime: string) => Promise<string>>(),
    r2KeyMock: vi.fn<(url: string) => string | null>(),
    r2SizeMock: vi.fn<(key: string) => Promise<number>>(),
    storeImageMock: vi.fn(),
    reserveMock: vi.fn<(userId: string, bytes: number) => Promise<boolean>>(),
    refundMock: vi.fn(),
  }),
)

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteWorkflowWithPrivateMedia: vi.fn() }))
// The media copy's lazily-loaded dependencies. Without the safe-fetch mock the
// copy path would do real DNS and degrade every assertion to "skipped".
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: safeFetchMock }))
vi.mock("@/lib/storage.js", () => ({
  uploadBufferToR2: uploadMock,
  r2KeyFromOurUrl: r2KeyMock,
  getR2ObjectSize: r2SizeMock,
}))
vi.mock("@/lib/media-import.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/media-import.js")>()
  return { ...actual, storeImportedImageBuffer: storeImageMock }
})
vi.mock("@/utils/file-validation.js", () => ({
  reserveStorageIfWithinLimit: reserveMock,
  refundStorage: refundMock,
  checkStorageQuota: vi.fn().mockResolvedValue({ error: "Storage limit exceeded" }),
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "00000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const WORKFLOW = "00000000-0000-4000-8000-000000000020"
const KIRA = "11111111-1111-4111-8111-111111111111"

/** The exporter's instance — reachable from here, and not ours. */
const THEIR_PORTRAIT = "https://their-instance.example/uploads/images/kira.png"
const THEIR_STILL = "https://their-instance.example/uploads/images/shot-1.png"
const COPIED = (url: string) => `https://mine.example/copy-of/${encodeURIComponent(url)}`

/** A bound `@` chip, as studio writes one into a result. */
const KIRA_CHIP = {
  id: KIRA,
  source: "wired-character",
  defaultName: "Kira",
  url: THEIR_PORTRAIT,
}

/** The studio shape: one generate-image node, no entity node, chips in results. */
const CHIPS_ONLY_NODES = [
  {
    id: "shot-1",
    type: "generate-image",
    data: {
      prompt: "Kira in the doorway",
      generatedResults: [{ url: THEIR_STILL, references: [KIRA_CHIP] }],
    },
  },
]

const CHAR_ROW = {
  id: KIRA,
  node_id: "shot-1",
  name: "Kira",
  description: "A courier",
  gender: null,
  style: null,
  base_outfit: null,
  source_image_url: THEIR_PORTRAIT,
  expressions: [],
  poses: [],
  lighting_variations: [],
}

const DB_WORKFLOW = {
  id: WORKFLOW,
  project_id: PROJECT,
  user_id: USER,
  workspace_id: null,
  visibility: "private",
  folder_id: null,
  name: "My Production",
  description: null,
  is_template: false,
  thumbnail_url: null,
  source_kind: null,
  source_id: null,
  original_author_id: USER,
  nodes: CHIPS_ONLY_NODES,
  edges: [],
  settings: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const IMPORT_BUNDLE = {
  version: 1 as const,
  exportedAt: "2026-01-01T00:00:00Z",
  name: "My Production",
  nodes: CHIPS_ONLY_NODES,
  edges: [],
  settings: {},
  assets: {
    characters: [
      {
        id: KIRA,
        nodeId: "shot-1",
        name: "Kira",
        description: "A courier",
        sourceImageUrl: THEIR_PORTRAIT,
      },
    ],
    objects: [],
    locations: [],
  },
}

// ---------------------------------------------------------------------------
// A table-keyed supabase router — the import's call graph is too branchy for
// the strict call-ORDER mocks the sibling suite uses.
// ---------------------------------------------------------------------------

interface Recorded {
  table: string
  row: Record<string, unknown>
}
const inserts: Recorded[] = []
/** Rows `fetchByIds` should hand back, per table. */
const selectRows = new Map<string, Record<string, unknown>[]>()
/** Names already active per table, as `deriveAvailableName` reads them. */
const activeNames = new Map<string, string[]>()
let insertErrors = new Map<string, { message: string }>()

function router(table: string): Record<string, unknown> {
  const state: { ilike?: boolean } = {}
  const builder: Record<string, unknown> = {
    select: () => builder,
    in: () => builder,
    is: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
    eq: () => builder,
    ilike: () => {
      state.ilike = true
      return Promise.resolve({
        data: (activeNames.get(table) ?? []).map((name) => ({ name })),
        error: null,
      })
    },
    // `loadWorkflowFor` (workflows) and `resolveProjectScope` (projects).
    maybeSingle: () =>
      Promise.resolve({
        data:
          table === "workflows"
            ? DB_WORKFLOW
            : table === "projects"
              ? { id: PROJECT, user_id: USER, workspace_id: null }
              : null,
        error: null,
      }),
    single: () =>
      Promise.resolve({
        data: table === "projects" ? { id: PROJECT, user_id: USER, workspace_id: null } : null,
        error: null,
      }),
    insert: (row: Record<string, unknown>) => {
      inserts.push({ table, row })
      const failure = insertErrors.get(table)
      return {
        select: () => ({
          single: () =>
            Promise.resolve(
              failure
                ? { data: null, error: failure }
                : {
                    data:
                      table === "workflows"
                        ? { ...DB_WORKFLOW, ...row, id: WORKFLOW }
                        : { id: `new-${table}-${inserts.length}` },
                    error: null,
                  },
            ),
        }),
      }
    },
    // `fetchByIds` awaits the chain directly.
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: selectRows.get(table) ?? [], error: null }).then(resolve),
  }
  return builder
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  inserts.length = 0
  selectRows.clear()
  activeNames.clear()
  insertErrors = new Map()
  vi.mocked(supabase.from).mockImplementation(router as never)

  r2KeyMock.mockReturnValue(null) // nothing here is under our own prefix
  r2SizeMock.mockResolvedValue(0)
  reserveMock.mockResolvedValue(true)
  refundMock.mockResolvedValue(undefined)
  safeFetchMock.mockImplementation(
    async () =>
      new Response(new Uint8Array(Buffer.from("png")), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
  )
  uploadMock.mockImplementation(async (_b, key) => `https://mine.example/${key}`)
  storeImageMock.mockImplementation(async ({ sourceUrl }: { sourceUrl?: string }) => ({
    ok: true,
    url: COPIED(sourceUrl ?? ""),
  }))

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await workflowRoutes(instance)
  })
  await app.ready()
})

/** The nodes the import actually stored. */
function storedNodes(): Array<{ id: string; data: Record<string, any> }> {
  const wf = inserts.find((i) => i.table === "workflows")
  return wf!.row.nodes as Array<{ id: string; data: Record<string, any> }>
}

function importBundle(bundle: unknown = IMPORT_BUNDLE) {
  return app.inject({
    method: "POST",
    url: "/v1/workflows/import",
    headers: { "x-user-id": USER },
    payload: { projectId: PROJECT, workflow_json: bundle },
  })
}

describe("GET /v1/workflows/:id/export — a chips-only production", () => {
  it("bundles the entity behind an `@` chip even with no entity node in the graph", async () => {
    selectRows.set("characters", [CHAR_ROW])

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${WORKFLOW}/export?assets=true`,
      headers: { "x-user-id": USER },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.assets.characters).toHaveLength(1)
    expect(body.assets.characters[0].id).toBe(KIRA)
    expect(body.assets.characters[0].sourceImageUrl).toBe(THEIR_PORTRAIT)
  })

  it("warns when a bundled entity's image is on a host nobody else can fetch", async () => {
    selectRows.set("characters", [{ ...CHAR_ROW, source_image_url: "http://localhost:3000/storage/kira.png" }])

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${WORKFLOW}/export?assets=true`,
      headers: { "x-user-id": USER },
    })

    const body = JSON.parse(res.body)
    expect(body.portability.unreachableMedia).toContainEqual({
      nodeId: "",
      nodeLabel: "Kira",
      field: "assets.characters[0].sourceImageUrl",
      url: "http://localhost:3000/storage/kira.png",
    })
  })
})

describe("POST /v1/workflows/import — a chips-only production", () => {
  it("copies the entity's image, creates the row, and re-points the chip", async () => {
    const res = await importBundle()

    expect(res.statusCode).toBe(201)

    // 1. The character landed, pointing at the IMPORTER's copy — not at the
    //    exporter's bytes, whose lifecycle nobody here controls.
    const charInsert = inserts.find((i) => i.table === "characters")!
    expect(charInsert.row.user_id).toBe(USER)
    expect(charInsert.row.source_image_url).toBe(COPIED(THEIR_PORTRAIT))

    // 2. The chip follows it: the created row's id, name and image.
    const [shot] = storedNodes()
    const chip = shot!.data.generatedResults[0].references[0]
    expect(chip.id).toBe("new-characters-1")
    expect(chip.defaultName).toBe("Kira")
    expect(chip.url).toBe(COPIED(THEIR_PORTRAIT))
    // The GENERATED still is not copied — `generatedResults` is output, and
    // #866's walk never pays to re-host regenerable media. Only the entity's
    // own image travels, so `rehosted` counts one.
    expect(shot!.data.generatedResults[0].url).toBe(THEIR_STILL)

    // 3. The map leaves the server for clients holding chips outside the graph.
    const body = res.json()
    expect(body.importReport.assetIdMap).toEqual({ [KIRA]: "new-characters-1" })
    expect(body.importReport.rehosted).toBe(1)
    expect(body.importReport.assetsSkipped).toBeUndefined()
  })

  it("steps the name on a clash and the chip says what the library says", async () => {
    activeNames.set("characters", ["Kira"])

    await importBundle()

    const charInsert = inserts.find((i) => i.table === "characters")!
    expect(charInsert.row.name).toBe("Kira 2")
    expect(storedNodes()[0]!.data.generatedResults[0].references[0].defaultName).toBe("Kira 2")
  })

  it("lands the production and reports the entity skipped when storage is full", async () => {
    storeImageMock.mockImplementation(async ({ sourceUrl }: { sourceUrl?: string }) =>
      sourceUrl === THEIR_PORTRAIT
        ? { ok: false, status: 413, code: "storage_limit_exceeded", message: "Storage limit exceeded" }
        : { ok: true, url: COPIED(sourceUrl ?? "") },
    )

    const res = await importBundle()

    expect(res.statusCode).toBe(201)
    // No character row — an entity that cannot own its images is not created.
    expect(inserts.some((i) => i.table === "characters")).toBe(false)
    expect(inserts.some((i) => i.table === "workflows")).toBe(true)
    const body = res.json()
    expect(body.importReport.assetsSkipped).toEqual([
      { kind: "character", id: KIRA, name: "Kira", reason: "Storage limit exceeded" },
    ])
    expect(body.importReport.assetIdMap).toBeUndefined()
    // The chip keeps the exporter's id — unresolvable, and the client's call.
    expect(storedNodes()[0]!.data.generatedResults[0].references[0].id).toBe(KIRA)
  })

  it("leaves an entity image on a host it cannot reach, and says so", async () => {
    const res = await importBundle({
      ...IMPORT_BUNDLE,
      nodes: [{ id: "shot-1", type: "generate-image", data: {} }],
      assets: {
        ...IMPORT_BUNDLE.assets,
        characters: [
          { ...IMPORT_BUNDLE.assets.characters[0], sourceImageUrl: "http://192.168.1.9/kira.png" },
        ],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(safeFetchMock).not.toHaveBeenCalled()
    const body = res.json()
    expect(body.importReport.unreachable).toHaveLength(1)
    // Still created — it is the image that could not travel, not the entity.
    expect(inserts.find((i) => i.table === "characters")!.row.source_image_url).toBe(
      "http://192.168.1.9/kira.png",
    )
  })

  it("copies a shared URL once when the graph and the entity both point at it", async () => {
    // The exporter's portrait is also wired into the shot as an input
    // reference — one instance, one fetch, both sites rewritten.
    const res = await importBundle({
      ...IMPORT_BUNDLE,
      nodes: [
        {
          id: "shot-1",
          type: "generate-image",
          data: {
            referenceImageUrls: [THEIR_PORTRAIT],
            generatedResults: [{ url: THEIR_STILL, references: [KIRA_CHIP] }],
          },
        },
      ],
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().importReport.rehosted).toBe(1)
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    const [shot] = storedNodes()
    expect(shot!.data.referenceImageUrls[0]).toBe(COPIED(THEIR_PORTRAIT))
    expect(inserts.find((i) => i.table === "characters")!.row.source_image_url).toBe(COPIED(THEIR_PORTRAIT))
  })

  it("still reports an empty copy for a bundle with no media at all", async () => {
    const res = await importBundle({
      version: 1,
      exportedAt: "2026-01-01T00:00:00Z",
      name: "Bare",
      nodes: [{ id: "n1", type: "generate-image", data: {} }],
      edges: [],
      settings: {},
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().importReport).toEqual({ rehosted: 0, unreachable: [], skipped: [] })
  })
})
