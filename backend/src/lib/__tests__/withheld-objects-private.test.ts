import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// A content policy's withheld files on a deployment that deletes nothing
// (lib/withheld-objects-private.ts). With STORAGE_DELETES=skip the job-policy
// path keeps a withheld job's own files, and where objects are public by
// their own ACL (STORAGE_OBJECT_ACL set) makes each one private instead.
// Elsewhere — a bucket policy, a store with no object ACLs such as R2 — it
// changes nothing. With deletes on it is inert. Run through the REAL
// job-policy path, the REAL funnel and the REAL storage helpers; only the
// storage SDK, the hold and the database are fakes.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => {
  const config: Record<string, unknown> = {
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET_NAME: "test-bucket",
    R2_PUBLIC_URL: "https://media.test",
    EDITION: "cloud",
    STORAGE_DELETES: "on",
    STORAGE_OBJECT_ACL: "",
  }
  /** Every storage command built, by class name, with its input. */
  const built: Array<{ command: string; input: Record<string, unknown> }> = []
  const send = vi.fn()
  const heldAmong = vi.fn()
  const from = vi.fn(() => ({ upsert: vi.fn(async () => ({ data: null, error: null })) }))
  return { config, built, send, heldAmong, from }
})

vi.mock("@aws-sdk/client-s3", () => {
  const command = (name: string) =>
    class {
      input: Record<string, unknown>
      constructor(input: Record<string, unknown>) {
        this.input = input
        m.built.push({ command: name, input })
      }
    }
  return {
    S3Client: class {
      send = m.send
    },
    GetObjectCommand: command("GetObjectCommand"),
    PutObjectCommand: command("PutObjectCommand"),
    PutObjectAclCommand: command("PutObjectAclCommand"),
    DeleteObjectCommand: command("DeleteObjectCommand"),
    DeleteObjectsCommand: command("DeleteObjectsCommand"),
    CopyObjectCommand: command("CopyObjectCommand"),
    HeadObjectCommand: command("HeadObjectCommand"),
    ListObjectsV2Command: command("ListObjectsV2Command"),
    CreateBucketCommand: command("CreateBucketCommand"),
    PutBucketPolicyCommand: command("PutBucketPolicyCommand"),
  }
})
vi.mock("@aws-sdk/lib-storage", () => ({ Upload: class {} }))
vi.mock("@/lib/config.js", () => ({ config: m.config }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: m.from } }))
vi.mock("@/lib/legal-hold.js", () => ({ LegalHoldUnavailableError: class extends Error {}, heldAmong: m.heldAmong }))
vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn(),
  reserveStorageIfWithinLimit: vi.fn(),
  refundStorage: vi.fn(),
  getSizeLimit: vi.fn(() => 1024),
}))
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: vi.fn() }))

import { deleteOwnedObjects, deleteOwnedOutputObjects } from "@/lib/job-policy-outputs.js"
import { keepWithheldObjectsPrivate, withheldObjectsGoPrivate } from "@/lib/withheld-objects-private.js"
import { KEPT_STORAGE_PREFIXES } from "@/lib/kept-storage-prefixes.js"

const JOB = "33333333-3333-4333-8333-333333333333"
const OTHER_JOB = "44444444-4444-4444-8444-444444444444"
const OWNED = [`images/${JOB}.png`, `videos/${JOB}-seg1.mp4`]
const withheld = [
  ...OWNED.map((key) => ({ key, kind: "image" as const, index: 0 })),
  // The same key twice (the withheld list and the row's residue), and an echoed input: another job's file.
  { key: OWNED[0]!, kind: "image" as const, index: 1 },
  { key: `images/${OTHER_JOB}.png`, kind: "image" as const, index: 2 },
]
const commands = (name: string) => m.built.filter((b) => b.command === name)
const deletes = () => m.built.filter((b) => b.command === "DeleteObjectCommand" || b.command === "DeleteObjectsCommand")
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  m.built.length = 0
  m.config.STORAGE_DELETES = "on"
  m.config.STORAGE_OBJECT_ACL = ""
  m.heldAmong.mockImplementation(async () => new Set<string>())
  m.send.mockImplementation(async (cmd: { input: { Delete?: { Objects: Array<{ Key: string }> } } }) =>
    cmd.input.Delete ? { Deleted: cmd.input.Delete.Objects, Errors: [] } : {},
  )
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  error = vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("deletes on: the withheld files are deleted, and no ACL changes", () => {
  it("deletes the job's own files as before, whatever STORAGE_OBJECT_ACL says", async () => {
    for (const acl of ["", "public-read"]) {
      m.built.length = 0
      m.config.STORAGE_OBJECT_ACL = acl
      await expect(deleteOwnedObjects(JOB, withheld)).resolves.toBe(2)
      expect(commands("DeleteObjectsCommand").map((c) => c.input)).toEqual([
        { Bucket: "test-bucket", Delete: { Objects: OWNED.map((Key) => ({ Key })) } },
      ])
      expect(commands("PutObjectAclCommand")).toEqual([])
    }
    expect(withheldObjectsGoPrivate()).toBe(false)
  })

  it("is inert even when called directly", async () => {
    m.config.STORAGE_OBJECT_ACL = "public-read"
    await expect(keepWithheldObjectsPrivate(JOB, OWNED)).resolves.toEqual({ madePrivate: [], failed: [], unsupported: false })
    expect(m.built).toEqual([])
    expect(m.send).not.toHaveBeenCalled()
  })
})

