import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"

/**
 * Publication: the only path from bytes to a scene.
 *
 * The property every test here defends is "nothing durable happens until
 * everything checks out". A publication that wrote the manifest first and
 * verified the assets afterwards would pass a happy-path test identically —
 * so most of these assert the NEGATIVE: the RPC was never called.
 */

const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))

vi.mock("@/lib/supabase.js", () => ({
  get supabase() {
    return fake.current as never
  },
}))

import {
  computeScene3DPlanV2ContentHash,
  type Scene3DCameraTrackV1,
  type Scene3DPlanV2,
} from "@nodaro/shared"
import { createFakeSupabase } from "./fake-supabase.js"
import { publishScene3DRevision, scene3DPlanDigest } from "../publish.js"
import { scene3DArtifactObjectKey } from "../object-keys.js"
import type { Scene3DObjectStore } from "../object-store.js"
import type { Scene3DArtifactPublishInput } from "../types.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const REV = "00000000-0000-4000-8000-000000000030"
const PRIOR_REV = "00000000-0000-4000-8000-000000000031"
const JOB = "00000000-0000-4000-8000-000000000050"
const GLB = "00000000-0000-4000-8000-0000000000a1"
const TRACK = "00000000-0000-4000-8000-0000000000a2"
const POSTER = "00000000-0000-4000-8000-0000000000a3"
const BLEND = "00000000-0000-4000-8000-0000000000a4"

const FPS = 24
const FRAMES = 24
const WIDTH = 640
const HEIGHT = 360

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex")

function glbBytes(size = 128): Buffer {
  const buffer = Buffer.alloc(size, 0x11)
  buffer.write("glTF", 0, "ascii")
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(size, 8)
  return buffer
}

const posterBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 0x22),
])
const blendBytes = Buffer.concat([Buffer.from("BLENDER-v500", "ascii"), Buffer.alloc(16, 0x33)])

function perspective(aspect: number, near = 0.1, far = 200): number[] {
  const top = near * Math.tan((35 * Math.PI) / 360)
  const height = 2 * top
  const width = height * aspect
  const matrix = new Array<number>(16).fill(0)
  matrix[0] = (2 * near) / width
  matrix[5] = (2 * near) / height
  matrix[10] = -(far + near) / (far - near)
  matrix[11] = -1
  matrix[14] = (-2 * far * near) / (far - near)
  return matrix
}

function cameraTrack(overrides: Partial<Scene3DCameraTrackV1> = {}): Scene3DCameraTrackV1 {
  return {
    format: "scene3d-camera-track",
    version: 1,
    frameStart: 0,
    frameCount: FRAMES,
    fps: FPS,
    samples: Array.from({ length: FRAMES }, () => ({
      position: [0, 1.5, 4] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      projectionMatrix: perspective(WIDTH / HEIGHT),
      near: 0.1,
      far: 200,
    })),
    ...overrides,
  }
}

function basePlan(assets: Scene3DPlanV2["assets"]): Scene3DPlanV2 {
  return {
    planType: "3d-scene",
    schemaVersion: 2,
    revisionId: REV,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    durationInFrames: FRAMES,
    units: "meters",
    upAxis: "Y",
    handedness: "right",
    objects: [
      {
        id: "e1",
        name: "Subject",
        role: "prop",
        visual: { kind: "asset", assetId: GLB, rootNodeId: "root" },
      },
    ],
    assets,
    cameraTrackAssetId: TRACK,
    shots: [{ id: "shot-1", startFrame: 0, endFrameExclusive: FRAMES }],
    lighting: {
      preset: "clay-studio-v1",
      ambientIntensity: 0.6,
      keyIntensity: 2.4,
      keyPosition: [4, 6, 3],
    },
    backgroundColor: "#101014",
    provenance: {
      engine: "blender-cloud",
      engineVersion: "1.0.0",
      recipeVersion: "1.0.0",
      compilerVersion: "1.0.0",
      exporterVersion: "1.0.0",
      rendererVersion: "1.0.0",
      contentHash: "0".repeat(64),
    },
  }
}

