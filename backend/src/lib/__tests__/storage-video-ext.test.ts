import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Readable } from "node:stream"

// ---------------------------------------------------------------------------
// Video uploads may KEEP a non-mp4 container.
//
// Seedance 2.5's `mov` output (H.264 yuv444p + PCM) is worth storing verbatim:
// fed back as the reference on the next extension it halves the colour drift
// at the join. Today every provider video is stamped `videos/<id>.mp4` with
// `video/mp4` regardless of what the bytes are, which would serve mov bytes
// under a lying content type.
//
// The container is opt-in PER CALL (`opts.ext`). The invariant this file pins
// hardest: with no `ext`, every key and every ContentType is exactly today's.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const uploadParams: Array<{ Key: string; ContentType: string; CacheControl?: string }> = []
  const copyCalls: unknown[] = []
  const safeFetchMock = vi.fn()
  const mockSend = vi.fn().mockResolvedValue({ ContentLength: 99 })
  return { uploadParams, copyCalls, safeFetchMock, mockSend }
})

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mocks.mockSend
  }
  class Passthrough {
    constructor(params: unknown) {
      Object.assign(this, params)
    }
  }
  class MockCopyObjectCommand {
    constructor(params: unknown) {
      Object.assign(this, params)
      mocks.copyCalls.push(params)
    }
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: Passthrough,
    DeleteObjectCommand: Passthrough,
    DeleteObjectsCommand: Passthrough,
    CopyObjectCommand: MockCopyObjectCommand,
    HeadObjectCommand: Passthrough,
  }
})

vi.mock("@aws-sdk/lib-storage", () => {
  class MockUpload {
    private body: Readable
    constructor({ params }: { params: { Body: Readable; Key: string; ContentType: string } }) {
      this.body = params.Body
      mocks.uploadParams.push({ Key: params.Key, ContentType: params.ContentType })
    }
    async done() {
      for await (const _ of this.body) {
        // consume
      }
      return {}
    }
    async abort() {
      return {}
    }
  }
  return { Upload: MockUpload }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET_NAME: "test-bucket",
    R2_PUBLIC_URL: "https://r2.test.com",
    EDITION: "cloud",
  },
}))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
  reserveStorageIfWithinLimit: vi.fn().mockResolvedValue(true),
  refundStorage: vi.fn().mockResolvedValue(undefined),
  getSizeLimit: vi.fn(() => 1_000_000),
}))

vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: mocks.safeFetchMock,
}))

import { uploadToR2, uploadFileToR2, copyRecastObject, mediaObjectKey } from "@/lib/storage.js"

function makeResponse(bytes = 32) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })
  return { ok: true, status: 200, headers: new Headers(), body } as unknown as Response
}

const workDir = mkdtempSync(join(tmpdir(), "storage-video-ext-"))
const localFile = join(workDir, "extension.mov")
writeFileSync(localFile, Buffer.alloc(64))

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

beforeEach(() => {
  mocks.uploadParams.length = 0
  mocks.copyCalls.length = 0
  mocks.safeFetchMock.mockReset()
  // A fresh Response per call — a WHATWG body stream can only be read once.
  mocks.safeFetchMock.mockImplementation(async () => makeResponse())
  mocks.mockSend.mockResolvedValue({ ContentLength: 99 })
})

describe("uploadToR2 — explicit video container", () => {
  it("no ext ⇒ today's key and content type, byte for byte", async () => {
    const url = await uploadToR2("https://kie.example.com/out.mp4", "job-1", "video", "user-1")
    expect(url).toBe("https://r2.test.com/videos/job-1.mp4")
    expect(mocks.uploadParams).toEqual([{ Key: "videos/job-1.mp4", ContentType: "video/mp4" }])
  })

  it('ext "mov" ⇒ videos/<id>.mov served video/quicktime', async () => {
    const url = await uploadToR2("https://kie.example.com/out.mov", "job-2", "video", "user-1", { ext: "mov" })
    expect(url).toBe("https://r2.test.com/videos/job-2.mov")
    expect(mocks.uploadParams).toEqual([{ Key: "videos/job-2.mov", ContentType: "video/quicktime" }])
  })

  it('ext "mp4" is a no-op (still today\'s key/type)', async () => {
    await uploadToR2("https://kie.example.com/out.mp4", "job-3", "video", "user-1", { ext: "mp4" })
    expect(mocks.uploadParams).toEqual([{ Key: "videos/job-3.mp4", ContentType: "video/mp4" }])
  })

  it("ext is IGNORED for image and audio — those types have their own containers", async () => {
    await uploadToR2("https://x.example.com/a.png", "job-4", "image", "user-1", {
      ext: "mov",
    } as never)
    await uploadToR2("https://x.example.com/a.wav", "job-5", "audio", "user-1", {
      ext: "mov",
    } as never)
    expect(mocks.uploadParams).toEqual([
      { Key: "images/job-4.png", ContentType: "image/png" },
      { Key: "audios/job-5.wav", ContentType: "audio/wav" },
    ])
  })

  it("the other opts still work alongside ext (quota reservation path)", async () => {
    const url = await uploadToR2("https://kie.example.com/out.mov", "job-6", "video", "user-1", {
      ext: "mov",
      reserveQuota: true,
      remainingQuotaBytes: 500_000,
    })
    expect(url).toBe("https://r2.test.com/videos/job-6.mov")
    expect(mocks.uploadParams[0]!.ContentType).toBe("video/quicktime")
  })
})

describe("uploadFileToR2 — explicit video container", () => {
  it("no opts ⇒ today's key and content type", async () => {
    const url = await uploadFileToR2(localFile, "job-7", "video", "user-1")
    expect(url).toBe("https://r2.test.com/videos/job-7.mp4")
    expect(mocks.uploadParams).toEqual([{ Key: "videos/job-7.mp4", ContentType: "video/mp4" }])
  })

  it('ext "mov" ⇒ videos/<id>.mov served video/quicktime', async () => {
    const url = await uploadFileToR2(localFile, "job-8", "video", "user-1", { ext: "mov" })
    expect(url).toBe("https://r2.test.com/videos/job-8.mov")
    expect(mocks.uploadParams).toEqual([{ Key: "videos/job-8.mov", ContentType: "video/quicktime" }])
  })
})

describe("mediaObjectKey / copyRecastObject learn the container", () => {
  it("mediaObjectKey takes mov explicitly (default stays mp4)", () => {
    expect(mediaObjectKey("job-9", "video")).toBe("videos/job-9.mp4")
    expect(mediaObjectKey("job-9", "video", "mov")).toBe("videos/job-9.mov")
  })

  it("a .mov fork destination copies with video/quicktime instead of throwing", async () => {
    const result = await copyRecastObject(
      "https://r2.test.com/videos/orig-raw.mov",
      "videos/fork-x1-raw.mov",
    )
    expect(result.url).toBe("https://r2.test.com/videos/fork-x1-raw.mov")
    expect(mocks.copyCalls[0]).toMatchObject({
      Key: "videos/fork-x1-raw.mov",
      ContentType: "video/quicktime",
      MetadataDirective: "REPLACE",
    })
  })
})
