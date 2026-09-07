import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { Readable } from "node:stream"
import { createHash } from "node:crypto"

/**
 * The three read endpoints, end to end.
 *
 * What is being pinned here is not the happy path — it is the SHAPE of every
 * refusal. A route that answers 403 where it should answer 404 confirms that a
 * revision id is real; one that forgets `no-store` puts somebody's unreleased
 * scene in a shared cache after their access is revoked; one that serves a
 * substituted object because the row still looks right defeats every check
 * upstream of it.
 */

const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))

vi.mock("@/lib/supabase.js", () => ({
  get supabase() {
    return fake.current as never
  },
}))

vi.mock("@/lib/workflow-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/workflow-access.js")>()
  return { ...actual, workflowAccess: vi.fn() }
})

import { workflowAccess } from "../../lib/workflow-access.js"
import { createFakeSupabase } from "../../services/scene3d-artifacts/__tests__/fake-supabase.js"
import type { Scene3DObjectStore } from "../../services/scene3d-artifacts/index.js"
import { scene3DArtifactRoutes } from "../scene3d-artifacts.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const VIEWER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const REV = "00000000-0000-4000-8000-000000000030"
const GLB = "00000000-0000-4000-8000-0000000000a1"
const BLEND = "00000000-0000-4000-8000-0000000000a4"
const RECIPE = "00000000-0000-4000-8000-0000000000a5"

function glbBytes(size = 64): Buffer {
  const buffer = Buffer.alloc(size, 0x11)
  buffer.write("glTF", 0, "ascii")
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(size, 8)
  return buffer
}

const GLB_BYTES = glbBytes()
const BLEND_BYTES = Buffer.concat([Buffer.from("BLENDER-v500", "ascii"), Buffer.alloc(8, 0x33)])
const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex")

const KEYS = {
  glb: `scene3d/${OWNER}/${REV}/${GLB}.glb`,
  blend: `scene3d/${OWNER}/${REV}/${BLEND}.blend`,
  recipe: `scene3d/${OWNER}/${REV}/${RECIPE}.source.json`,
}

function artifactRow(id: string, kind: string, key: string, body: Buffer, etag = "tag") {
  return {
    id,
    user_id: OWNER,
    kind,
    bucket: "private-scenes",
    object_key: key,
    sha256: sha(body),
    byte_length: body.length,
    etag,
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
  }
}

let objects: Record<string, { body: Buffer; etag: string }>

function store(): Scene3DObjectStore {
  return {
    bucket: "private-scenes",
    async get(objectKey, range) {
      const object = objects[objectKey]
      if (!object) throw new Error("NoSuchKey")
      const body = range ? object.body.subarray(range.start, range.endInclusive + 1) : object.body
      return { body: Readable.from([body]), contentLength: body.length, etag: object.etag }
    },
    async delete() {},
  }
}

async function buildApp(withStore: boolean): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await scene3DArtifactRoutes(instance, { store: withStore ? store() : null })
  })
  await app.ready()
  return app
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(workflowAccess).mockResolvedValue("own")
  objects = {
    [KEYS.glb]: { body: GLB_BYTES, etag: "tag" },
    [KEYS.blend]: { body: BLEND_BYTES, etag: "tag" },
    [KEYS.recipe]: { body: Buffer.from("{}"), etag: "tag" },
  }
  fake.current = createFakeSupabase({
    scene3d_revisions: [
      {
        id: REV,
        user_id: OWNER,
        workflow_id: WF,
        source_job_id: null,
        parent_revision_id: null,
        plan: { planType: "3d-scene", schemaVersion: 1, revisionId: REV },
        plan_sha256: "c".repeat(64),
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    scene3d_artifacts: [
      artifactRow(GLB, "glb", KEYS.glb, GLB_BYTES),
      artifactRow(BLEND, "blend-source", KEYS.blend, BLEND_BYTES),
      artifactRow(RECIPE, "source-json", KEYS.recipe, Buffer.from("{}")),
    ],
    scene3d_revision_artifacts: [
      { revision_id: REV, artifact_id: GLB, user_id: OWNER, usage: "playback" },
      { revision_id: REV, artifact_id: BLEND, user_id: OWNER, usage: "source" },
      { revision_id: REV, artifact_id: RECIPE, user_id: OWNER, usage: "checkpoint" },
    ],
  })
  app = await buildApp(true)
})

afterEach(async () => {
  await app.close()
})

const get = (url: string, userId: string | null, headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url, headers: { ...(userId ? { "x-user-id": userId } : {}), ...headers } })

