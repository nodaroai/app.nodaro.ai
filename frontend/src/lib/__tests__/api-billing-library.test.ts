import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  getJobs,
  deleteJob,
  cancelJob,
  cancelAllJobs,
  getWorkflowCostSummary,
  getLibraryAssets,
  deleteLibraryAsset,
  removeLibraryAsset,
  getUserCredits,
  getModelCreditCost,
  getBatchModelCreditCosts,
  getSubscription,
  getTransactions,
  getManageSubscriptionUrl,
  changePlan,
  uploadImage,
  uploadAudio,
  downloadYouTubeAudio,
  getStats,
  splitImage,
} from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function mockFetchError(status: number, errBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(errBody),
    text: () => Promise.resolve(JSON.stringify(errBody)),
  })
}

function sessionWith(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

beforeEach(() => {
  mockGetSession.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// getJobs
// ---------------------------------------------------------------------------

describe("getJobs", () => {
  it("sends GET /v1/jobs with userId and cursor query params", async () => {
    sessionWith("tok-1")
    const payload = { data: [{ id: "j1" }], next: "c2", previous: null }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await getJobs("user-1", "cursor-abc")

    expect(mock).toHaveBeenCalledWith(
      "/v1/jobs?userId=user-1&cursor=cursor-abc",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok-1" },
      }),
    )
    expect(result).toEqual(payload)
  })

  it("throws on non-ok response via throwApiError", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "DB down" } }),
    )

    await expect(getJobs()).rejects.toThrow("DB down")
  })
})

// ---------------------------------------------------------------------------
// deleteJob
// ---------------------------------------------------------------------------

describe("deleteJob", () => {
  it("sends DELETE /v1/jobs/:jobId and returns hardcoded { success: true }", async () => {
    sessionWith("tok-del")
    const mock = mockFetchJson({ anything: "ignored" })
    vi.stubGlobal("fetch", mock)

    const result = await deleteJob("job-99")

    expect(mock).toHaveBeenCalledWith(
      "/v1/jobs/job-99",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer tok-del" },
      }),
    )
    expect(result).toEqual({ success: true })
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Job not found" } }),
    )

    await expect(deleteJob("bad-id")).rejects.toThrow("Job not found")
  })
})

// ---------------------------------------------------------------------------
// cancelJob
// ---------------------------------------------------------------------------

describe("cancelJob", () => {
  it("sends POST /v1/jobs/:jobId/cancel with userId body", async () => {
    sessionWith("tok-cancel")
    const payload = { success: true, cancelled: 1 }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await cancelJob("j-10", "u-5")

    expect(mock).toHaveBeenCalledWith(
      "/v1/jobs/j-10/cancel",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ userId: "u-5" })
    expect(result).toEqual(payload)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Cannot cancel" } }),
    )

    await expect(cancelJob("j-10")).rejects.toThrow("Cannot cancel")
  })
})

// ---------------------------------------------------------------------------
// cancelAllJobs
// ---------------------------------------------------------------------------

describe("cancelAllJobs", () => {
  it("sends POST /v1/jobs/cancel-all with userId body", async () => {
    sessionWith("tok-ca")
    const payload = { success: true, cancelled: 5 }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await cancelAllJobs("u-7")

    expect(mock).toHaveBeenCalledWith(
      "/v1/jobs/cancel-all",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ userId: "u-7" })
    expect(result).toEqual(payload)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Cancel failed" } }),
    )

    await expect(cancelAllJobs("u-1")).rejects.toThrow("Cancel failed")
  })
})

// ---------------------------------------------------------------------------
// getWorkflowCostSummary
// ---------------------------------------------------------------------------

describe("getWorkflowCostSummary", () => {
  it("returns zeroed summary for empty jobIds without making a fetch", async () => {
    const mock = vi.fn()
    vi.stubGlobal("fetch", mock)

    const result = await getWorkflowCostSummary([])

    expect(mock).not.toHaveBeenCalled()
    expect(result).toEqual({
      data: { total_credits: 0, total_cost_usd: 0, total_jobs: 0, breakdown: [] },
    })
  })

  it("sends POST /v1/jobs/cost-summary and returns response for non-empty jobIds", async () => {
    sessionWith("tok-cost")
    const payload = {
      data: { total_credits: 10, total_cost_usd: 1.0, total_jobs: 2, breakdown: [] },
    }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await getWorkflowCostSummary(["j1", "j2"])

    expect(mock).toHaveBeenCalledWith(
      "/v1/jobs/cost-summary",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ jobIds: ["j1", "j2"] })
    expect(result).toEqual(payload)
  })
})

// ---------------------------------------------------------------------------
// getLibraryAssets
// ---------------------------------------------------------------------------

