import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// STORAGE_DELETES=skip (lib/storage-deletes-setting.ts): a deployment that
// shares its media storage with another deployment but runs on its own copy
// of the database deletes nothing. The storage helpers skip every key the
// way they skip a key under a kept prefix — with a warning, answered as kept,
// never as failed — so the funnel (lib/storage-delete.ts) records nothing for
// the retry pass. Run here through the REAL helpers and the REAL funnel; only
// the storage SDK, the hold and the database are fakes.
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
  }
  /** Every storage command built, by class name, with its input. */
  const built: Array<{ command: string; input: Record<string, unknown> }> = []
  const send = vi.fn()
  const heldAmong = vi.fn()
  const upserts: unknown[] = []
  const from = vi.fn((table: string) => ({
    upsert: vi.fn(async (rows: unknown) => {
      upserts.push({ table, rows })
      return { data: null, error: null }
    }),
  }))
  return { config, built, send, heldAmong, upserts, from }
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

import { batchDeleteFromR2, deleteFromR2, moveObjectToEvidence, restoreObjectFromEvidence } from "@/lib/storage.js"
import { deleteKeyRecordingFailure, deleteKeysRecordingFailures } from "@/lib/storage-delete.js"
import { KEPT_STORAGE_PREFIXES } from "@/lib/kept-storage-prefixes.js"

const RETAINED = "retained-images/00000000-0000-4000-8000-000000000001"
const deleteCommands = () => m.built.filter((b) => b.command === "DeleteObjectCommand" || b.command === "DeleteObjectsCommand")
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  m.built.length = 0
  m.upserts.length = 0
  m.config.STORAGE_DELETES = "on"
  m.heldAmong.mockImplementation(async () => new Set<string>())
  m.send.mockImplementation(async (cmd: { input: { Delete?: { Objects: Array<{ Key: string }> } } }) =>
    cmd.input.Delete ? { Deleted: cmd.input.Delete.Objects, Errors: [] } : {},
  )
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("STORAGE_DELETES=skip: this deployment deletes nothing from storage", () => {
  beforeEach(() => {
    m.config.STORAGE_DELETES = "skip"
  })

  it("deleteFromR2 sends nothing, asks no hold, and resolves: its caller carries on as after a kept key", async () => {
    await expect(deleteFromR2("images/a.png")).resolves.toBeUndefined()
    expect(deleteCommands()).toEqual([])
    expect(m.send).not.toHaveBeenCalled()
    expect(m.heldAmong).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("STORAGE_DELETES=skip"))
  })

  it("deleteFromR2 still refuses a retained snapshot's key, as it does with deletes on", async () => {
    await expect(deleteFromR2(RETAINED)).rejects.toThrow("cannot be deleted")
    expect(m.send).not.toHaveBeenCalled()
  })

  it("batchDeleteFromR2 sends nothing and answers every key as kept and not deleted — never as failed", async () => {
    const result = await batchDeleteFromR2(["images/a.png", "videos/b.mp4"])
    expect(result).toEqual({
      deleted: 0,
      errors: 0,
      notDeleted: ["images/a.png", "videos/b.mp4"],
      kept: ["images/a.png", "videos/b.mp4"],
    })
    expect(deleteCommands()).toEqual([])
    expect(m.send).not.toHaveBeenCalled()
    expect(m.heldAmong).not.toHaveBeenCalled()
  })

  it("a key under a kept prefix is still skipped as kept, with its own reason", async () => {
    const keptKeys = KEPT_STORAGE_PREFIXES.map((k) => `${k.prefix}x.svg`)
    const result = await batchDeleteFromR2(["images/a.png", ...keptKeys])
    expect(result.kept).toEqual(["images/a.png", ...keptKeys])
    expect(result.notDeleted).toEqual(["images/a.png", ...keptKeys])
    for (const kept of KEPT_STORAGE_PREFIXES) {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(kept.why))
    }
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not deleting 1 key\(s\).*STORAGE_DELETES=skip/))
    await expect(deleteFromR2(keptKeys[0]!)).resolves.toBeUndefined()
    expect(m.send).not.toHaveBeenCalled()
  })

  it("batchDeleteFromR2 still refuses a whole batch that holds a retained snapshot's key", async () => {
    await expect(batchDeleteFromR2(["images/a.png", RETAINED])).rejects.toThrow("cannot be deleted")
    expect(m.send).not.toHaveBeenCalled()
  })

  it("the funnel records nothing for the retry pass: a skipped key is not a failed delete", async () => {
    const batch = await deleteKeysRecordingFailures(["images/a.png", "videos/b.mp4"], "retention", { recordErrors: "throw" })
    expect(batch.failed).toEqual([])
    expect(batch.kept).toEqual(["images/a.png", "videos/b.mp4"])
    await expect(deleteKeyRecordingFailure("images/c.png", "asset")).resolves.toBeUndefined()
    expect(m.upserts).toEqual([])
    expect(m.from).not.toHaveBeenCalled()
    expect(deleteCommands()).toEqual([])
  })

  it("a restricted file's move is refused before any storage call, in both directions: no copy is written, nothing is deleted", async () => {
    await expect(moveObjectToEvidence("videos/a.mp4", "r-1")).rejects.toThrow("STORAGE_DELETES=skip")
    await expect(restoreObjectFromEvidence("videos/a.mp4", "r-1")).rejects.toThrow("STORAGE_DELETES=skip")
    expect(m.built).toEqual([])
    expect(m.send).not.toHaveBeenCalled()
  })
})

describe("STORAGE_DELETES=on (the default): deletes exactly as before", () => {
  it.each([["on"], [undefined]])("deleteFromR2 sends its delete (STORAGE_DELETES=%s)", async (value) => {
    m.config.STORAGE_DELETES = value
    await deleteFromR2("images/a.png")
    expect(m.heldAmong).toHaveBeenCalledWith(["images/a.png"])
    expect(deleteCommands()).toEqual([{ command: "DeleteObjectCommand", input: { Bucket: "test-bucket", Key: "images/a.png" } }])
  })

  it("batchDeleteFromR2 sends one DeleteObjects call and answers what storage confirmed", async () => {
    const result = await batchDeleteFromR2(["images/a.png", "videos/b.mp4"])
    expect(result).toEqual({ deleted: 2, errors: 0, notDeleted: [], kept: [] })
    expect(deleteCommands()).toEqual([
      { command: "DeleteObjectsCommand", input: { Bucket: "test-bucket", Delete: { Objects: [{ Key: "images/a.png" }, { Key: "videos/b.mp4" }] } } },
    ])
  })

  it("a delete storage did not confirm is still recorded for the retry pass (the record the skip never writes)", async () => {
    m.send.mockResolvedValueOnce({ Deleted: [{ Key: "images/a.png" }], Errors: [{ Key: "videos/b.mp4", Code: "InternalError" }] })
    const batch = await deleteKeysRecordingFailures(["images/a.png", "videos/b.mp4"], "retention")
    expect(batch.failed).toEqual(["videos/b.mp4"])
    expect(m.upserts).toEqual([
      { table: "storage_delete_retries", rows: [expect.objectContaining({ r2_key: "videos/b.mp4", source: "retention" })] },
    ])
  })
})
