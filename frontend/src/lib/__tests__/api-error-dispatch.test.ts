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
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  editImage,
  StorageExceededError,
  InsufficientCreditsError,
  CharacterNameTakenError,
  PortraitRequiredError,
  TutorialCategoryInUseError,
  ConcurrentModificationError,
  DedupRaceRetryableError,
} from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchError(status: number, errBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(errBody),
    text: () => Promise.resolve(JSON.stringify(errBody)),
  })
}

/** Build a fetch mock that rejects res.json() (mimics a non-JSON/empty body). */
function mockFetchUnparseable(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    text: () => Promise.resolve(""),
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

beforeEach(() => {
  mockGetSession.mockReset()
  noSession()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// throwApiError dispatch — driven through ONE representative POST function
// (editImage). Every api.ts function funnels its error body through the same
// throwApiError(err, fallback) call, so pinning the full code→class mapping
// here characterizes the shared error path the future apiJson() helper must
// preserve byte-for-byte.
// ---------------------------------------------------------------------------

describe("throwApiError dispatch (via editImage)", () => {
  // -- storage_limit_exceeded -> StorageExceededError ----------------------

  it("storage_limit_exceeded throws StorageExceededError with all fields", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(413, {
        error: {
          code: "storage_limit_exceeded",
          message: "Out of space",
          usedBytes: 900,
          quotaBytes: 1000,
          remainingBytes: 100,
          tier: "pro",
        },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(StorageExceededError)
      const e = err as StorageExceededError
      expect(e.name).toBe("StorageExceededError")
      expect(e.message).toBe("Out of space")
      expect(e.usedBytes).toBe(900)
      expect(e.quotaBytes).toBe(1000)
      expect(e.remainingBytes).toBe(100)
      expect(e.tier).toBe("pro")
    }
  })

  it("storage_limit_exceeded defaults numeric fields to 0 and tier to 'free' when absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(413, { error: { code: "storage_limit_exceeded" } }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(StorageExceededError)
      const e = err as StorageExceededError
      // message falls back to the function's fallback label
      expect(e.message).toBe("Failed to start image editing")
      expect(e.usedBytes).toBe(0)
      expect(e.quotaBytes).toBe(0)
      expect(e.remainingBytes).toBe(0)
      expect(e.tier).toBe("free")
    }
  })

  // -- insufficient_credits / insufficient_app_credits ---------------------

  it("insufficient_credits throws InsufficientCreditsError with code + appCreditsAllowance", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(402, {
        error: {
          code: "insufficient_credits",
          message: "Not enough credits",
          appCreditsAllowance: 5,
        },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientCreditsError)
      const e = err as InsufficientCreditsError
      expect(e.name).toBe("InsufficientCreditsError")
      expect(e.message).toBe("Not enough credits")
      expect(e.code).toBe("insufficient_credits")
      expect(e.appCreditsAllowance).toBe(5)
    }
  })

  it("insufficient_app_credits also throws InsufficientCreditsError carrying that code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(402, {
        error: {
          code: "insufficient_app_credits",
          message: "App credits exhausted",
        },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientCreditsError)
      const e = err as InsufficientCreditsError
      expect(e.code).toBe("insufficient_app_credits")
      // appCreditsAllowance defaults to 0 when absent
      expect(e.appCreditsAllowance).toBe(0)
    }
  })

  // -- name_taken -> CharacterNameTakenError -------------------------------

  it("name_taken throws CharacterNameTakenError with the message", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, {
        error: { code: "name_taken", message: "That name is used" },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(CharacterNameTakenError)
      const e = err as CharacterNameTakenError
      expect(e.name).toBe("CharacterNameTakenError")
      expect(e.message).toBe("That name is used")
    }
  })

  it("name_taken falls back to its own default message (NOT the function fallback) when message absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, { error: { code: "name_taken" } }),
    )

    await expect(editImage("http://img.png")).rejects.toThrow(
      "Name already in use.",
    )
  })

  // -- portrait_required -> PortraitRequiredError --------------------------

  it("portrait_required throws PortraitRequiredError with the message", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, {
        error: { code: "portrait_required", message: "Need a portrait" },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(PortraitRequiredError)
      expect((err as PortraitRequiredError).name).toBe("PortraitRequiredError")
      expect((err as PortraitRequiredError).message).toBe("Need a portrait")
    }
  })

  it("portrait_required falls back to its own default message when message absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { code: "portrait_required" } }),
    )

    await expect(editImage("http://img.png")).rejects.toThrow(
      "Generate a portrait first — open the Appearance tab",
    )
  })

  // -- category_in_use -> TutorialCategoryInUseError -----------------------

  it("category_in_use throws TutorialCategoryInUseError with videoCount + flowCount", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, {
        error: {
          code: "category_in_use",
          message: "Category still referenced",
          videoCount: 3,
          flowCount: 7,
        },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(TutorialCategoryInUseError)
      const e = err as TutorialCategoryInUseError
      expect(e.name).toBe("TutorialCategoryInUseError")
      expect(e.message).toBe("Category still referenced")
      expect(e.videoCount).toBe(3)
      expect(e.flowCount).toBe(7)
    }
  })

  it("category_in_use defaults videoCount/flowCount to 0 when absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, { error: { code: "category_in_use" } }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      const e = err as TutorialCategoryInUseError
      expect(e).toBeInstanceOf(TutorialCategoryInUseError)
      expect(e.videoCount).toBe(0)
      expect(e.flowCount).toBe(0)
      // message falls back to the function fallback label
      expect(e.message).toBe("Failed to start image editing")
    }
  })

  // -- concurrent_modification -> ConcurrentModificationError --------------

  it("concurrent_modification throws ConcurrentModificationError with updatedAt", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, {
        error: {
          code: "concurrent_modification",
          message: "Row changed",
          updatedAt: "2026-05-31T12:00:00.000Z",
        },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ConcurrentModificationError)
      const e = err as ConcurrentModificationError
      expect(e.name).toBe("ConcurrentModificationError")
      expect(e.message).toBe("Row changed")
      expect(e.updatedAt).toBe("2026-05-31T12:00:00.000Z")
    }
  })

  it("concurrent_modification defaults updatedAt to empty string when absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, { error: { code: "concurrent_modification" } }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      const e = err as ConcurrentModificationError
      expect(e).toBeInstanceOf(ConcurrentModificationError)
      expect(e.updatedAt).toBe("")
    }
  })

  // -- dedup_race_winner_unresolvable -> DedupRaceRetryableError -----------

  it("dedup_race_winner_unresolvable throws DedupRaceRetryableError with retryAfterSeconds", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(503, {
        error: {
          code: "dedup_race_winner_unresolvable",
          message: "Retry shortly",
          retryAfterSeconds: 4,
        },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(DedupRaceRetryableError)
      const e = err as DedupRaceRetryableError
      expect(e.name).toBe("DedupRaceRetryableError")
      expect(e.message).toBe("Retry shortly")
      expect(e.retryAfterSeconds).toBe(4)
    }
  })

  it("dedup_race_winner_unresolvable defaults retryAfterSeconds to 2 when absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(503, {
        error: { code: "dedup_race_winner_unresolvable" },
      }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      const e = err as DedupRaceRetryableError
      expect(e).toBeInstanceOf(DedupRaceRetryableError)
      expect(e.retryAfterSeconds).toBe(2)
    }
  })

  // -- generic / fallback paths --------------------------------------------

  it("generic error (message, no special code) throws a plain Error with that message", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Some plain failure" } }),
    )

    try {
      await editImage("http://img.png")
      throw new Error("did not throw")
    } catch (err) {
      // It must be a PLAIN Error, not any of the typed subclasses.
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(StorageExceededError)
      expect(err).not.toBeInstanceOf(InsufficientCreditsError)
      expect((err as Error).name).toBe("Error")
      expect((err as Error).message).toBe("Some plain failure")
    }
  })

  it("unknown code falls through to a plain Error with the body message", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, {
        error: { code: "some_unmapped_code", message: "Mapped message wins" },
      }),
    )

    await expect(editImage("http://img.png")).rejects.toThrow(
      "Mapped message wins",
    )
  })

  it("error body with no message and no code throws Error using the function fallback label", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, { error: {} }))

    await expect(editImage("http://img.png")).rejects.toThrow(
      "Failed to start image editing",
    )
  })

  it("empty/null body (res.json() rejects) throws Error with the function fallback label", async () => {
    vi.stubGlobal("fetch", mockFetchUnparseable(500))

    await expect(editImage("http://img.png")).rejects.toThrow(
      "Failed to start image editing",
    )
  })

  it("body without an `error` envelope throws Error with the function fallback label", async () => {
    // No top-level `error` key at all — errObj is undefined.
    vi.stubGlobal("fetch", mockFetchError(500, { message: "ignored top-level" }))

    await expect(editImage("http://img.png")).rejects.toThrow(
      "Failed to start image editing",
    )
  })
})
