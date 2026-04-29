import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { resolveAssetId } = await import("../asset-resolver.js")
const { supabase } = await import("../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function mockJob(row: Record<string, unknown> | null) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    }),
  })
}

function mockJobError(message: string) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message } }),
      }),
    }),
  })
}

describe("resolveAssetId", () => {
  it("returns null for null/empty input", async () => {
    expect(
      await resolveAssetId({ assetId: null, userId: "u1", expectedKind: "image" }),
    ).toBeNull()
    expect(
      await resolveAssetId({ assetId: undefined, userId: "u1", expectedKind: "image" }),
    ).toBeNull()
    expect(
      await resolveAssetId({ assetId: "", userId: "u1", expectedKind: "image" }),
    ).toBeNull()
  })

  it("throws when the job belongs to a different user", async () => {
    mockJob({
      id: "j1",
      user_id: "OTHER",
      job_type: "generate-image",
      output_data: { imageUrl: "https://r2/img.png" },
    })
    await expect(
      resolveAssetId({ assetId: "j1", userId: "u1", expectedKind: "image" }),
    ).rejects.toThrow(/forbidden/i)
  })

  it("returns the imageUrl when the image job matches", async () => {
    mockJob({
      id: "j1",
      user_id: "u1",
      job_type: "generate-image",
      output_data: { imageUrl: "https://r2/img.png" },
    })
    const url = await resolveAssetId({
      assetId: "j1",
      userId: "u1",
      expectedKind: "image",
    })
    expect(url).toBe("https://r2/img.png")
  })

  it("returns the videoUrl for an image-to-video job", async () => {
    mockJob({
      id: "j2",
      user_id: "u1",
      job_type: "image-to-video",
      output_data: { videoUrl: "https://r2/v.mp4", thumbnailUrl: "https://r2/t.jpg" },
    })
    const url = await resolveAssetId({
      assetId: "j2",
      userId: "u1",
      expectedKind: "video",
    })
    expect(url).toBe("https://r2/v.mp4")
  })

  it("accepts extract-frame as an image source", async () => {
    mockJob({
      id: "j3",
      user_id: "u1",
      job_type: "extract-frame",
      output_data: { imageUrl: "https://r2/frame.png" },
    })
    const url = await resolveAssetId({
      assetId: "j3",
      userId: "u1",
      expectedKind: "image",
    })
    expect(url).toBe("https://r2/frame.png")
  })

  it("rejects mismatched kind (video job, image expected)", async () => {
    mockJob({
      id: "j1",
      user_id: "u1",
      job_type: "image-to-video",
      output_data: { videoUrl: "https://r2/v.mp4" },
    })
    await expect(
      resolveAssetId({ assetId: "j1", userId: "u1", expectedKind: "image" }),
    ).rejects.toThrow(/expected image/i)
  })

  it("throws when the URL is missing from output_data", async () => {
    mockJob({
      id: "j1",
      user_id: "u1",
      job_type: "generate-image",
      output_data: {},
    })
    await expect(
      resolveAssetId({ assetId: "j1", userId: "u1", expectedKind: "image" }),
    ).rejects.toThrow(/no imageUrl/i)
  })

  it("throws when output_data is null (job not completed)", async () => {
    mockJob({
      id: "j1",
      user_id: "u1",
      job_type: "generate-image",
      output_data: null,
    })
    await expect(
      resolveAssetId({ assetId: "j1", userId: "u1", expectedKind: "image" }),
    ).rejects.toThrow(/no imageUrl/i)
  })

  it("throws when job_type is null (worker hasn't claimed it)", async () => {
    mockJob({
      id: "j1",
      user_id: "u1",
      job_type: null,
      output_data: { imageUrl: "https://r2/img.png" },
    })
    await expect(
      resolveAssetId({ assetId: "j1", userId: "u1", expectedKind: "image" }),
    ).rejects.toThrow(/expected image/i)
  })

  it("throws when asset is not found", async () => {
    mockJob(null)
    await expect(
      resolveAssetId({ assetId: "missing", userId: "u1", expectedKind: "image" }),
    ).rejects.toThrow(/not found/i)
  })

  it("propagates DB errors", async () => {
    mockJobError("connection reset")
    await expect(
      resolveAssetId({ assetId: "j1", userId: "u1", expectedKind: "image" }),
    ).rejects.toThrow(/connection reset/)
  })
})
