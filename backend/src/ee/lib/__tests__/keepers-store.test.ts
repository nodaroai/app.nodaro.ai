import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/entity-naming.js", () => ({
  deriveAvailableName: vi.fn(async (_table: string, _userId: string, base: string) => base),
}))
vi.mock("@/lib/default-project.js", () => ({
  ensureDefaultProject: vi.fn(async () => ({ projectId: "00000000-0000-4000-8000-0000000000d1" })),
  PERSONAL_SPACE_DISABLED_ERROR: { code: "personal_space_disabled", message: "x" },
}))
vi.mock("@/utils/file-validation.js", () => ({
  reserveStorageIfWithinLimit: vi.fn(async () => true),
  refundStorage: vi.fn(async () => undefined),
}))
vi.mock("@/lib/storage.js", () => ({
  copyR2ObjectToPrefix: vi.fn(async (url: string, prefix: string) => ({ url: `${prefix}${url.split("/").pop()}`, bytes: 10 })),
  // Our own storage: the CDN's files and the copies this store makes under the caller's prefix; anything else is foreign.
  r2KeyFromOurUrl: vi.fn((url: string) =>
    url.startsWith("https://cdn.nodaro.ai/") ? url.replace("https://cdn.nodaro.ai/", "") : url.startsWith("user-clones/") ? url : null,
  ),
}))
vi.mock("@/lib/storage-delete.js", () => ({ deleteKeysRecordingFailures: vi.fn(async () => undefined) }))

import { supabase } from "../../../lib/supabase.js"
import { deriveAvailableName } from "../../../lib/entity-naming.js"
import { ensureDefaultProject } from "../../../lib/default-project.js"
import { reserveStorageIfWithinLimit, refundStorage } from "../../../utils/file-validation.js"
import { copyR2ObjectToPrefix } from "../../../lib/storage.js"
import { deleteKeysRecordingFailures } from "../../../lib/storage-delete.js"
import {
  copyKeeper,
  decodeCatalogCursor,
  encodeCatalogCursor,
  listKeeperCatalog,
  setKeeperCatalog,
} from "../keepers-store.js"

const fromMock = supabase.from as ReturnType<typeof vi.fn>

type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

/**
 * Chainable + thenable query-builder mock: every builder verb returns the
 * same object, `single` / `maybeSingle` / `await` resolve to `result`. The
 * verbs are recorded so a test can read what the store asked for.
 */
function makeQB(result: Result = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const calls: Array<[string, unknown[]]> = []
  const qb: Record<string, unknown> & { calls: Array<[string, unknown[]]> } = { calls }
  for (const name of ["select", "insert", "update", "delete", "eq", "is", "not", "or", "order", "limit", "ilike"]) {
    qb[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, args])
      return qb
    })
  }
  qb.maybeSingle = vi.fn(() => Promise.resolve(resolved))
  qb.single = vi.fn(() => Promise.resolve(resolved))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(resolved)
  return qb
}

/** `from()` answers the queued builders in order; a table name is recorded with each. */
function queueFrom(...qbs: ReturnType<typeof makeQB>[]) {
  const tables: string[] = []
  let i = 0
  fromMock.mockImplementation((table: string) => {
    tables.push(table)
    const qb = qbs[i] ?? makeQB()
    i += 1
    return qb
  })
  return tables
}

const USER = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-00000000000a"
const SRC = "00000000-0000-4000-8000-0000000000c1"
const COPY = "00000000-0000-4000-8000-0000000000c2"

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Keeper ${id.slice(-2)}`,
    description: "a hero",
    source_image_url: `https://cdn.nodaro.ai/images/${id}.png`,
    catalog_category: "Heroes",
    catalog_sort: 0,
    created_at: "2026-10-28T09:00:00+00:00",
    ...overrides,
  }
}