describe("getLibraryAssets", () => {
  it("sends GET /v1/library with correct query params, omitting type=all", async () => {
    sessionWith("tok-lib")
    const payload = { data: [{ id: "a1" }], nextCursor: "c2" }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await getLibraryAssets({
      userId: "u-1",
      type: "all",
      search: "cat",
      limit: 5,
      cursor: "c1",
      owned: true,
    })

    const calledUrl = mock.mock.calls[0][0] as string
    expect(calledUrl).toContain("/v1/library?")
    expect(calledUrl).toContain("userId=u-1")
    expect(calledUrl).not.toContain("type=all")
    expect(calledUrl).toContain("search=cat")
    expect(calledUrl).toContain("limit=5")
    expect(calledUrl).toContain("cursor=c1")
    expect(calledUrl).toContain("owned=true")
    expect(result).toEqual(payload)
  })

  it("includes type query param when type is not 'all'", async () => {
    noSession()
    const mock = mockFetchJson({ data: [], nextCursor: null })
    vi.stubGlobal("fetch", mock)

    await getLibraryAssets({ userId: "u-2", type: "image" })

    const calledUrl = mock.mock.calls[0][0] as string
    expect(calledUrl).toContain("type=image")
  })
})

// ---------------------------------------------------------------------------
// deleteLibraryAsset (permanent delete — used by /library storage page)
// ---------------------------------------------------------------------------

describe("deleteLibraryAsset", () => {
  it("sends DELETE /v1/library/:assetId?userId=...&permanent=true", async () => {
    sessionWith("tok-dla")
    const mock = mockFetchJson({ success: true })
    vi.stubGlobal("fetch", mock)

    const result = await deleteLibraryAsset("asset-1", "user-3")

    expect(mock).toHaveBeenCalledWith(
      "/v1/library/asset-1?userId=user-3&permanent=true",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer tok-dla" },
      }),
    )
    expect(result).toEqual({ success: true })
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Asset not found" } }),
    )

    await expect(deleteLibraryAsset("bad", "u-1")).rejects.toThrow("Asset not found")
  })
})

// ---------------------------------------------------------------------------
// removeLibraryAsset (soft remove — used by workflow Media Library modal)
// ---------------------------------------------------------------------------

describe("removeLibraryAsset", () => {
  it("sends DELETE /v1/library/:assetId?userId=... (no permanent flag)", async () => {
    sessionWith("tok-rla")
    const mock = mockFetchJson({ success: true })
    vi.stubGlobal("fetch", mock)

    const result = await removeLibraryAsset("asset-2", "user-4")

    expect(mock).toHaveBeenCalledWith(
      "/v1/library/asset-2?userId=user-4",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer tok-rla" },
      }),
    )
    expect(result).toEqual({ success: true })
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Asset not found" } }),
    )

    await expect(removeLibraryAsset("bad", "u-1")).rejects.toThrow("Asset not found")
  })
})

// ---------------------------------------------------------------------------
// getUserCredits
// ---------------------------------------------------------------------------

describe("getUserCredits", () => {
  it("sends GET /v1/user/credits?userId=... and returns response", async () => {
    sessionWith("tok-cred")
    const payload = { data: { total: 100, subscription: 80, topup: 20, tier: "basic" } }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await getUserCredits("u-10")

    expect(mock).toHaveBeenCalledWith(
      "/v1/user/credits?userId=u-10",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok-cred" },
      }),
    )
    expect(result).toEqual(payload)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(401, { error: { message: "Unauthorized" } }),
    )

    await expect(getUserCredits("u-1")).rejects.toThrow("Unauthorized")
  })
})

// ---------------------------------------------------------------------------
// getModelCreditCost
// ---------------------------------------------------------------------------

describe("getModelCreditCost", () => {
  it("sends GET /v1/credits/model-cost?model=... and returns response", async () => {
    sessionWith("tok-mc")
    const payload = { data: { model: "flux", creditCost: 10 } }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await getModelCreditCost("flux")

    expect(mock).toHaveBeenCalledWith(
      "/v1/credits/model-cost?model=flux",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok-mc" },
      }),
    )
    expect(result).toEqual(payload)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Model not found" } }),
    )

    await expect(getModelCreditCost("unknown")).rejects.toThrow("Model not found")
  })
})

// ---------------------------------------------------------------------------
// getBatchModelCreditCosts
// ---------------------------------------------------------------------------

describe("getBatchModelCreditCosts", () => {
  it("sends POST /v1/credits/model-costs and returns body.data", async () => {
    noSession()
    const costs = { flux: 10, minimax: 2 }
    const mock = mockFetchJson({ data: costs })
    vi.stubGlobal("fetch", mock)

    const result = await getBatchModelCreditCosts(["flux", "minimax"])

    expect(mock).toHaveBeenCalledWith(
      "/v1/credits/model-costs",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ models: ["flux", "minimax"] })
    expect(result).toEqual(costs)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Cost lookup failed" } }),
    )

    await expect(getBatchModelCreditCosts(["bad"])).rejects.toThrow("Cost lookup failed")
  })
})