/** The smallest manifest the v1 schema accepts. v1 has no `assets` array at
 *  all, which is exactly why a v1 revision may not publish geometry. */
function planV1() {
  return {
    planType: "3d-scene" as const,
    schemaVersion: 1 as const,
    revisionId: REV,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    durationInFrames: FRAMES,
    backgroundColor: "#101014",
    camera: { position: [0, 1.5, 4], target: [0, 1, 0], focalLengthMm: 35, sensorWidthMm: 36 },
    objects: [
      {
        id: "o1",
        name: "Box",
        primitive: "box",
        dimensions: [1, 1, 1],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#22cc88",
      },
    ],
    lighting: { ambientIntensity: 0.6, keyIntensity: 2.4, keyPosition: [4, 6, 3] },
  }
}

interface Fixture {
  plan: Scene3DPlanV2
  artifacts: Scene3DArtifactPublishInput[]
  objects: Record<string, Buffer>
}

async function fixture(trackOverrides: Partial<Scene3DCameraTrackV1> = {}): Promise<Fixture> {
  const glb = glbBytes()
  const trackText = JSON.stringify(cameraTrack(trackOverrides))
  const track = Buffer.from(trackText, "utf8")

  const assets: Scene3DPlanV2["assets"] = [
    { assetId: GLB, kind: "glb", role: "entity-geometry", byteLength: glb.length, sha256: sha(glb) },
    {
      assetId: TRACK,
      kind: "camera-track-json",
      role: "camera-track",
      byteLength: track.length,
      sha256: sha(track),
    },
    {
      assetId: POSTER,
      kind: "poster",
      role: "poster",
      byteLength: posterBytes.length,
      sha256: sha(posterBytes),
    },
    {
      assetId: BLEND,
      kind: "blend-source",
      role: "source",
      byteLength: blendBytes.length,
      sha256: sha(blendBytes),
    },
  ]

  const plan = basePlan(assets)
  plan.provenance.contentHash = await computeScene3DPlanV2ContentHash(plan)

  const artifacts: Scene3DArtifactPublishInput[] = assets.map((ref) => ({
    artifactId: ref.assetId,
    kind: ref.kind,
    sha256: ref.sha256,
    byteLength: ref.byteLength,
  }))

  const objects: Record<string, Buffer> = {
    [scene3DArtifactObjectKey(OWNER, REV, GLB, "glb")]: glb,
    [scene3DArtifactObjectKey(OWNER, REV, TRACK, "camera-track-json")]: track,
    [scene3DArtifactObjectKey(OWNER, REV, POSTER, "poster")]: posterBytes,
    [scene3DArtifactObjectKey(OWNER, REV, BLEND, "blend-source")]: blendBytes,
  }
  return { plan, artifacts, objects }
}

function fakeStore(objects: Record<string, Buffer>) {
  const reads: string[] = []
  const store: Scene3DObjectStore & { reads: string[] } = {
    bucket: "private-scenes",
    reads,
    async get(objectKey) {
      reads.push(objectKey)
      const body = objects[objectKey]
      if (!body) throw new Error("NoSuchKey")
      return { body: Readable.from([body]), contentLength: body.length, etag: `tag-${objectKey}` }
    },
    async delete() {},
  }
  return store
}

let supabase: ReturnType<typeof createFakeSupabase>

beforeEach(() => {
  vi.clearAllMocks()
  supabase = createFakeSupabase({
    jobs: [{ id: JOB, user_id: OWNER, status: "processing" }],
  })
  supabase.rpc.mockResolvedValue({ data: "created", error: null })
  fake.current = supabase
})