beforeEach(() => {
  fromMock.mockReset()
  vi.mocked(deriveAvailableName).mockClear()
  vi.mocked(ensureDefaultProject).mockClear()
  vi.mocked(reserveStorageIfWithinLimit).mockClear()
  vi.mocked(reserveStorageIfWithinLimit).mockResolvedValue(true)
  vi.mocked(refundStorage).mockClear()
  vi.mocked(copyR2ObjectToPrefix).mockReset()
  vi.mocked(copyR2ObjectToPrefix).mockImplementation(async (url: string, prefix: string) => ({ url: `${prefix}${url.split("/").pop()}`, bytes: 10 }))
  vi.mocked(deleteKeysRecordingFailures).mockClear()
})

describe("the catalog cursor", () => {
  it("round-trips a kind alone and a kind with a shelf position, URL-safe", () => {
    expect(decodeCatalogCursor(encodeCatalogCursor({ kind: "creature" }))).toEqual({ kind: "creature" })
    const after = { sort: 3, createdAt: "2026-10-28T09:00:00+00:00", id: SRC }
    const encoded = encodeCatalogCursor({ kind: "object", after })
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCatalogCursor(encoded)).toEqual({ kind: "object", after })
  })

  it("refuses an absent, malformed or over-long cursor, an unknown kind, and a field that could carry a filter", () => {
    expect(decodeCatalogCursor(undefined)).toBeNull()
    expect(decodeCatalogCursor("not base64 json")).toBeNull()
    expect(decodeCatalogCursor("a".repeat(300))).toBeNull()
    expect(decodeCatalogCursor(Buffer.from(JSON.stringify({ kind: "person" })).toString("base64url"))).toBeNull()
    const inject = (after: Record<string, unknown>) =>
      decodeCatalogCursor(Buffer.from(JSON.stringify({ kind: "character", after })).toString("base64url"))
    expect(inject({ sort: 0, createdAt: "2026-10-28T09:00:00Z", id: `${SRC}),or(id.gt.0` })).toBeNull()
    expect(inject({ sort: 0, createdAt: "2026-10-28T09:00:00Z,catalog.eq.false", id: SRC })).toBeNull()
    expect(inject({ sort: "0,x", createdAt: "2026-10-28T09:00:00Z", id: SRC })).toBeNull()
    expect(inject({ sort: 1.5, createdAt: "2026-10-28T09:00:00Z", id: SRC })).toBeNull()
    // An integer too, but one the filter would spell "1e+21"; and one past the column's bound.
    expect(inject({ sort: 1e21, createdAt: "2026-10-28T09:00:00Z", id: SRC })).toBeNull()
    expect(inject({ sort: 1_000_001, createdAt: "2026-10-28T09:00:00Z", id: SRC })).toBeNull()
    expect(inject({ sort: -1_000_000, createdAt: "2026-10-28T09:00:00Z", id: SRC })).not.toBeNull()
  })
})