describe("STORAGE_DELETES=skip", () => {
  beforeEach(() => {
    m.config.STORAGE_DELETES = "skip"
  })

  it("objects public by their own ACL: each owned file gets one private ACL, and nothing is deleted", async () => {
    m.config.STORAGE_OBJECT_ACL = "public-read"
    expect(withheldObjectsGoPrivate()).toBe(true)
    await expect(deleteOwnedObjects(JOB, withheld)).resolves.toBe(0)
    expect(commands("PutObjectAclCommand").map((c) => c.input)).toEqual(
      OWNED.map((Key) => ({ Bucket: "test-bucket", Key, ACL: "private" })),
    )
    expect(m.send).toHaveBeenCalledTimes(2)
    expect(deletes()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`job ${JOB}: made 2 withheld file\\(s\\) private instead of deleting them.*STORAGE_DELETES=skip`)))
    expect(error).not.toHaveBeenCalled()
  })

  it("a blocked result's outputs go private through the same path; echoed inputs and foreign URLs are left alone", async () => {
    m.config.STORAGE_OBJECT_ACL = "public-read"
    const completion = { imageUrl: `https://media.test/images/${JOB}.png`, sourceImageUrl: `https://media.test/images/${OTHER_JOB}.png` }
    const residue = { segments: [`https://media.test/videos/${JOB}-seg2.mp4`], foreign: "https://elsewhere.test/x.png" }
    await expect(deleteOwnedOutputObjects(JOB, completion, residue)).resolves.toBe(0)
    expect(commands("PutObjectAclCommand").map((c) => c.input.Key)).toEqual([`images/${JOB}.png`, `videos/${JOB}-seg2.mp4`])
    expect(deletes()).toEqual([])
  })

  it("objects public by a bucket policy, or a store with no object ACLs (R2): nothing changes beyond the skipped delete's warning", async () => {
    m.config.STORAGE_OBJECT_ACL = ""
    expect(withheldObjectsGoPrivate()).toBe(false)
    await expect(deleteOwnedObjects(JOB, withheld)).resolves.toBe(0)
    expect(m.built).toEqual([])
    expect(m.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not deleting 2 key\(s\).*STORAGE_DELETES=skip/))
  })

  it("a store that answers NotImplemented stops the attempt at its first key, with a warning, and nothing throws", async () => {
    m.config.STORAGE_OBJECT_ACL = "public-read"
    m.send.mockRejectedValue(Object.assign(new Error("Not Implemented"), { name: "NotImplemented", $metadata: { httpStatusCode: 501 } }))
    await expect(keepWithheldObjectsPrivate(JOB, OWNED)).resolves.toEqual({ madePrivate: [], failed: [], unsupported: true })
    expect(m.send).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`job ${JOB}: this storage has no object ACLs, so 2 withheld file\\(s\\) stay as they are`)))
    await expect(deleteOwnedObjects(JOB, withheld)).resolves.toBe(0)
    expect(deletes()).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })

  it("a failed ACL call logs the key and the job, leaves that file as it was, and never falls back to a delete", async () => {
    m.config.STORAGE_OBJECT_ACL = "public-read"
    m.send.mockImplementation(async (cmd: { input: { Key?: string } }) => {
      if (cmd.input.Key === OWNED[0]) throw Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } })
      return {}
    })
    await expect(keepWithheldObjectsPrivate(JOB, OWNED)).resolves.toEqual({ madePrivate: [OWNED[1]], failed: [OWNED[0]], unsupported: false })
    expect(error).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`job ${JOB}: could not make images/${JOB}\\.png private, so it stays readable by its URL: Access Denied`)))
    await expect(deleteOwnedObjects(JOB, withheld)).resolves.toBe(0)
    expect(deletes()).toEqual([])
  })

  it("a kept prefix's file is never touched: it is the deployment's own, not a job's output", async () => {
    m.config.STORAGE_OBJECT_ACL = "public-read"
    const kept = KEPT_STORAGE_PREFIXES.map((k) => `${k.prefix}${JOB}.svg`)
    await expect(keepWithheldObjectsPrivate(JOB, [OWNED[0]!, ...kept])).resolves.toEqual({ madePrivate: [OWNED[0]], failed: [], unsupported: false })
    expect(commands("PutObjectAclCommand").map((c) => c.input.Key)).toEqual([OWNED[0]])
  })

  it("a retained snapshot's key is still refused, as a delete refuses it, and the gate sees no throw", async () => {
    m.config.STORAGE_OBJECT_ACL = "public-read"
    const retained = `retained-images/${JOB}`
    await expect(keepWithheldObjectsPrivate(JOB, [OWNED[0]!, retained])).rejects.toThrow("cannot be deleted")
    await expect(deleteOwnedObjects(JOB, [{ key: OWNED[0]!, kind: "image", index: 0 }, { key: retained, kind: "image", index: 1 }])).resolves.toBe(0)
    expect(m.send).not.toHaveBeenCalled()
  })
})
