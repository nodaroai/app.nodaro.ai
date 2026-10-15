import { Readable } from "node:stream"
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

/**
 * End to end through the REAL storage writers, the REAL free-tier watermark and
 * the REAL completion funnel: a completed image job's `output_data` carries the
 * pixel size of the file as it was STORED — what a client downloads. Only the
 * network edges are stubbed (the provider fetch, the object store, the jobs row).
 */

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  send: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as { config: Record<string, unknown> }
  return {
    ...orig,
    config: { ...orig.config, R2_PUBLIC_URL: "https://r2.test.com", R2_BUCKET_NAME: "test-bucket", R2_SHARED_WITH_RELAY_TARGET: false },
    hasCredits: () => false,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      update: (completion: Record<string, unknown>) => {
        mocks.update(completion)
        return { eq: () => ({ in: () => ({ select: async () => ({ data: [{ id: "job-1", usage_log_id: null }], error: null }) }) }) }
      },
    }),
    rpc: vi.fn(),
  },
}))

vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch, isPrivateOrReservedIP: () => false }))

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(params: Record<string, unknown>) {
      Object.assign(this, params)
    }
  }
  return {
    S3Client: class {
      send = mocks.send
    },
    GetObjectCommand: class GetObjectCommand extends Command {},
    PutObjectCommand: class PutObjectCommand extends Command {},
    DeleteObjectCommand: Command,
    DeleteObjectsCommand: Command,
    CopyObjectCommand: Command,
    HeadObjectCommand: Command,
    ListObjectsV2Command: Command,
    CreateBucketCommand: Command,
    PutBucketPolicyCommand: Command,
  }
})

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    private body: Readable
    constructor({ params }: { params: { Body: Readable } }) {
      this.body = params.Body
    }
    async done() {
      for await (const _chunk of this.body) {
        // the store consumes the stream
      }
      return {}
    }
  },
}))

vi.mock("@/utils/file-validation.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
  reserveStorageIfWithinLimit: vi.fn().mockResolvedValue(true),
  refundStorage: vi.fn().mockResolvedValue(undefined),
}))

import { markJobCompleted, uploadImageMaybeWatermark } from "../shared.js"
import { forgetStoredImageDimensions } from "../../lib/image-dimensions.js"

/** What a provider delivers: a JPEG stored 1104×1472 with a quarter-turn EXIF tag — shown 1472×1104. */
async function rotatedPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 1104, height: 1472, channels: 3, background: { r: 40, g: 90, b: 160 } } })
    .jpeg({ quality: 80 })
    .withMetadata({ orientation: 6 })
    .toBuffer()
}

function completedOutput(): Record<string, unknown> {
  const completion = mocks.update.mock.calls.at(-1)?.[0] as { output_data: Record<string, unknown> }
  return completion.output_data
}

function getObjectCalls(): unknown[] {
  return mocks.send.mock.calls.filter(([cmd]) => (cmd as object).constructor.name === "GetObjectCommand")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue({})
  forgetStoredImageDimensions()
})

describe("a completed image job reports the size of the file it STORED", () => {
  it("free tier: the watermarked file's size — the re-encode dropped the EXIF turn, so it reads unrotated", async () => {
    mocks.safeFetch.mockResolvedValueOnce(new Response(new Uint8Array(await rotatedPhoto())))
    const imageUrl = await uploadImageMaybeWatermark("https://provider.example/out.jpg", "job-1", "user-1", true)
    expect(imageUrl).toBe("https://r2.test.com/images/job-1.png")

    expect(await markJobCompleted("job-1", { output_data: { imageUrl } })).toBe(true)
    expect(completedOutput()).toEqual({ imageUrl, width: 1104, height: 1472 })
    expect(getObjectCalls()).toHaveLength(0) // measured at store time, nothing read back
  })

  it("paid: the provider's file stored as delivered — measured from the stream, shown as a browser shows it", async () => {
    mocks.safeFetch.mockResolvedValueOnce(new Response(new Uint8Array(await rotatedPhoto())))
    const imageUrl = await uploadImageMaybeWatermark("https://provider.example/out.jpg", "job-1", "user-1", false)

    expect(await markJobCompleted("job-1", { output_data: { imageUrl, seed: 42 } })).toBe(true)
    expect(completedOutput()).toEqual({ imageUrl, seed: 42, width: 1472, height: 1104 })
    expect(getObjectCalls()).toHaveLength(0)
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1) // the provider download, nothing else
  })

  it("an image this process did not store is read back through the storage client — never fetched by its public URL", async () => {
    const png = await sharp({ create: { width: 900, height: 1600, channels: 3, background: "#222" } }).png().toBuffer()
    mocks.send.mockImplementation(async (cmd: { constructor: { name: string } }) =>
      cmd.constructor.name === "GetObjectCommand" ? { Body: Readable.from([png]), ContentType: "image/png" } : {},
    )
    const imageUrl = "https://r2.test.com/images/elsewhere.png"

    expect(await markJobCompleted("job-1", { output_data: { imageUrl } })).toBe(true)
    expect(completedOutput()).toEqual({ imageUrl, width: 900, height: 1600 })
    const [[cmd]] = getObjectCalls() as Array<[{ Key: string; Range: string }]>
    expect(cmd).toMatchObject({ Key: "images/elsewhere.png", Range: expect.stringMatching(/^bytes=0-\d+$/) })
    expect(mocks.safeFetch).not.toHaveBeenCalled()
  })

  it("a completion that publishes no image is written exactly as given", async () => {
    const fields = { output_data: { videoUrl: "https://r2.test.com/videos/v.mp4", thumbnailUrl: "https://r2.test.com/thumbnails/v.png" }, provider: "kie" }
    expect(await markJobCompleted("job-1", fields)).toBe(true)
    const completion = mocks.update.mock.calls[0]![0] as Record<string, unknown>
    expect(completion.output_data).toBe(fields.output_data)
    expect(completion.provider).toBe("kie")
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