describe("listKeeperCatalog", () => {
  it("reads only shelf rows with a main image, hands out display fields with a CDN tile, and pages by (sort, created_at, id)", async () => {
    const r1 = row(SRC)
    const r2 = row(COPY, { catalog_sort: 1, created_at: "2026-10-27T09:00:00+00:00" })
    const probe = row("00000000-0000-4000-8000-0000000000c3", { catalog_sort: 2 })
    const qb = makeQB({ data: [r1, r2, probe] })
    const tables = queueFrom(qb)

    const page = await listKeeperCatalog({ kind: "character", limit: 2 })
    expect(tables).toEqual(["characters"])
    expect(qb.calls).toEqual(
      expect.arrayContaining([
        ["eq", ["catalog", true]],
        ["is", ["deleted_at", null]],
        ["not", ["source_image_url", "is", null]],
        ["order", ["catalog_sort", { ascending: true }]],
        ["order", ["created_at", { ascending: false }]],
        ["order", ["id", { ascending: false }]],
        ["limit", [3]],
      ]),
    )
    expect(qb.calls.some(([verb]) => verb === "or")).toBe(false)
    if ("error" in page) throw new Error(page.error)
    expect(page.data).toEqual([
      {
        id: SRC,
        kind: "character",
        name: "Keeper c1",
        description: "a hero",
        imageUrl: `https://cdn.nodaro.ai/images/${SRC}.png`,
        previewUrl: `https://cdn.nodaro.ai/cdn-cgi/image/width=480,format=auto,quality=80/images/${SRC}.png`,
        category: "Heroes",
        sort: 0,
        createdAt: "2026-10-28T09:00:00+00:00",
      },
      expect.objectContaining({ id: COPY, sort: 1 }),
    ])
    expect(page.data).toHaveLength(2)
    expect(decodeCatalogCursor(page.next)).toEqual({ kind: "character", after: { sort: 1, createdAt: "2026-10-27T09:00:00+00:00", id: COPY } })
    // The display fields are an explicit pick: nothing of the row's privacy ever rides along.
    for (const item of page.data) expect(Object.keys(item).sort()).toEqual(["category", "createdAt", "description", "id", "imageUrl", "kind", "name", "previewUrl", "sort"])
  })

  it("the next page applies the cursor as the keyset filter", async () => {
    const qb = makeQB({ data: [] })
    queueFrom(qb)
    const cursor = encodeCatalogCursor({ kind: "character", after: { sort: 1, createdAt: "2026-10-27T09:00:00+00:00", id: COPY } })
    const page = await listKeeperCatalog({ kind: "character", cursor, limit: 2 })
    expect(qb.calls).toContainEqual([
      "or",
      [`catalog_sort.gt.1,and(catalog_sort.eq.1,created_at.lt.2026-10-27T09:00:00+00:00),and(catalog_sort.eq.1,created_at.eq.2026-10-27T09:00:00+00:00,id.lt.${COPY})`],
    ])
    expect(page).toEqual({ data: [], next: null })
  })

  it("a cursor that does not decode, or names another kind than asked, is invalid_cursor — never page 1", async () => {
    expect(await listKeeperCatalog({ cursor: "zzz" })).toEqual({ error: "invalid_cursor" })
    const other = encodeCatalogCursor({ kind: "object" })
    expect(await listKeeperCatalog({ kind: "character", cursor: other })).toEqual({ error: "invalid_cursor" })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("without a kind the page fills across the kinds in order, and the cursor carries the kind it stopped in", async () => {
    const tables = queueFrom(
      makeQB({ data: [row(SRC)] }), // characters: one row, no more
      makeQB({ data: [] }), // creatures: none
      makeQB({ data: [row(COPY), row("00000000-0000-4000-8000-0000000000c3"), row("00000000-0000-4000-8000-0000000000c4")] }), // locations: 2 + probe
    )
    const page = await listKeeperCatalog({ limit: 3 })
    expect(tables).toEqual(["characters", "creatures", "locations"])
    if ("error" in page) throw new Error(page.error)
    expect(page.data.map((i) => i.kind)).toEqual(["character", "location", "location"])
    expect(decodeCatalogCursor(page.next)?.kind).toBe("location")
  })

  it("a page that ends exactly on a kind's last row points at the next kind that has a row, or ends; a failed probe is an error", async () => {
    queueFrom(
      makeQB({ data: [row(SRC)] }), // characters: exactly the one row asked for
      makeQB({ data: [] }), // probe creatures: none
      makeQB({ data: [{ id: COPY }] }), // probe locations: a row
    )
    const page = await listKeeperCatalog({ limit: 1 })
    if ("error" in page) throw new Error(page.error)
    expect(page.data).toHaveLength(1)
    expect(decodeCatalogCursor(page.next)).toEqual({ kind: "location" })

    queueFrom(makeQB({ data: [row(SRC)] }), makeQB({ data: [] }), makeQB({ data: [] }), makeQB({ data: [] }))
    const last = await listKeeperCatalog({ limit: 1 })
    if ("error" in last) throw new Error(last.error)
    expect(last.next).toBeNull()

    queueFrom(makeQB({ data: [row(SRC)] }), makeQB({ error: { message: "db down" } }))
    expect(await listKeeperCatalog({ limit: 1 })).toEqual({ error: "internal_error", message: "db down" })
  })

  it("a row without a main image never reaches the page even if the filter let it through", async () => {
    queueFrom(makeQB({ data: [row(SRC, { source_image_url: null })] }))
    const page = await listKeeperCatalog({ kind: "object" })
    expect(page).toEqual({ data: [], next: null })
  })
})

describe("setKeeperCatalog", () => {
  it("updates only the admin's own live row, writing just the fields sent", async () => {
    const qb = makeQB({ data: { id: SRC, catalog: true, catalog_sort: 5, catalog_category: null } })
    const tables = queueFrom(qb)
    const result = await setKeeperCatalog("creature", SRC, ADMIN, { catalog: true, sort: 5 })
    expect(tables).toEqual(["creatures"])
    const [, [patch]] = qb.calls.find(([verb]) => verb === "update")!
    expect(patch).toEqual({ catalog: true, catalog_sort: 5, updated_at: expect.any(String) })
    expect(qb.calls).toEqual(expect.arrayContaining([["eq", ["id", SRC]], ["eq", ["user_id", ADMIN]], ["is", ["deleted_at", null]]]))
    expect(result).toEqual({ ok: true, id: SRC, catalog: true, sort: 5, category: null })
  })

  it("a row that is not the admin's (or is gone) is not_found; a null or blank category clears it", async () => {
    queueFrom(makeQB({ data: null }))
    expect(await setKeeperCatalog("object", SRC, ADMIN, { catalog: false })).toEqual({ error: "not_found" })
    for (const category of [null, "   "]) {
      const qb = makeQB({ data: { id: SRC, catalog: false, catalog_sort: 0, catalog_category: null } })
      queueFrom(qb)
      await setKeeperCatalog("object", SRC, ADMIN, { catalog: false, category })
      const [, [patch]] = qb.calls.find(([verb]) => verb === "update")!
      expect(patch).toEqual({ catalog: false, catalog_category: null, updated_at: expect.any(String) })
    }
  })
})

describe("copyKeeper", () => {
  const source = {
    id: SRC,
    user_id: ADMIN,
    name: "Mira",
    description: "a courier",
    gender: "woman",
    style: "realistic",
    base_outfit: null,
    seed_prompt: "a courier in a yellow coat",
    source_image_url: "https://cdn.nodaro.ai/images/mira.png",
    image_provider: "gpt-image-2",
    expressions: [{ name: "smile", url: "https://cdn.nodaro.ai/images/smile.png" }],
    poses: [],
    lighting_variations: [],
    angles: [],
    body_angles: [],
    motions: [],
    boards: [],
    sheets: [],
    detail_closeups: [],
    outfit_variations: [],
    reference_videos_by_variant: { smile: ["https://cdn.nodaro.ai/videos/smile.mp4"] },
    selected_asset_by_variant: {},
    personality: null,
    canonical_description: "a woman in her 30s",
    // Never carried: a cloned voice reduces to its name and sample; the rest never leaves the admin's row.
    voice: { voiceId: "clone-secret", voiceName: "Mira's voice", voiceType: "custom", previewUrl: "https://cdn.nodaro.ai/audio/mira.mp3" },
    person: { age: "age-30s" },
    wardrobe: { outfit: "coat" },
    reference_photos: [{ url: "https://cdn.nodaro.ai/private/face.jpg", kind: "frontFace" }],
    lora_training_status: "trained",
    lora_replicate_version: "v1",
    lora_trigger_word: "MIRA",
    identity_lock: "strict",
    catalog: true,
    catalog_sort: 0,
    catalog_category: "Heroes",
    project_id: "00000000-0000-4000-8000-0000000000p1",
    node_id: "node-1",
  }

  function insertedRow(insert: ReturnType<typeof makeQB>): Record<string, unknown> {
    const [, [inserted]] = insert.calls.find(([verb]) => verb === "insert")! as [string, [Record<string, unknown>]]
    return inserted
  }

  it("makes the caller's own row through the community clone rule: public text + COPIED files, a fresh node, the default project, keyed to the source", async () => {
    const lookup = makeQB({ data: null })
    const read = makeQB({ data: source })
    const insert = makeQB({ data: { id: COPY, name: "Mira" } })
    const tables = queueFrom(lookup, read, insert)

    const result = await copyKeeper("character", SRC, USER)
    expect(tables).toEqual(["characters", "characters", "characters"])
    expect(lookup.calls).toEqual(expect.arrayContaining([["eq", ["user_id", USER]], ["eq", ["catalog_source_id", SRC]]]))
    expect(read.calls).toEqual(expect.arrayContaining([["eq", ["id", SRC]], ["eq", ["catalog", true]], ["is", ["deleted_at", null]], ["not", ["source_image_url", "is", null]]]))
    // The source read asks for the clone rule's columns, never a LoRA or reference-photo one.
    const [, [selected]] = read.calls.find(([verb]) => verb === "select")! as [string, [string]]
    expect(selected).toContain("source_image_url")
    for (const never of ["reference_photos", "person", "wardrobe", "lora_training_status", "lora_trigger_word"]) {
      expect(selected.split(", "), never).not.toContain(never)
    }

    // Every asset file is copied into the caller's own prefix; the row points at the copies.
    const prefixes = new Set(vi.mocked(copyR2ObjectToPrefix).mock.calls.map(([, prefix]) => prefix))
    expect(prefixes.size).toBe(1)
    const prefix = [...prefixes][0]!
    expect(prefix).toMatch(new RegExp(`^user-clones/${USER}/[0-9a-f-]{36}/$`))
    expect(vi.mocked(copyR2ObjectToPrefix).mock.calls.map(([url]) => url).sort()).toEqual([
      "https://cdn.nodaro.ai/audio/mira.mp3",
      "https://cdn.nodaro.ai/images/mira.png",
      "https://cdn.nodaro.ai/images/smile.png",
      "https://cdn.nodaro.ai/videos/smile.mp4",
    ])
    expect(reserveStorageIfWithinLimit).toHaveBeenCalledWith(USER, 40)

    const inserted = insertedRow(insert)
    expect(inserted).toMatchObject({
      user_id: USER,
      project_id: "00000000-0000-4000-8000-0000000000d1",
      name: "Mira",
      catalog: false,
      catalog_source_id: SRC,
      description: "a courier",
      canonical_description: "a woman in her 30s",
      source_image_url: `${prefix}mira.png`,
      expressions: [{ name: "smile", url: `${prefix}smile.png` }],
      reference_videos_by_variant: { smile: [`${prefix}smile.mp4`] },
      // A cloned voice: the display name and its sample, never the usable voice id.
      // … and its sample copied too, so no copy plays the owner's file.
      voice: { voiceName: "Mira's voice", voiceType: "custom", previewUrl: `${prefix}mira.mp3` },
    })
    expect(inserted.node_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(inserted.node_id).not.toBe("node-1")
    for (const never of ["person", "wardrobe", "reference_photos", "lora_training_status", "lora_replicate_version", "lora_trigger_word", "identity_lock", "catalog_sort", "catalog_category", "id", "image_provider", "selected_asset_by_variant"]) {
      expect(inserted, never).not.toHaveProperty(never)
    }
    expect((inserted.voice as Record<string, unknown>).voiceId).toBeUndefined()
    expect(vi.mocked(deriveAvailableName)).toHaveBeenCalledWith("characters", USER, "Mira")
    expect(result).toEqual({ ok: true, id: COPY, name: "Mira", created: true })
    expect(deleteKeysRecordingFailures).not.toHaveBeenCalled()
  })

  it("a library voice's public sample is carried as is — not copied, not charged, and it cannot fail the copy", async () => {
    const insert = makeQB({ data: { id: COPY, name: "Rex" } })
    const voice = { voiceId: "lib-1", voiceName: "Rex", voiceType: "library", previewUrl: "https://api.elevenlabs.io/v1/voices/lib-1/preview.mp3" }
    queueFrom(makeQB({ data: null }), makeQB({ data: { id: SRC, name: "Rex", species: "dog", source_image_url: "https://cdn.nodaro.ai/images/rex.png", voice } }), insert)
    await copyKeeper("creature", SRC, USER)
    expect(insertedRow(insert).voice).toEqual(voice)
    expect(vi.mocked(copyR2ObjectToPrefix).mock.calls.map(([url]) => url)).toEqual(["https://cdn.nodaro.ai/images/rex.png"])
    expect(reserveStorageIfWithinLimit).toHaveBeenCalledWith(USER, 10)
  })

  it("a premade voice is carried whole", async () => {
    const insert = makeQB({ data: { id: COPY, name: "Rex" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: { id: SRC, name: "Rex", species: "dog", source_image_url: "https://cdn.nodaro.ai/images/rex.png", voice: { voiceId: "Adam", voiceName: "Adam", voiceType: "premade" } } }), insert)
    await copyKeeper("creature", SRC, USER)
    expect(insertedRow(insert).voice).toEqual({ voiceId: "Adam", voiceName: "Adam", voiceType: "premade" })
  })

  it("is idempotent per (user, source): a copy the caller already has is returned, nothing is copied or inserted", async () => {
    queueFrom(makeQB({ data: { id: COPY, name: "Mira", deleted_at: null } }))
    expect(await copyKeeper("character", SRC, USER)).toEqual({ ok: true, id: COPY, name: "Mira", created: false })
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(copyR2ObjectToPrefix).not.toHaveBeenCalled()
  })

  it("an archived copy is un-archived and returned, never duplicated", async () => {
    const restore = makeQB({ data: { id: COPY, name: "Mira" } })
    queueFrom(makeQB({ data: { id: COPY, name: "Mira", deleted_at: "2026-10-01T00:00:00Z" } }), restore)
    expect(await copyKeeper("creature", SRC, USER)).toEqual({ ok: true, id: COPY, name: "Mira", created: false })
    const [, [patch]] = restore.calls.find(([verb]) => verb === "update")! as [string, [Record<string, unknown>]]
    expect(patch).toMatchObject({ deleted_at: null, name: "Mira" })
    expect(restore.calls).toEqual(expect.arrayContaining([["eq", ["id", COPY]], ["eq", ["user_id", USER]]]))
  })

  it("restoring an archived copy whose name was taken since derives another name; three collisions in a row are an error", async () => {
    vi.mocked(deriveAvailableName).mockResolvedValueOnce("Mira 2")
    const taken = makeQB({ error: { code: "23505", message: "name taken" } })
    const restored = makeQB({ data: { id: COPY, name: "Mira 2" } })
    queueFrom(makeQB({ data: { id: COPY, name: "Mira", deleted_at: "2026-10-01T00:00:00Z" } }), taken, restored)
    expect(await copyKeeper("creature", SRC, USER)).toEqual({ ok: true, id: COPY, name: "Mira 2", created: false })
    expect(deriveAvailableName).toHaveBeenCalledWith("creatures", USER, "Mira")
    const [, [patch]] = restored.calls.find(([verb]) => verb === "update")! as [string, [Record<string, unknown>]]
    expect(patch).toMatchObject({ deleted_at: null, name: "Mira 2" })

    const collide = () => makeQB({ error: { code: "23505", message: "name taken" } })
    queueFrom(makeQB({ data: { id: COPY, name: "Mira", deleted_at: "2026-10-01T00:00:00Z" } }), collide(), collide(), collide())
    const exhausted = await copyKeeper("creature", SRC, USER)
    expect(exhausted).toMatchObject({ error: "internal_error" })
    expect((exhausted as { message?: string }).message).toMatch(/free name/)
  })

  it("two calls at once where the winner's copy is archived: the loser restores it and drops its own files", async () => {
    const insert = makeQB({ error: { code: "23505", message: "duplicate key" } })
    const restore = makeQB({ data: { id: COPY, name: "Mira" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: source }), insert, makeQB({ data: { id: COPY, name: "Mira", deleted_at: "2026-10-01T00:00:00Z" } }), restore)
    expect(await copyKeeper("character", SRC, USER)).toEqual({ ok: true, id: COPY, name: "Mira", created: false })
    const [, [patch]] = restore.calls.find(([verb]) => verb === "update")! as [string, [Record<string, unknown>]]
    expect(patch).toMatchObject({ deleted_at: null })
    expect(deleteKeysRecordingFailures).toHaveBeenCalledTimes(1)
    expect(refundStorage).toHaveBeenCalledWith(USER, 40)
  })

  it("a row that is off the shelf, archived or without a main image is not_found, before any file is copied", async () => {
    queueFrom(makeQB({ data: null }), makeQB({ data: null }))
    expect(await copyKeeper("location", SRC, USER)).toEqual({ error: "not_found" })
    expect(copyR2ObjectToPrefix).not.toHaveBeenCalled()
  })

  it("a closed personal space refuses the copy before any file is copied", async () => {
    vi.mocked(ensureDefaultProject).mockResolvedValueOnce({ personalSpaceDisabled: true } as never)
    queueFrom(makeQB({ data: null }), makeQB({ data: source }))
    expect(await copyKeeper("character", SRC, USER)).toEqual({ error: "personal_space_disabled" })
    expect(copyR2ObjectToPrefix).not.toHaveBeenCalled()
  })

  it("files that do not fit the caller's storage are deleted again and nothing is inserted", async () => {
    vi.mocked(reserveStorageIfWithinLimit).mockResolvedValueOnce(false)
    const insert = makeQB({ data: { id: COPY, name: "Mira" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: source }), insert)
    expect(await copyKeeper("character", SRC, USER)).toEqual({ error: "storage_limit_exceeded" })
    expect(insert.calls.some(([verb]) => verb === "insert")).toBe(false)
    expect(vi.mocked(deleteKeysRecordingFailures).mock.calls[0]![0]).toHaveLength(4)
    expect(refundStorage).not.toHaveBeenCalled()
  })

  it("two calls at once: the loser's 23505 hands back the winner's copy and drops its own files, giving the reservation back", async () => {
    const insert = makeQB({ error: { code: "23505", message: "duplicate key" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: source }), insert, makeQB({ data: { id: COPY, name: "Mira", deleted_at: null } }))
    expect(await copyKeeper("character", SRC, USER)).toEqual({ ok: true, id: COPY, name: "Mira", created: false })
    expect(deleteKeysRecordingFailures).toHaveBeenCalledTimes(1)
    expect(refundStorage).toHaveBeenCalledWith(USER, 40)
  })

  it("an insert that fails for another reason gives the files and the reservation back", async () => {
    const insert = makeQB({ error: { code: "XX000", message: "boom" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: source }), insert)
    expect(await copyKeeper("character", SRC, USER)).toEqual({ error: "internal_error", message: "boom" })
    expect(deleteKeysRecordingFailures).toHaveBeenCalledTimes(1)
    expect(refundStorage).toHaveBeenCalledWith(USER, 40)
  })

  it("a file copy that fails part-way deletes EVERY file copied — the late siblings too — and reserves nothing", async () => {
    // One of the bucket copies fails at once while its siblings are still in
    // flight; nothing may be left behind under the caller's prefix.
    vi.mocked(copyR2ObjectToPrefix).mockImplementation(async (url: string, prefix: string) => {
      if (url.endsWith("smile.png")) throw new Error("source gone")
      await new Promise((r) => setTimeout(r, 5))
      return { url: `${prefix}${url.split("/").pop()}`, bytes: 10 }
    })
    const insert = makeQB({ data: { id: COPY, name: "Mira" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: source }), insert)
    expect(await copyKeeper("character", SRC, USER)).toEqual({ error: "internal_error", message: "source gone" })
    const deleted = vi.mocked(deleteKeysRecordingFailures).mock.calls.flatMap(([keys]) => keys as string[])
    const copiedOk = vi.mocked(copyR2ObjectToPrefix).mock.calls.filter(([url]) => !url.endsWith("smile.png")).length
    expect(deleted.length).toBe(copiedOk)
    expect(copiedOk).toBeGreaterThan(0)
    expect(reserveStorageIfWithinLimit).not.toHaveBeenCalled()
    expect(insert.calls.some(([verb]) => verb === "insert")).toBe(false)
  })

  it("a location copy whose files the sweep purged is detached (kept in the archive) and made afresh, never restored as dead links", async () => {
    const dead = makeQB({ data: { id: COPY, name: "Pier", deleted_at: "2026-08-01T00:00:00Z", r2_assets_purged_at: "2026-09-01T00:00:00Z" } })
    const detach = makeQB({ data: null })
    const read = makeQB({ data: { id: SRC, name: "Pier", description: "a pier", source_image_url: "https://cdn.nodaro.ai/images/pier.png", main_image_url: "https://cdn.nodaro.ai/images/pier-main.png" } })
    const insert = makeQB({ data: { id: "00000000-0000-4000-8000-0000000000c9", name: "Pier" } })
    queueFrom(dead, detach, read, insert)
    const result = await copyKeeper("location", SRC, USER)
    expect(dead.calls.find(([verb]) => verb === "select")![1][0]).toContain("r2_assets_purged_at")
    expect(detach.calls).toEqual(expect.arrayContaining([
      ["update", [expect.objectContaining({ catalog_source_id: null })]],
      ["eq", ["id", COPY]],
      ["eq", ["user_id", USER]],
    ]))
    expect(detach.calls.some(([verb]) => verb === "delete")).toBe(false)
    expect(result).toEqual({ ok: true, id: "00000000-0000-4000-8000-0000000000c9", name: "Pier", created: true })
    // Both image columns of a location are copied.
    expect(insertedRow(insert)).toMatchObject({ source_image_url: expect.stringMatching(/pier\.png$/), main_image_url: expect.stringMatching(/pier-main\.png$/) })
    expect(insertedRow(insert).source_image_url).not.toBe("https://cdn.nodaro.ai/images/pier.png")
  })

  it("a 23505 on the NAME (no copy of this source yet) derives another name and succeeds", async () => {
    vi.mocked(deriveAvailableName).mockResolvedValueOnce("Mira").mockResolvedValueOnce("Mira 2")
    const first = makeQB({ error: { code: "23505", message: "name taken" } })
    const second = makeQB({ data: { id: COPY, name: "Mira 2" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: source }), first, makeQB({ data: null }), second)
    expect(await copyKeeper("character", SRC, USER)).toEqual({ ok: true, id: COPY, name: "Mira 2", created: true })
    expect(insertedRow(second).name).toBe("Mira 2")
    expect(deleteKeysRecordingFailures).not.toHaveBeenCalled()
    expect(refundStorage).not.toHaveBeenCalled()
  })

  it("a naming failure after the files were reserved gives the files and the reservation back", async () => {
    vi.mocked(deriveAvailableName).mockRejectedValueOnce(new Error("naming down"))
    const insert = makeQB({ data: { id: COPY, name: "Mira" } })
    queueFrom(makeQB({ data: null }), makeQB({ data: source }), insert)
    expect(await copyKeeper("character", SRC, USER)).toEqual({ error: "internal_error", message: "naming down" })
    expect(insert.calls.some(([verb]) => verb === "insert")).toBe(false)
    expect(deleteKeysRecordingFailures).toHaveBeenCalledTimes(1)
    expect(refundStorage).toHaveBeenCalledTimes(1)
    expect(refundStorage).toHaveBeenCalledWith(USER, 40)
  })

  it("a failed lookup of the caller's copy is an error, before any file is copied", async () => {
    queueFrom(makeQB({ error: { message: "db down" } }))
    expect(await copyKeeper("character", SRC, USER)).toEqual({ error: "internal_error", message: "db down" })
    expect(copyR2ObjectToPrefix).not.toHaveBeenCalled()
  })
})
