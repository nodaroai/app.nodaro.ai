import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"

/**
 * The byte layer: what a key may be, what is checked at receipt, what is
 * checked again at read time, and what cleanup is allowed to delete.
 *
 * Everything here is about the gap between "the producer said so" and "we
 * looked". The producer holds write credentials to the key we granted, so the
 * digest in the row is a claim until this module verifies it, and the object
 * behind that digest can still be replaced afterwards — which is why the read
 * path re-checks the tag before it writes a header.
 */

const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))

vi.mock("@/lib/supabase.js", () => ({
  get supabase() {
    return fake.current as never
  },
}))

import { createFakeSupabase } from "./fake-supabase.js"
import { assertScene3DArtifactObjectKey, scene3DArtifactObjectKey } from "../object-keys.js"
import { verifyScene3DArtifactBytes, SCENE3D_JSON_RECEIPT_MAX_BYTES } from "../receipt.js"
import {
  openScene3DArtifactStream,
  parseScene3DRange,
  scene3DRevisionAssetDescriptors,
} from "../read.js"
import { runScene3DArtifactGcBatch, sweepExpiredScene3DArtifacts } from "../gc.js"
import { resolveScene3DPrivateStorageConfig, type Scene3DObjectStore } from "../object-store.js"
import { Scene3DArtifactError, type Scene3DPinnedArtifact } from "../types.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const REV = "00000000-0000-4000-8000-000000000030"
const ART = "00000000-0000-4000-8000-000000000040"

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex")

/** A syntactically real GLB of `size` bytes. */
function glb(size: number): Buffer {
  const buffer = Buffer.alloc(size, 0x11)
  buffer.write("glTF", 0, "ascii")
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(size, 8)
  return buffer
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 0x22),
])

interface FakeObject {
  body: Buffer
  etag?: string | null
  /** Override the length the store REPORTS, without changing the bytes. */
  reportedLength?: number | null
}

function fakeStore(objects: Record<string, FakeObject>, bucket = "private-scenes") {
  const deleted: string[] = []
  const store: Scene3DObjectStore & { deleted: string[]; failDelete?: boolean } = {
    bucket,
    deleted,
    async get(objectKey, range) {
      const object = objects[objectKey]
      if (!object) throw new Error("NoSuchKey")
      const body = range ? object.body.subarray(range.start, range.endInclusive + 1) : object.body
      return {
        body: Readable.from([body]),
        contentLength:
          object.reportedLength === undefined ? body.length : object.reportedLength,
        etag: object.etag === undefined ? "live-tag" : object.etag,
      }
    },
    async delete(objectKey) {
      if (store.failDelete) throw new Error("delete failed")
      deleted.push(objectKey)
    },
  }
  return store
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.current = createFakeSupabase()
})

describe("object keys are derived, never accepted", () => {
  it("puts the owner and the revision in the path and the kind in the suffix", () => {
    expect(scene3DArtifactObjectKey(OWNER, REV, ART, "glb")).toBe(
      `scene3d/${OWNER}/${REV}/${ART}.glb`,
    )
    expect(scene3DArtifactObjectKey(OWNER, REV, ART, "blend-source")).toBe(
      `scene3d/${OWNER}/${REV}/${ART}.blend`,
    )
  })

  it("refuses anything that is not a UUID, so no segment can be smuggled in", () => {
    expect(() => scene3DArtifactObjectKey("../etc", REV, ART, "glb")).toThrow(Scene3DArtifactError)
    expect(() => scene3DArtifactObjectKey(OWNER, REV, "a/b", "glb")).toThrow(Scene3DArtifactError)
  })

  it("accepts a claimed key only when it is byte-identical to the derived one", () => {
    const derived = scene3DArtifactObjectKey(OWNER, REV, ART, "glb")
    expect(assertScene3DArtifactObjectKey(derived, OWNER, REV, ART, "glb")).toBe(derived)
    expect(() =>
      // Same owner, same prefix, different revision — still refused, or a
      // publication could overwrite another revision of its own manifest.
      assertScene3DArtifactObjectKey(
        `scene3d/${OWNER}/00000000-0000-4000-8000-0000000000aa/${ART}.glb`,
        OWNER,
        REV,
        ART,
        "glb",
      ),
    ).toThrow(/did not grant/)
  })
})

