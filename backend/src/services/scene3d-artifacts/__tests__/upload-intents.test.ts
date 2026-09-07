import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"

/**
 * Reservations exist so bytes from a build that never published are still
 * something the database knows about.
 *
 * The lifetime rules themselves (retirement, re-grant, single receipt) are
 * enforced in one SQL transaction and proved in `scene3d-artifacts.behavior.sql`
 * — locks and orderings are not testable against a fake. What is tested here is
 * the half that lives in TypeScript: the key a reservation is bound to, the
 * digest being the platform's own rather than the producer's, the refusals
 * before the round trip, and that a failure is never dressed up as a receipt.
 */

const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))

vi.mock("@/lib/supabase.js", () => ({
  get supabase() {
    return fake.current as never
  },
}))

import { createFakeSupabase } from "./fake-supabase.js"
import { receiveScene3DUpload, reserveScene3DUploadIntent } from "../upload-intents.js"
import { sweepExpiredScene3DUploadIntents } from "../gc.js"
import { scene3DArtifactObjectKey } from "../object-keys.js"
import type { Scene3DObjectStore } from "../object-store.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const REV = "00000000-0000-4000-8000-000000000030"
const JOB = "00000000-0000-4000-8000-000000000050"
const ART = "00000000-0000-4000-8000-0000000000a1"

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex")

function glbBytes(size = 64): Buffer {
  const buffer = Buffer.alloc(size, 0x11)
  buffer.write("glTF", 0, "ascii")
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(size, 8)
  return buffer
}

const GLB = glbBytes()
const KEY = scene3DArtifactObjectKey(OWNER, REV, ART, "glb")

let objects: Record<string, Buffer>

function fakeStore(bucket = "private-scenes"): Scene3DObjectStore {
  return {
    bucket,
    async get(objectKey) {
      const body = objects[objectKey]
      if (!body) throw new Error("NoSuchKey")
      return { body: Readable.from([body]), contentLength: body.length, etag: "live-tag" }
    },
    async delete() {},
  }
}

/** The row the reserve RPC would return for a given payload. */
function reservedRow(payload: Record<string, unknown>, receipt?: Record<string, unknown>) {
  return {
    artifact_id: payload.artifact_id,
    user_id: payload.user_id,
    job_id: payload.job_id ?? null,
    revision_id: payload.revision_id,
    kind: payload.kind,
    bucket: payload.bucket,
    object_key: payload.object_key,
    expires_at: payload.expires_at,
    collect_after: payload.collect_after,
    received_at: null,
    receipt_sha256: null,
    receipt_byte_length: null,
    receipt_etag: null,
    ...receipt,
  }
}

let supabase: ReturnType<typeof createFakeSupabase>

const reservation = {
  artifactId: ART,
  userId: OWNER,
  revisionId: REV,
  kind: "glb" as const,
  jobId: JOB,
}

beforeEach(() => {
  vi.clearAllMocks()
  objects = { [KEY]: GLB }
  supabase = createFakeSupabase()
  fake.current = supabase
})

