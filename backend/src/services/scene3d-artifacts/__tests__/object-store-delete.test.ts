import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The private scene bucket's one delete (`createS3ObjectStore().delete`, the
 * artifact cleanup lane's): on a deployment that deletes nothing
 * (STORAGE_DELETES=skip, lib/storage-deletes-setting.ts) the object stays and
 * the call resolves, so the cleanup task that asked is resolved as after a
 * delete and is not offered again every ten minutes.
 */
const h = vi.hoisted(() => ({
  send: vi.fn(),
  sent: [] as Array<{ command: string; input: unknown }>,
  config: { STORAGE_DELETES: "on" } as Record<string, unknown>,
}))

vi.mock("@aws-sdk/client-s3", () => {
  const command = (name: string) =>
    class {
      input: unknown
      constructor(input: unknown) {
        this.input = input
      }
      readonly command = name
    }
  return {
    S3Client: class {
      send = h.send
    },
    GetObjectCommand: command("GetObjectCommand"),
    DeleteObjectCommand: command("DeleteObjectCommand"),
  }
})
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }))
vi.mock("@/lib/config.js", () => ({ config: h.config }))

import { createS3ObjectStore } from "../object-store.js"

const CFG = {
  bucket: "scene-private",
  endpoint: "https://storage.example.test",
  region: "auto",
  accessKeyId: "k",
  secretAccessKey: "s",
  forcePathStyle: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sent.length = 0
  h.config.STORAGE_DELETES = "on"
  h.send.mockImplementation(async (cmd: { command: string; input: unknown }) => {
    h.sent.push({ command: cmd.command, input: cmd.input })
    return {}
  })
})

describe("the private scene bucket's delete", () => {
  it("deletes the object (STORAGE_DELETES=on, the default)", async () => {
    await createS3ObjectStore(CFG).delete("artifacts/a.glb")
    expect(h.sent).toEqual([{ command: "DeleteObjectCommand", input: { Bucket: "scene-private", Key: "artifacts/a.glb" } }])
  })

  it("sends nothing and resolves on a deployment that deletes nothing (STORAGE_DELETES=skip)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    h.config.STORAGE_DELETES = "skip"
    await expect(createS3ObjectStore(CFG).delete("artifacts/a.glb")).resolves.toBeUndefined()
    expect(h.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("STORAGE_DELETES=skip"))
    warn.mockRestore()
  })

  it("asks at call time, not when the store is made", async () => {
    const store = createS3ObjectStore(CFG)
    h.config.STORAGE_DELETES = "skip"
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.delete("artifacts/a.glb")
    expect(h.send).not.toHaveBeenCalled()
    h.config.STORAGE_DELETES = "on"
    await store.delete("artifacts/a.glb")
    expect(h.sent).toHaveLength(1)
  })
})