describe("a complete publication", () => {
  it("verifies every byte, then writes the manifest, artifacts and pins in one call", async () => {
    const { plan, artifacts, objects } = await fixture()
    const store = fakeStore(objects)

    const result = await publishScene3DRevision(
      { revisionId: REV, userId: OWNER, workflowId: null, sourceJobId: JOB, plan, artifacts },
      { store },
    )

    expect(result.status).toBe("created")
    expect(store.reads).toHaveLength(4)

    const [name, payload] = supabase.rpc.mock.calls[0] as [string, { payload: Record<string, unknown> }]
    expect(name).toBe("scene3d_publish_revision")
    const rows = payload.payload.artifacts as Record<string, unknown>[]
    expect(rows.map((row) => row.usage).sort()).toEqual(["playback", "playback", "poster", "source"])
    // Keys are the platform's, not the caller's, and every row carries the
    // tag the store reported at receipt.
    expect(rows.every((row) => String(row.object_key).startsWith(`scene3d/${OWNER}/${REV}/`))).toBe(true)
    expect(rows.every((row) => String(row.etag).startsWith("tag-"))).toBe(true)
    expect(payload.payload.plan_sha256).toBe(scene3DPlanDigest(plan))
  })

  it("is idempotent when the queue delivers it twice", async () => {
    const { plan, artifacts, objects } = await fixture()
    supabase.rpc.mockResolvedValue({ data: "unchanged", error: null })

    const result = await publishScene3DRevision(
      { revisionId: REV, userId: OWNER, plan, artifacts },
      { store: fakeStore(objects) },
    )
    expect(result.status).toBe("unchanged")
  })

  it("hashes the manifest by content, not by key order", async () => {
    const { plan } = await fixture()
    const reordered = JSON.parse(JSON.stringify({ ...plan, planType: plan.planType }))
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse())
    expect(scene3DPlanDigest(shuffled)).toBe(scene3DPlanDigest(plan))
  })
})

