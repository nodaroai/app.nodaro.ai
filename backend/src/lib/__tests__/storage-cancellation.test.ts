import { mkdtemp, writeFile, rm, truncate } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ send: vi.fn(), track: vi.fn(), multipart: vi.fn() }))
vi.mock("@aws-sdk/client-s3", async (original) => ({ ...await original<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { send = mocks.send },
}))
vi.mock("@aws-sdk/lib-storage", () => ({ Upload: mocks.multipart }))
vi.mock("../config.js", () => ({ config: { R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret",
  R2_REGION: "auto", R2_BUCKET_NAME: "test", R2_PUBLIC_URL: "https://cdn.example" } }))
vi.mock("../../utils/file-validation.js", () => ({ updateStorageUsage: mocks.track,
  reserveStorageIfWithinLimit: vi.fn(), refundStorage: vi.fn(), getSizeLimit: vi.fn() }))
import { uploadFileToR2 } from "../storage.js"

describe("cancellable rendered-file uploads", () => {
  let dir: string, file: string
  beforeEach(async () => {
    vi.clearAllMocks()
    dir = await mkdtemp(join(tmpdir(), "scene-upload-test-")); file = join(dir, "video.mp4")
    await writeFile(file, "rendered bytes")
    mocks.track.mockResolvedValue(undefined)
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
  it("sends the abort signal to a bounded PUT and accounts only a successful upload", async () => {
    const controller = new AbortController()
    mocks.send.mockImplementation(async (command) => { for await (const _ of command.input.Body) {} })
    await expect(uploadFileToR2(file, "job", "video", "owner", { signal: controller.signal })).resolves.toContain("job.mp4")
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ ContentLength: 14 }) }),
      { abortSignal: controller.signal })
    expect(mocks.track).toHaveBeenCalledWith("owner", 14)
    expect(mocks.multipart).not.toHaveBeenCalled()
  })
  it("closes the input and does not account an aborted upload", async () => {
    const controller = new AbortController()
    let body: Readable | undefined
    mocks.send.mockImplementation(async (command) => {
      body = command.input.Body
      controller.abort(new Error("stop"))
      throw controller.signal.reason
    })
    await expect(uploadFileToR2(file, "job", "video", "owner", { signal: controller.signal })).rejects.toThrow("stop")
    expect(body?.destroyed).toBe(true)
    expect(mocks.track).not.toHaveBeenCalled()
  })
  it("refuses oversized or pre-cancelled files before opening an upload", async () => {
    await expect(uploadFileToR2(file, "job", "video", "owner", { signal: AbortSignal.abort() })).rejects.toThrow()
    await truncate(file, 512 * 1024 * 1024 + 1)
    await expect(uploadFileToR2(file, "job", "video", "owner", { signal: new AbortController().signal })).rejects.toThrow("byte limit")
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.track).not.toHaveBeenCalled()
  })
})