describe("GET /v1/3d-scene/revisions/:revisionId", () => {
  it("requires a session", async () => {
    expect((await get(`/v1/3d-scene/revisions/${REV}`, null)).statusCode).toBe(401)
  })

  it("returns the manifest with opaque asset descriptors and no cacheable copy", async () => {
    const res = await get(`/v1/3d-scene/revisions/${REV}`, OWNER)
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store, private")

    const body = res.json()
    expect(body.revisionId).toBe(REV)
    expect(body.assets.map((asset: { assetId: string }) => asset.assetId).sort()).toEqual(
      [GLB, BLEND].sort(),
    )
    // The private recipe is not even mentioned, and no key ever leaves.
    expect(res.payload).not.toContain(RECIPE)
    expect(res.payload).not.toContain("object_key")
    expect(res.payload).not.toContain("scene3d/")
  })

  it("is a 404, not a 403, for a revision the caller may not reach", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("none")
    const res = await get(`/v1/3d-scene/revisions/${REV}`, VIEWER)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("still answers when the deployment has no private bucket", async () => {
    await app.close()
    app = await buildApp(false)
    expect((await get(`/v1/3d-scene/revisions/${REV}`, OWNER)).statusCode).toBe(200)
  })
})

describe("GET …/assets/:assetId", () => {
  it("streams the asset with its own content type and no caching", async () => {
    const res = await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, OWNER)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("model/gltf-binary")
    expect(res.headers["cache-control"]).toBe("no-store, private")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
    expect(res.rawPayload.equals(GLB_BYTES)).toBe(true)
    // The stream ended where it said it would: a truncated or over-long body
    // with a correct-looking header is the failure this catches.
    expect(res.rawPayload.length).toBe(Number(res.headers["content-length"]))
    expect(res.headers["accept-ranges"]).toBe("bytes")
  })

  it("honours a byte range", async () => {
    const res = await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, OWNER, {
      range: "bytes=0-15",
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers["content-range"]).toBe(`bytes 0-15/${GLB_BYTES.length}`)
    expect(res.rawPayload.length).toBe(Number(res.headers["content-length"]))
    expect(res.rawPayload.equals(GLB_BYTES.subarray(0, 16))).toBe(true)
  })

  it("serves the tail of the object for a suffix range", async () => {
    const res = await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, OWNER, {
      range: "bytes=-8",
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers["content-range"]).toBe(
      `bytes ${GLB_BYTES.length - 8}-${GLB_BYTES.length - 1}/${GLB_BYTES.length}`,
    )
    expect(res.rawPayload.equals(GLB_BYTES.subarray(GLB_BYTES.length - 8))).toBe(true)
  })

  it("refuses a range past the end rather than serving something else", async () => {
    const res = await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, OWNER, {
      range: "bytes=9999-",
    })
    expect(res.statusCode).toBe(416)
    expect(res.headers["content-range"]).toBe(`bytes */${GLB_BYTES.length}`)
  })

  it("never serves the private recipe", async () => {
    expect((await get(`/v1/3d-scene/revisions/${REV}/assets/${RECIPE}`, OWNER)).statusCode).toBe(404)
  })

  it("keeps the source file off the playback lane", async () => {
    expect((await get(`/v1/3d-scene/revisions/${REV}/assets/${BLEND}`, OWNER)).statusCode).toBe(404)
  })

  it("refuses to serve an object that was replaced after publication", async () => {
    objects[KEYS.glb] = { body: GLB_BYTES, etag: "someone-elses-tag" }
    const res = await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, OWNER)
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("scene_asset_unavailable")
  })

  it("404s when the bytes are gone", async () => {
    delete objects[KEYS.glb]
    expect((await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, OWNER)).statusCode).toBe(404)
  })

  it("says so honestly when storage is not configured", async () => {
    await app.close()
    app = await buildApp(false)
    const res = await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, OWNER)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("scene_storage_unconfigured")
  })
})

describe("GET …/source", () => {
  it("hands an editor the project as a download", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("edit")
    const res = await get(`/v1/3d-scene/revisions/${REV}/source`, VIEWER)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="scene-${REV}.blend"`)
    expect(res.headers["content-type"]).toBe("application/octet-stream")
    expect(res.rawPayload.equals(BLEND_BYTES)).toBe(true)
  })

  it("tells a viewer they may watch but not take", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("view")
    const res = await get(`/v1/3d-scene/revisions/${REV}/source`, VIEWER)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    // ...and the playback lane still works for them.
    expect((await get(`/v1/3d-scene/revisions/${REV}/assets/${GLB}`, VIEWER)).statusCode).toBe(200)
  })

  it("404s a revision that retained no source", async () => {
    const tables = (fake.current as ReturnType<typeof createFakeSupabase>).tables
    tables.scene3d_revision_artifacts = tables.scene3d_revision_artifacts.filter(
      (row) => row.artifact_id !== BLEND,
    )
    expect((await get(`/v1/3d-scene/revisions/${REV}/source`, OWNER)).statusCode).toBe(404)
  })
})