describe("nothing durable happens when a check fails", () => {
  it("refuses a digest the bytes do not match, and never reaches the database", async () => {
    const { plan, artifacts, objects } = await fixture()
    const lying = artifacts.map((entry) =>
      entry.artifactId === GLB ? { ...entry, sha256: "b".repeat(64) } : entry,
    )
    // The manifest agrees with the lie, so only the BYTES can catch it.
    plan.assets = plan.assets.map((ref) =>
      ref.assetId === GLB ? { ...ref, sha256: "b".repeat(64) } : ref,
    )
    plan.provenance.contentHash = await computeScene3DPlanV2ContentHash(plan)

    await expect(
      publishScene3DRevision(
        { revisionId: REV, userId: OWNER, plan, artifacts: lying },
        { store: fakeStore(objects) },
      ),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("refuses a manifest that names bytes nobody published", async () => {
    const { plan, artifacts, objects } = await fixture()
    const missing = artifacts.filter((entry) => entry.artifactId !== POSTER)

    await expect(
      publishScene3DRevision(
        { revisionId: REV, userId: OWNER, plan, artifacts: missing },
        { store: fakeStore(objects) },
      ),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("refuses user-visible bytes the manifest never declared", async () => {
    const { plan, artifacts, objects } = await fixture()
    const extra: Scene3DArtifactPublishInput = {
      artifactId: "00000000-0000-4000-8000-0000000000b9",
      kind: "poster",
      sha256: sha(posterBytes),
      byteLength: posterBytes.length,
    }

    await expect(
      publishScene3DRevision(
        { revisionId: REV, userId: OWNER, plan, artifacts: [...artifacts, extra] },
        { store: fakeStore(objects) },
      ),
    ).rejects.toThrow(/does not declare it/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("refuses a manifest whose content hash does not describe it", async () => {
    const { plan, artifacts, objects } = await fixture()
    plan.provenance.contentHash = "f".repeat(64)
    const store = fakeStore(objects)

    await expect(
      publishScene3DRevision({ revisionId: REV, userId: OWNER, plan, artifacts }, { store }),
    ).rejects.toMatchObject({ code: "SCENE_PLAN_INVALID" })
    // Rejected before a single byte was fetched.
    expect(store.reads).toEqual([])
  })

  it("refuses a camera track that disagrees with the scene it ships with", async () => {
    const { plan, artifacts, objects } = await fixture({ fps: 30 })

    await expect(
      publishScene3DRevision(
        { revisionId: REV, userId: OWNER, plan, artifacts },
        { store: fakeStore(objects) },
      ),
    ).rejects.toThrow(/does not match the manifest/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("refuses an object key this platform did not grant", async () => {
    const { plan, artifacts, objects } = await fixture()
    const smuggled = artifacts.map((entry) =>
      entry.artifactId === GLB
        ? { ...entry, objectKey: `scene3d/${OTHER}/${REV}/${GLB}.glb` }
        : entry,
    )

    await expect(
      publishScene3DRevision(
        { revisionId: REV, userId: OWNER, plan, artifacts: smuggled },
        { store: fakeStore(objects) },
      ),
    ).rejects.toThrow(/did not grant/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("refuses a v1 scene that ships assets it has no way to reference", async () => {
    const glb = glbBytes()
    await expect(
      publishScene3DRevision(
        {
          revisionId: REV,
          userId: OWNER,
          plan: planV1(),
          artifacts: [{ artifactId: GLB, kind: "glb", sha256: sha(glb), byteLength: glb.length }],
        },
        { store: fakeStore({}) },
      ),
    ).rejects.toThrow(/v1 scene cannot publish a glb artifact/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("lets a v1 scene keep a poster, which it CAN carry", async () => {
    await publishScene3DRevision(
      {
        revisionId: REV,
        userId: OWNER,
        plan: planV1(),
        artifacts: [
          {
            artifactId: POSTER,
            kind: "poster",
            sha256: sha(posterBytes),
            byteLength: posterBytes.length,
          },
        ],
      },
      {
        store: fakeStore({
          [scene3DArtifactObjectKey(OWNER, REV, POSTER, "poster")]: posterBytes,
        }),
      },
    )
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })
})

describe("the parent job is checked where it cannot race", () => {
  it("hands the job to the transaction that writes the scene, rather than pre-reading it", async () => {
    const { plan, artifacts, objects } = await fixture()
    await publishScene3DRevision(
      { revisionId: REV, userId: OWNER, sourceJobId: JOB, plan, artifacts },
      { store: fakeStore(objects) },
    )

    const payload = (supabase.rpc.mock.calls[0][1] as { payload: Record<string, unknown> }).payload
    expect(payload.source_job_id).toBe(JOB)
    // The status is read under a row lock inside the RPC; reading it here
    // first would leave a window for a cancellation to commit in between.
    expect(supabase.from).not.toHaveBeenCalledWith("jobs")
  })
})

describe("reusing a prior revision's immutable bytes", () => {
  it("pins them without re-reading, when the same owner still retains them", async () => {
    const { plan, artifacts, objects } = await fixture()
    const glb = objects[scene3DArtifactObjectKey(OWNER, REV, GLB, "glb")]
    supabase.tables.scene3d_revision_artifacts.push({
      revision_id: PRIOR_REV,
      artifact_id: GLB,
      user_id: OWNER,
      usage: "playback",
    })
    supabase.tables.scene3d_artifacts.push({
      id: GLB,
      user_id: OWNER,
      kind: "glb",
      bucket: "private-scenes",
      object_key: `scene3d/${OWNER}/${PRIOR_REV}/${GLB}.glb`,
      sha256: sha(glb),
      byte_length: glb.length,
      etag: "original-tag",
      expires_at: null,
      created_at: "2026-01-01T00:00:00Z",
    })

    const reusing = artifacts.map((entry) =>
      entry.artifactId === GLB ? { ...entry, reuseFromRevisionId: PRIOR_REV } : entry,
    )
    const store = fakeStore(objects)
    await publishScene3DRevision(
      { revisionId: REV, userId: OWNER, plan, artifacts: reusing },
      { store },
    )

    // Three reads, not four: the reused bytes were already verified once, and
    // are immutable, so re-hashing them would be ceremony.
    expect(store.reads).toHaveLength(3)
    const rows = (supabase.rpc.mock.calls[0][1] as { payload: { artifacts: Record<string, unknown>[] } })
      .payload.artifacts
    const reused = rows.find((row) => row.artifact_id === GLB)
    expect(reused).toMatchObject({
      reuse: true,
      object_key: `scene3d/${OWNER}/${PRIOR_REV}/${GLB}.glb`,
      etag: "original-tag",
    })
  })

  it("refuses to pin bytes that belong to another account", async () => {
    const { plan, artifacts, objects } = await fixture()
    // The artifact exists and is pinned — by somebody else.
    supabase.tables.scene3d_revision_artifacts.push({
      revision_id: PRIOR_REV,
      artifact_id: GLB,
      user_id: OTHER,
      usage: "playback",
    })
    supabase.tables.scene3d_artifacts.push({
      id: GLB,
      user_id: OTHER,
      kind: "glb",
      bucket: "private-scenes",
      object_key: "somewhere",
      sha256: "a".repeat(64),
      byte_length: 1,
      etag: "t",
      expires_at: null,
      created_at: "2026-01-01T00:00:00Z",
    })

    const reusing = artifacts.map((entry) =>
      entry.artifactId === GLB ? { ...entry, reuseFromRevisionId: PRIOR_REV } : entry,
    )
    await expect(
      publishScene3DRevision(
        { revisionId: REV, userId: OWNER, plan, artifacts: reusing },
        { store: fakeStore(objects) },
      ),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe("reservations", () => {
  it("passes the caller's strictness through to the transaction", async () => {
    const { plan, artifacts, objects } = await fixture()
    await publishScene3DRevision(
      { revisionId: REV, userId: OWNER, plan, artifacts, requireIntents: true },
      { store: fakeStore(objects) },
    )
    const payload = (supabase.rpc.mock.calls[0][1] as { payload: Record<string, unknown> }).payload
    expect(payload.require_intents).toBe(true)
  })

  it("refuses to publish a digest that differs from the bytes we received", async () => {
    const { plan, artifacts, objects } = await fixture()
    // The reservation recorded what the platform itself hashed; the manifest
    // and the producer agree with each other on something else.
    supabase.tables.scene3d_upload_intents.push({
      artifact_id: POSTER,
      user_id: OWNER,
      job_id: JOB,
      revision_id: REV,
      kind: "poster",
      bucket: "private-scenes",
      object_key: scene3DArtifactObjectKey(OWNER, REV, POSTER, "poster"),
      expires_at: "2026-01-01T00:00:00Z",
      collect_after: "2026-01-01T01:00:00Z",
      received_at: "2026-01-01T00:00:00Z",
      receipt_sha256: "e".repeat(64),
      receipt_byte_length: 4,
      receipt_etag: "recorded",
    })

    await expect(
      publishScene3DRevision(
        { revisionId: REV, userId: OWNER, plan, artifacts },
        { store: fakeStore(objects) },
      ),
    ).rejects.toThrow(/does not match the bytes that were received/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe("the database's verdicts become codes a caller can act on", () => {
  const cases: Array<[string, string]> = [
    ["55010", "SCENE_REVISION_CONFLICT"],
    ["55012", "SCENE_REVISION_CONFLICT"],
    ["55011", "SCENE_ASSET_INVALID"],
    ["55013", "SCENE_ASSET_MISSING"],
    ["55014", "SCENE_ASSET_INVALID"],
    ["23503", "SCENE_ASSET_INVALID"],
    ["23514", "SCENE_PLAN_INVALID"],
    ["55016", "SCENE_JOB_INVALID"],
    ["55017", "SCENE_REVISION_CONFLICT"],
    ["55018", "SCENE_ASSET_MISSING"],
    ["08006", "SCENE_STORAGE_FAILED"],
  ]

  for (const [sqlstate, code] of cases) {
    it(`maps ${sqlstate} to ${code}`, async () => {
      const { plan, artifacts, objects } = await fixture()
      supabase.rpc.mockResolvedValue({ data: null, error: { code: sqlstate, message: "nope" } })

      await expect(
        publishScene3DRevision(
          { revisionId: REV, userId: OWNER, plan, artifacts },
          { store: fakeStore(objects) },
        ),
      ).rejects.toMatchObject({ code })
    })
  }
})
