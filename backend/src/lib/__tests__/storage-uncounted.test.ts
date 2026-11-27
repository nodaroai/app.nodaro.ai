import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * UNCOUNTED FILES (lib/storage.ts): an upload with `uncounted` charges nobody
 * and marks the object with its own key, and `storageChargeOf` — what every
 * path that gives a job's bytes back sizes them by — answers 0 for it. An
 * object with no mark (one stored before the mark existed, a charged upload
 * over the same key, a copy under another key) is charged, as always.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn(), track: vi.fn(), multipartParams: [] as Array<Record<string, unknown>> }))
vi.mock("@aws-sdk/client-s3", async (original) => ({ ...await original<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { send = mocks.send },
}))
vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    private readonly body: Readable
    constructor({ params }: { params: Record<string, unknown> }) {
      mocks.multipartParams.push(params)
      this.body = params.Body as Readable
    }
    async done() { for await (const _ of this.body) { /* drain */ } return {} }
    async abort() { return {} }
  },
}))
vi.mock("../config.js", () => ({ config: { R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret",
  R2_REGION: "auto", R2_BUCKET_NAME: "test", R2_PUBLIC_URL: "https://cdn.example" } }))
vi.mock("../../utils/file-validation.js", () => ({ updateStorageUsage: mocks.track,
  reserveStorageIfWithinLimit: vi.fn(), refundStorage: vi.fn(), getSizeLimit: vi.fn() }))

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { isUncountedObject, storageChargeOf, uncountedObjectMetadata, uploadFileToR2 } from "../storage.js"

const JOB = "11111111-1111-4111-8111-111111111111"
const ENGINE_KEY = `videos/${JOB}-engine.mp4`

describe("uploadFileToR2's uncounted option", () => {
  let dir: string, file: string
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.multipartParams.length = 0
    dir = await mkdtemp(join(tmpdir(), "uncounted-upload-test-")); file = join(dir, "engine.mp4")
    await writeFile(file, "engine bytes")
    mocks.track.mockResolvedValue(undefined)
    mocks.send.mockImplementation(async (command: { input: { Body?: AsyncIterable<unknown> } }) => {
      if (command.input.Body) for await (const _ of command.input.Body) { /* drain */ }
      return {}
    })
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it("charges nobody, whatever user id it is given, and marks the object with its own key (multipart)", async () => {
    await expect(uploadFileToR2(file, `${JOB}-engine`, "video", "owner", { uncounted: true })).resolves.toBe(`https://cdn.example/${ENGINE_KEY}`)
    expect(mocks.multipartParams).toHaveLength(1)
    expect(mocks.multipartParams[0]).toEqual(expect.objectContaining({ Key: ENGINE_KEY, Metadata: { "nodaro-uncounted": ENGINE_KEY } }))
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it("marks the object on the cancellable single PUT too", async () => {
    const controller = new AbortController()
    await uploadFileToR2(file, `${JOB}-engine`, "video", "owner", { uncounted: true, signal: controller.signal })
    const put = mocks.send.mock.calls.map(([c]) => c).find((c) => c instanceof PutObjectCommand) as PutObjectCommand
    expect(put.input).toEqual(expect.objectContaining({ Key: ENGINE_KEY, Metadata: { "nodaro-uncounted": ENGINE_KEY } }))
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it("without the option, charges the user and writes no mark, as before", async () => {
    await uploadFileToR2(file, `${JOB}-engine`, "video", "owner")
    expect(mocks.multipartParams[0]).not.toHaveProperty("Metadata")
    expect(mocks.track).toHaveBeenCalledWith("owner", "engine bytes".length)
  })

  it("a failed uncounted upload charges nothing either", async () => {
    const controller = new AbortController()
    mocks.send.mockRejectedValueOnce(new Error("storage down"))
    await expect(uploadFileToR2(file, `${JOB}-engine`, "video", "owner", { uncounted: true, signal: controller.signal })).rejects.toThrow("storage down")
    expect(mocks.track).not.toHaveBeenCalled()
  })
})

describe("storageChargeOf", () => {
  beforeEach(() => vi.clearAllMocks())
  const head = (answer: Record<string, unknown> | Error) =>
    mocks.send.mockImplementationOnce(async (command: unknown) => {
      expect(command).toBeInstanceOf(HeadObjectCommand)
      if (answer instanceof Error) throw answer
      return answer
    })

  it("answers the stored size of an object with no mark: charged (stored before the mark existed, or charged)", async () => {
    head({ ContentLength: 7000 })
    await expect(storageChargeOf(ENGINE_KEY)).resolves.toEqual({ bytes: 7000, uncounted: false })
  })

  it("answers 0 for an object marked uncounted with its own key", async () => {
    head({ ContentLength: 7000, Metadata: uncountedObjectMetadata(ENGINE_KEY) })
    await expect(storageChargeOf(ENGINE_KEY)).resolves.toEqual({ bytes: 0, uncounted: true })
  })

  it("a copy under another key keeps the metadata but is charged: the mark names the key it was written for", async () => {
    const copyKey = "videos/22222222-2222-4222-8222-222222222222.mp4"
    head({ ContentLength: 7000, Metadata: uncountedObjectMetadata(ENGINE_KEY) })
    await expect(storageChargeOf(copyKey)).resolves.toEqual({ bytes: 7000, uncounted: false })
  })

  it("answers 0 when storage cannot say (as getR2ObjectSize)", async () => {
    head(new Error("down"))
    await expect(storageChargeOf(ENGINE_KEY)).resolves.toEqual({ bytes: 0, uncounted: false })
  })

  it("isUncountedObject reads only a mark naming the key", () => {
    expect(isUncountedObject(ENGINE_KEY, { "nodaro-uncounted": ENGINE_KEY })).toBe(true)
    expect(isUncountedObject(ENGINE_KEY, { "nodaro-uncounted": "videos/other.mp4" })).toBe(false)
    expect(isUncountedObject(ENGINE_KEY, undefined)).toBe(false)
  })
})