// ---------------------------------------------------------------------------
// getSubscription
// ---------------------------------------------------------------------------

describe("getSubscription", () => {
  it("returns json.data on success", async () => {
    sessionWith("tok-sub")
    const subData = { id: "s-1", tier: "pro", status: "active" }
    const mock = mockFetchJson({ data: subData })
    vi.stubGlobal("fetch", mock)

    const result = await getSubscription("u-5")

    expect(mock).toHaveBeenCalledWith(
      "/v1/billing/subscription?userId=u-5",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok-sub" },
      }),
    )
    expect(result).toEqual(subData)
  })

  it("returns null on non-ok response (does not throw)", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Not found" } }),
    )

    const result = await getSubscription("u-1")

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getTransactions
// ---------------------------------------------------------------------------

describe("getTransactions", () => {
  it("returns json.data on success", async () => {
    sessionWith("tok-tx")
    const txList = [{ id: "t-1", type: "subscription", amount_usd: 24 }]
    const mock = mockFetchJson({ data: txList })
    vi.stubGlobal("fetch", mock)

    const result = await getTransactions("u-2")

    expect(mock).toHaveBeenCalledWith(
      "/v1/billing/transactions?userId=u-2",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok-tx" },
      }),
    )
    expect(result).toEqual(txList)
  })

  it("returns empty array on non-ok response (does not throw)", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Server error" } }),
    )

    const result = await getTransactions("u-1")

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getManageSubscriptionUrl
// ---------------------------------------------------------------------------

describe("getManageSubscriptionUrl", () => {
  it("returns url from json.data.url on success", async () => {
    sessionWith("tok-mgmt")
    const mock = mockFetchJson({ data: { url: "https://billing.stripe.com/session/abc" } })
    vi.stubGlobal("fetch", mock)

    const result = await getManageSubscriptionUrl("u-8")

    expect(mock).toHaveBeenCalledWith(
      "/v1/billing/manage-subscription",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ userId: "u-8" })
    expect(result).toBe("https://billing.stripe.com/session/abc")
  })

  it("returns null on non-ok response (does not throw)", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: "no sub" }),
    )

    const result = await getManageSubscriptionUrl("u-1")

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// changePlan
// ---------------------------------------------------------------------------

describe("changePlan", () => {
  it("sends POST /v1/billing/change-plan and returns json.data", async () => {
    sessionWith("tok-cp")
    const mock = mockFetchJson({ data: { subscriptionId: "s-99", tier: "standard" } })
    vi.stubGlobal("fetch", mock)

    const result = await changePlan("u-3", "pri_new_plan")

    expect(mock).toHaveBeenCalledWith(
      "/v1/billing/change-plan",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ userId: "u-3", newPriceId: "pri_new_plan" })
    expect(result).toEqual({ subscriptionId: "s-99", tier: "standard" })
  })

  it("throws with error message from response on non-ok", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: "No active subscription" }),
    )

    await expect(changePlan("u-1", "pri_bad")).rejects.toThrow("No active subscription")
  })

  it("throws default message when error field is absent", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, {}),
    )

    await expect(changePlan("u-1", "pri_x")).rejects.toThrow("Failed to change plan")
  })
})

// ---------------------------------------------------------------------------
// uploadImage
// ---------------------------------------------------------------------------

describe("uploadImage", () => {
  const uploadResponse = {
    data: {
      url: "https://r2/file.png",
      thumbnailUrl: null,
      assetId: "a1",
      category: "image",
      filename: "f.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      metadata: null,
      r2Key: "key",
    },
  }

  it("converts Blob to File and uploads, returning { url }", async () => {
    noSession()
    const mock = mockFetchJson(uploadResponse)
    vi.stubGlobal("fetch", mock)

    const blob = new Blob(["pixels"], { type: "image/png" })
    const result = await uploadImage(blob, "u-img")

    expect(mock).toHaveBeenCalledWith(
      "/v1/upload",
      expect.objectContaining({ method: "POST" }),
    )
    const formData = mock.mock.calls[0][1].body as FormData
    expect(formData).toBeInstanceOf(FormData)
    const file = formData.get("file") as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe("crop.png")
    expect(formData.get("userId")).toBe("u-img")
    expect(result).toEqual({ url: "https://r2/file.png" })
  })

  it("passes File directly without conversion", async () => {
    noSession()
    const mock = mockFetchJson(uploadResponse)
    vi.stubGlobal("fetch", mock)

    const file = new File(["data"], "photo.jpg", { type: "image/jpeg" })
    const result = await uploadImage(file, "u-img2")

    const formData = mock.mock.calls[0][1].body as FormData
    const uploadedFile = formData.get("file") as File
    expect(uploadedFile.name).toBe("photo.jpg")
    expect(result).toEqual({ url: "https://r2/file.png" })
  })
})