describe("reserving an upload", () => {
  it("binds the reservation to the key this platform derives, in one round trip", async () => {
    supabase.rpc.mockImplementation((_name: string, args: { payload: Record<string, unknown> }) =>
      Promise.resolve({ data: reservedRow(args.payload), error: null }),
    )

    const intent = await reserveScene3DUploadIntent(fakeStore(), reservation)

    const [name, args] = supabase.rpc.mock.calls[0] as [string, { payload: Record<string, unknown> }]
    expect(name).toBe("scene3d_reserve_upload")
    expect(args.payload).toMatchObject({
      artifact_id: ART,
      user_id: OWNER,
      job_id: JOB,
      revision_id: REV,
      kind: "glb",
      bucket: "private-scenes",
      object_key: KEY,
    })
    // The grace period is after expiry, never before it.
    expect(Date.parse(args.payload.collect_after as string)).toBeGreaterThan(
      Date.parse(args.payload.expires_at as string),
    )
    expect(intent.objectKey).toBe(KEY)
    expect(intent.receipt).toBeNull()
  })

  it("reports a retired id as retired, so a caller mints a new one instead of retrying", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "55019", message: "artifact is retired" },
    })
    await expect(reserveScene3DUploadIntent(fakeStore(), reservation)).rejects.toMatchObject({
      code: "SCENE_ASSET_RETIRED",
    })
  })

  it("reports a reservation taken by another job as a conflict", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "55021", message: "already reserved for different bytes" },
    })
    await expect(reserveScene3DUploadIntent(fakeStore(), reservation)).rejects.toMatchObject({
      code: "SCENE_REVISION_CONFLICT",
    })
  })

  it("refuses ids, kinds and windows it cannot honour, without asking the database", async () => {
    const store = fakeStore()
    await expect(
      reserveScene3DUploadIntent(store, { ...reservation, artifactId: "nope" }),
    ).rejects.toThrow(/UUID/)
    await expect(
      reserveScene3DUploadIntent(store, { ...reservation, kind: "exe" as never }),
    ).rejects.toThrow(/unknown artifact kind/)
    await expect(
      reserveScene3DUploadIntent(store, { ...reservation, ttlSeconds: 99_999 }),
    ).rejects.toThrow(/out of range/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe("receiving the uploaded bytes", () => {
  function reserved(receipt?: Record<string, unknown>) {
    supabase.tables.scene3d_upload_intents.push(
      reservedRow(
        {
          artifact_id: ART,
          user_id: OWNER,
          job_id: JOB,
          revision_id: REV,
          kind: "glb",
          bucket: "private-scenes",
          object_key: KEY,
          expires_at: "2026-01-01T00:15:00Z",
          collect_after: "2026-01-01T01:15:00Z",
        },
        receipt,
      ),
    )
  }

  it("records the digest it computed itself, in the scope the bytes were reserved under", async () => {
    reserved()
    supabase.rpc.mockImplementation((_name: string, args: { payload: Record<string, unknown> }) =>
      Promise.resolve({
        data: reservedRow(
          { ...args.payload, expires_at: "2026-01-01T00:15:00Z", collect_after: "2026-01-01T01:15:00Z" },
          {
            received_at: "2026-01-01T00:05:00Z",
            receipt_sha256: args.payload.sha256,
            receipt_byte_length: args.payload.byte_length,
            receipt_etag: args.payload.etag,
          },
        ),
        error: null,
      }),
    )

    const receipt = await receiveScene3DUpload(fakeStore(), { artifactId: ART, userId: OWNER })

    const [name, args] = supabase.rpc.mock.calls[0] as [string, { payload: Record<string, unknown> }]
    expect(name).toBe("scene3d_record_upload_receipt")
    expect(args.payload).toMatchObject({
      artifact_id: ART,
      user_id: OWNER,
      kind: "glb",
      bucket: "private-scenes",
      object_key: KEY,
      sha256: sha(GLB),
      byte_length: GLB.length,
    })
    expect(receipt).toMatchObject({ sha256: sha(GLB), byteLength: GLB.length, etag: "live-tag" })
  })

  it("fails when the reservation is gone, rather than inventing a receipt", async () => {
    reserved()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "55023", message: "no upload reservation" },
    })
    await expect(
      receiveScene3DUpload(fakeStore(), { artifactId: ART, userId: OWNER }),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })

  it("reports bytes that changed after the first receipt as a conflict", async () => {
    reserved()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "55024", message: "changed after it was received" },
    })
    await expect(
      receiveScene3DUpload(fakeStore(), { artifactId: ART, userId: OWNER }),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
  })

  it("refuses to call a stored row without a receipt a receipt", async () => {
    reserved()
    supabase.rpc.mockImplementation((_name: string, args: { payload: Record<string, unknown> }) =>
      Promise.resolve({ data: reservedRow({ ...args.payload, expires_at: "x", collect_after: "x" }), error: null }),
    )
    await expect(
      receiveScene3DUpload(fakeStore(), { artifactId: ART, userId: OWNER }),
    ).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED" })
  })

  it("refuses an object that is not the kind that was reserved", async () => {
    reserved()
    objects[KEY] = Buffer.alloc(64, 0x41)
    await expect(
      receiveScene3DUpload(fakeStore(), { artifactId: ART, userId: OWNER }),
    ).rejects.toThrow(/not a binary glTF/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("refuses an empty object rather than recording a digest for nothing", async () => {
    reserved()
    objects[KEY] = Buffer.alloc(0)
    await expect(
      receiveScene3DUpload(fakeStore(), { artifactId: ART, userId: OWNER }),
    ).rejects.toThrow(/empty/)
  })

  it("has nothing to receive without a reservation", async () => {
    await expect(
      receiveScene3DUpload(fakeStore(), { artifactId: ART, userId: OWNER }),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })

  it("will not read a reservation's bytes out of a different bucket", async () => {
    reserved()
    await expect(
      receiveScene3DUpload(fakeStore("some-other-bucket"), { artifactId: ART, userId: OWNER }),
    ).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED" })
  })

  it("does not hand one owner's reservation to another", async () => {
    reserved()
    await expect(
      receiveScene3DUpload(fakeStore(), {
        artifactId: ART,
        userId: "00000000-0000-4000-8000-0000000000ff",
      }),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })
})

describe("sweeping abandoned uploads", () => {
  it("asks the database, which is where the publication race is resolved", async () => {
    supabase.rpc.mockResolvedValue({ data: 2, error: null })
    expect(await sweepExpiredScene3DUploadIntents({ limit: 25 })).toBe(2)
    expect(supabase.rpc).toHaveBeenCalledWith("scene3d_sweep_expired_upload_intents", {
      max_rows: 25,
    })
  })
})