describe("receipt: the bytes have to be the bytes", () => {
  const key = `scene3d/${OWNER}/${REV}/${ART}.glb`

  it("accepts a matching object and records the store's tag", async () => {
    const body = glb(64)
    const store = fakeStore({ [key]: { body, etag: "abc" } })
    const receipt = await verifyScene3DArtifactBytes(store, key, {
      kind: "glb",
      sha256: sha(body),
      byteLength: 64,
    })
    expect(receipt.etag).toBe("abc")
  })

  it("invents a tag only when the store reports none, and marks it as invented", async () => {
    const body = glb(64)
    const store = fakeStore({ [key]: { body, etag: null } })
    const receipt = await verifyScene3DArtifactBytes(store, key, {
      kind: "glb",
      sha256: sha(body),
      byteLength: 64,
    })
    expect(receipt.etag).toBe(`sha256:${sha(body)}`)
  })

  it("refuses a digest that does not describe the bytes", async () => {
    const store = fakeStore({ [key]: { body: glb(64) } })
    await expect(
      verifyScene3DArtifactBytes(store, key, { kind: "glb", sha256: "b".repeat(64), byteLength: 64 }),
    ).rejects.toThrow(/do not match the digest/)
  })

  it("cuts off a producer that serves more than it declared", async () => {
    const body = glb(64)
    // Declares 32 bytes, stores 64, and lies about the reported length too.
    const store = fakeStore({ [key]: { body, reportedLength: null } })
    await expect(
      verifyScene3DArtifactBytes(store, key, { kind: "glb", sha256: sha(body), byteLength: 32 }),
    ).rejects.toThrow(/larger than the 32 bytes/)
  })

  it("refuses when the store's own length disagrees with the declaration", async () => {
    const body = glb(64)
    const store = fakeStore({ [key]: { body, reportedLength: 99 } })
    await expect(
      verifyScene3DArtifactBytes(store, key, { kind: "glb", sha256: sha(body), byteLength: 64 }),
    ).rejects.toThrow(/private storage holds/)
  })

  it("says so when the object is not there at all", async () => {
    const store = fakeStore({})
    await expect(
      verifyScene3DArtifactBytes(store, key, { kind: "glb", sha256: "a".repeat(64), byteLength: 1 }),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })

  it("checks the file is the KIND it claims to be", async () => {
    const notGlb = Buffer.alloc(64, 0x41)
    const store = fakeStore({ [key]: { body: notGlb } })
    await expect(
      verifyScene3DArtifactBytes(store, key, { kind: "glb", sha256: sha(notGlb), byteLength: 64 }),
    ).rejects.toThrow(/not a binary glTF/)

    const posterKey = `scene3d/${OWNER}/${REV}/${ART}.png`
    const notPng = Buffer.alloc(32, 0x41)
    const posterStore = fakeStore({ [posterKey]: { body: notPng } })
    await expect(
      verifyScene3DArtifactBytes(posterStore, posterKey, {
        kind: "poster",
        sha256: sha(notPng),
        byteLength: 32,
      }),
    ).rejects.toThrow(/not a PNG/)
    await expect(
      verifyScene3DArtifactBytes(fakeStore({ [posterKey]: { body: PNG } }), posterKey, {
        kind: "poster",
        sha256: sha(PNG),
        byteLength: PNG.length,
      }),
    ).resolves.toBeTruthy()
  })

  it("refuses a GLB whose own header disagrees with its length", async () => {
    const body = glb(64)
    body.writeUInt32LE(999, 8)
    const store = fakeStore({ [key]: { body } })
    await expect(
      verifyScene3DArtifactBytes(store, key, { kind: "glb", sha256: sha(body), byteLength: 64 }),
    ).rejects.toThrow(/GLB header declares/)
  })

  it("refuses JSON that will not parse, and JSON too large to parse safely", async () => {
    const jsonKey = `scene3d/${OWNER}/${REV}/${ART}.camera.json`
    const broken = Buffer.from("{not json", "utf8")
    await expect(
      verifyScene3DArtifactBytes(fakeStore({ [jsonKey]: { body: broken } }), jsonKey, {
        kind: "camera-track-json",
        sha256: sha(broken),
        byteLength: broken.length,
      }),
    ).rejects.toThrow(/not valid JSON/)

    await expect(
      verifyScene3DArtifactBytes(fakeStore({}), jsonKey, {
        kind: "camera-track-json",
        sha256: "a".repeat(64),
        byteLength: SCENE3D_JSON_RECEIPT_MAX_BYTES + 1,
      }),
    ).rejects.toThrow(/the limit is/)
  })
})

describe("range parsing", () => {
  it("reads the three forms a client actually sends", () => {
    expect(parseScene3DRange("bytes=0-99", 1000)).toEqual({
      kind: "range",
      start: 0,
      endInclusive: 99,
    })
    expect(parseScene3DRange("bytes=500-", 1000)).toEqual({
      kind: "range",
      start: 500,
      endInclusive: 999,
    })
    expect(parseScene3DRange("bytes=-100", 1000)).toEqual({
      kind: "range",
      start: 900,
      endInclusive: 999,
    })
  })

  it("clamps an over-long end rather than reading past the object", () => {
    expect(parseScene3DRange("bytes=0-99999", 10)).toEqual({
      kind: "range",
      start: 0,
      endInclusive: 9,
    })
  })

  it("treats nonsense as absent and out-of-bounds as unsatisfiable", () => {
    expect(parseScene3DRange("rows=1-2", 10)).toEqual({ kind: "none" })
    expect(parseScene3DRange("bytes=abc", 10)).toEqual({ kind: "none" })
    expect(parseScene3DRange(undefined, 10)).toEqual({ kind: "none" })
    expect(parseScene3DRange("bytes=50-60", 10)).toEqual({ kind: "unsatisfiable" })
    expect(parseScene3DRange("bytes=5-1", 10)).toEqual({ kind: "unsatisfiable" })
  })
})

describe("read: the object is compared with the row before a header is written", () => {
  const body = glb(64)
  const key = `scene3d/${OWNER}/${REV}/${ART}.glb`
  const pinned: Scene3DPinnedArtifact = {
    artifactId: ART,
    userId: OWNER,
    kind: "glb",
    bucket: "private-scenes",
    objectKey: key,
    sha256: sha(body),
    byteLength: 64,
    etag: "live-tag",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    usage: "playback",
  }

  const drain = async (stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  }

  it("streams the whole object with its declared type", async () => {
    const store = fakeStore({ [key]: { body } })
    const stream = await openScene3DArtifactStream(store, pinned, { kind: "none" })
    expect(stream.status).toBe(200)
    expect(stream.contentType).toBe("model/gltf-binary")
    expect(stream.contentLength).toBe(64)
    expect((await drain(stream.body)).equals(body)).toBe(true)
  })

  it("answers a range with 206 and an honest Content-Range", async () => {
    const store = fakeStore({ [key]: { body } })
    const stream = await openScene3DArtifactStream(store, pinned, {
      kind: "range",
      start: 10,
      endInclusive: 19,
    })
    expect(stream.status).toBe(206)
    expect(stream.contentRange).toBe("bytes 10-19/64")
    expect((await drain(stream.body)).length).toBe(10)
  })

  it("refuses to serve an object that was replaced after publication", async () => {
    const store = fakeStore({ [key]: { body, etag: "somebody-elses-tag" } })
    await expect(
      openScene3DArtifactStream(store, pinned, { kind: "none" }),
    ).rejects.toThrow(/has been replaced/)
  })

  it("does not pretend to check a tag it invented", async () => {
    const store = fakeStore({ [key]: { body, etag: "whatever" } })
    const synthetic = { ...pinned, etag: `sha256:${pinned.sha256}` }
    await expect(
      openScene3DArtifactStream(store, synthetic, { kind: "none" }),
    ).resolves.toBeTruthy()
  })

  it("refuses when the stored length no longer matches the row", async () => {
    const store = fakeStore({ [key]: { body, reportedLength: 12 } })
    await expect(
      openScene3DArtifactStream(store, pinned, { kind: "none" }),
    ).rejects.toThrow(/recorded length/)
  })

  it("refuses to read a recorded bucket this process is not configured for", async () => {
    const store = fakeStore({ [key]: { body } }, "some-other-bucket")
    await expect(
      openScene3DArtifactStream(store, pinned, { kind: "none" }),
    ).rejects.toThrow(/not configured for/)
  })
})

describe("the manifest lists opaque ids only", () => {
  it("describes the user-visible assets and omits the private ones", async () => {
    fake.current = createFakeSupabase({
      scene3d_revision_artifacts: [
        { revision_id: REV, artifact_id: "a1", user_id: OWNER, usage: "playback" },
        { revision_id: REV, artifact_id: "a2", user_id: OWNER, usage: "checkpoint" },
      ],
      scene3d_artifacts: [
        {
          id: "a1",
          user_id: OWNER,
          kind: "glb",
          bucket: "private-scenes",
          object_key: "scene3d/secret/path.glb",
          sha256: "a".repeat(64),
          byte_length: 10,
          etag: "t",
          expires_at: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "a2",
          user_id: OWNER,
          kind: "source-json",
          bucket: "private-scenes",
          object_key: "scene3d/secret/recipe.json",
          sha256: "b".repeat(64),
          byte_length: 10,
          etag: "t",
          expires_at: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    })

    const assets = await scene3DRevisionAssetDescriptors(REV)
    expect(assets).toEqual([
      { assetId: "a1", kind: "glb", usage: "playback", byteLength: 10, sha256: "a".repeat(64) },
    ])
    expect(JSON.stringify(assets)).not.toContain("secret")
  })
})

describe("cleanup never outruns the pins", () => {
  it("deletes the object, then resolves the task without erasing the tombstone", async () => {
    const supabase = createFakeSupabase({
      scene3d_artifact_gc: [{ artifact_id: ART, bucket: "private-scenes", object_key: "k1" }],
    })
    supabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "scene3d_claim_artifact_gc"
          ? {
              data: [{ artifact_id: ART, bucket: "private-scenes", object_key: "k1", attempts: 1 }],
              error: null,
            }
          : { data: true, error: null },
      ),
    )
    fake.current = supabase
    const store = fakeStore({})

    expect(await runScene3DArtifactGcBatch(store, { limit: 10 })).toEqual({
      claimed: 1,
      deleted: 1,
      skipped: 0,
      failed: 0,
    })
    expect(store.deleted).toEqual(["k1"])
    // The row survives: it is what retires the artifact id, so nothing can
    // reserve or publish it after cleanup has claimed it.
    expect(supabase.rpc).toHaveBeenCalledWith("scene3d_complete_artifact_gc", {
      p_artifact_id: ART,
    })
    expect(supabase.tables.scene3d_artifact_gc).toHaveLength(1)
  })

  it("leaves the task when the object delete fails, so the next pass retries", async () => {
    const supabase = createFakeSupabase({
      scene3d_artifact_gc: [{ artifact_id: ART, bucket: "private-scenes", object_key: "k1" }],
    })
    supabase.rpc.mockResolvedValue({
      data: [{ artifact_id: ART, bucket: "private-scenes", object_key: "k1", attempts: 1 }],
      error: null,
    })
    fake.current = supabase
    const store = fakeStore({})
    store.failDelete = true

    expect(await runScene3DArtifactGcBatch(store)).toMatchObject({ deleted: 0, failed: 1 })
    expect(supabase.rpc).not.toHaveBeenCalledWith("scene3d_complete_artifact_gc", expect.anything())
  })

  it("will not delete from a bucket it does not own", async () => {
    const supabase = createFakeSupabase({
      scene3d_artifact_gc: [{ artifact_id: ART, bucket: "nodaro-assets", object_key: "videos/x.mp4" }],
    })
    supabase.rpc.mockResolvedValue({
      data: [{ artifact_id: ART, bucket: "nodaro-assets", object_key: "videos/x.mp4", attempts: 1 }],
      error: null,
    })
    fake.current = supabase
    const store = fakeStore({})

    expect(await runScene3DArtifactGcBatch(store)).toMatchObject({ skipped: 1, deleted: 0 })
    expect(store.deleted).toEqual([])
    expect(supabase.rpc).not.toHaveBeenCalledWith("scene3d_complete_artifact_gc", expect.anything())
  })

  it("asks the database to do the pin-aware sweep, not the worker", async () => {
    const supabase = createFakeSupabase()
    supabase.rpc.mockResolvedValue({ data: 3, error: null })
    fake.current = supabase

    expect(await sweepExpiredScene3DArtifacts({ limit: 25 })).toBe(3)
    expect(supabase.rpc).toHaveBeenCalledWith("scene3d_sweep_expired_artifacts", { max_rows: 25 })
  })
})

describe("private storage configuration", () => {
  it("is off, not broken, when no private bucket is named", () => {
    expect(resolveScene3DPrivateStorageConfig({}, "nodaro-assets")).toBeNull()
  })

  it("refuses to be the public bucket", () => {
    expect(() =>
      resolveScene3DPrivateStorageConfig(
        { SCENE3D_PRIVATE_BUCKET: "nodaro-assets" },
        "nodaro-assets",
      ),
    ).toThrow(/must not be the public media bucket/)
  })

  it("refuses to be half-configured rather than falling back silently", () => {
    expect(() =>
      resolveScene3DPrivateStorageConfig({ SCENE3D_PRIVATE_BUCKET: "scenes" }, "nodaro-assets"),
    ).toThrow(/credentials or endpoint/)
  })

  it("falls back to the global R2 credentials with its own bucket", () => {
    const cfg = resolveScene3DPrivateStorageConfig(
      {
        SCENE3D_PRIVATE_BUCKET: "scenes",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_ACCOUNT_ID: "acct",
      },
      "nodaro-assets",
    )
    expect(cfg).toMatchObject({
      bucket: "scenes",
      endpoint: "https://acct.r2.cloudflarestorage.com",
      region: "auto",
      forcePathStyle: false,
    })
  })
})