// ---------------------------------------------------------------------------
// uploadAudio
// ---------------------------------------------------------------------------

describe("uploadAudio", () => {
  it("uploads audio file and returns { url }", async () => {
    noSession()
    const mock = mockFetchJson({
      data: {
        url: "https://r2/audio.mp3",
        thumbnailUrl: null,
        assetId: "a2",
        category: "audio",
        filename: "track.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: 2048,
        metadata: null,
        r2Key: "audio-key",
      },
    })
    vi.stubGlobal("fetch", mock)

    const file = new File(["audio-data"], "track.mp3", { type: "audio/mpeg" })
    const result = await uploadAudio(file, "u-aud")

    expect(mock).toHaveBeenCalledWith(
      "/v1/upload",
      expect.objectContaining({ method: "POST" }),
    )
    const formData = mock.mock.calls[0][1].body as FormData
    expect(formData.get("userId")).toBe("u-aud")
    expect(result).toEqual({ url: "https://r2/audio.mp3" })
  })

  it("uses getCurrentUserId when userId is not provided", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "tok-a", user: { id: "auto-uid" } } },
    })
    const mock = mockFetchJson({
      data: {
        url: "https://r2/audio2.mp3",
        thumbnailUrl: null,
        assetId: "a3",
        category: "audio",
        filename: "f.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: 512,
        metadata: null,
        r2Key: "k2",
      },
    })
    vi.stubGlobal("fetch", mock)

    const file = new File(["data"], "song.mp3", { type: "audio/mpeg" })
    const result = await uploadAudio(file)

    const formData = mock.mock.calls[0][1].body as FormData
    expect(formData.get("userId")).toBe("auto-uid")
    expect(result).toEqual({ url: "https://r2/audio2.mp3" })
  })
})

// ---------------------------------------------------------------------------
// downloadYouTubeAudio
// ---------------------------------------------------------------------------

describe("downloadYouTubeAudio", () => {
  it("sends POST /v1/youtube-audio with url body and returns result", async () => {
    sessionWith("tok-yt")
    const payload = { url: "https://r2/yt-audio.mp3", thumbnailUrl: "https://yt/thumb.jpg" }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await downloadYouTubeAudio("https://youtube.com/watch?v=abc")

    expect(mock).toHaveBeenCalledWith(
      "/v1/youtube-audio",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ url: "https://youtube.com/watch?v=abc" })
    expect(result).toEqual(payload)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Invalid YouTube URL" } }),
    )

    await expect(
      downloadYouTubeAudio("bad-url"),
    ).rejects.toThrow("Invalid YouTube URL")
  })
})

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe("getStats", () => {
  it("sends GET /v1/stats with scope and userId query params", async () => {
    sessionWith("tok-stats")
    const payload = { data: { totalExecutions: 42, successful: 40, failed: 2 } }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await getStats("platform", "u-admin")

    const calledUrl = mock.mock.calls[0][0] as string
    expect(calledUrl).toContain("/v1/stats?")
    expect(calledUrl).toContain("scope=platform")
    expect(calledUrl).toContain("userId=u-admin")
    expect(result).toEqual(payload)
  })

  it("defaults scope to 'user' and throws on non-ok", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(403, { error: { message: "Forbidden" } }),
    )

    await expect(getStats()).rejects.toThrow("Forbidden")
  })
})

// ---------------------------------------------------------------------------
// splitImage
// ---------------------------------------------------------------------------

describe("splitImage", () => {
  it("sends POST /v1/split-image with correct body and returns images", async () => {
    sessionWith("tok-split")
    const payload = {
      images: [
        { name: "cell-1", url: "https://r2/c1.png" },
        { name: "cell-2", url: "https://r2/c2.png" },
      ],
    }
    const mock = mockFetchJson(payload)
    vi.stubGlobal("fetch", mock)

    const result = await splitImage({
      imageUrl: "https://r2/original.png",
      gridCols: 2,
      gridRows: 1,
      names: ["cell-1", "cell-2"],
    })

    expect(mock).toHaveBeenCalledWith(
      "/v1/split-image",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      imageUrl: "https://r2/original.png",
      gridCols: 2,
      gridRows: 1,
      names: ["cell-1", "cell-2"],
    })
    expect(result).toEqual(payload)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Invalid grid" } }),
    )

    await expect(
      splitImage({ imageUrl: "u", gridCols: 0, gridRows: 0, names: [] }),
    ).rejects.toThrow("Invalid grid")
  })
})
