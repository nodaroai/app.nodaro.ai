import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so class is available when vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockUploadFile, MockStorageExceededError } = vi.hoisted(() => {
  const mockUploadFile = vi.fn()

  class MockStorageExceededError extends Error {
    readonly usedBytes: number
    readonly quotaBytes: number
    readonly remainingBytes: number
    readonly tier: string

    constructor(message: string, usedBytes: number, quotaBytes: number, remainingBytes: number, tier: string) {
      super(message)
      this.name = "StorageExceededError"
      this.usedBytes = usedBytes
      this.quotaBytes = quotaBytes
      this.remainingBytes = remainingBytes
      this.tier = tier
    }
  }

  return { mockUploadFile, MockStorageExceededError }
})

vi.mock("@/lib/api", () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  StorageExceededError: MockStorageExceededError,
}))

vi.mock("../use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))

// ---------------------------------------------------------------------------
// Import (after mocks)
// ---------------------------------------------------------------------------

import { useFileUpload } from "../use-file-upload"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("has correct initial state", () => {
    const { result } = renderHook(() => useFileUpload())

    expect(result.current.isUploading).toBe(false)
    expect(result.current.uploadError).toBeNull()
    expect(result.current.storageExceeded.exceeded).toBe(false)
  })

  it("returns upload result on success", async () => {
    const uploadResult = { url: "https://example.com/file.png", key: "file.png" }
    mockUploadFile.mockResolvedValue(uploadResult)
    const { result } = renderHook(() => useFileUpload())

    let returned: unknown
    await act(async () => {
      returned = await result.current.upload(new File(["test"], "test.png"))
    })

    expect(returned).toEqual(uploadResult)
    expect(result.current.isUploading).toBe(false)
    expect(result.current.uploadError).toBeNull()
  })

  it("sets uploadError on generic Error", async () => {
    mockUploadFile.mockRejectedValue(new Error("Network error"))
    const { result } = renderHook(() => useFileUpload())

    let caught: unknown
    await act(async () => {
      try {
        await result.current.upload(new File(["test"], "test.png"))
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(result.current.uploadError).toBe("Network error")
    expect(result.current.isUploading).toBe(false)
  })

  it("sets storageExceeded state on StorageExceededError", async () => {
    const err = new MockStorageExceededError("Storage full", 900, 1000, 100, "free")
    mockUploadFile.mockRejectedValue(err)
    const { result } = renderHook(() => useFileUpload())

    let caught: unknown
    await act(async () => {
      try {
        await result.current.upload(new File(["test"], "test.png"))
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(MockStorageExceededError)
    expect(result.current.storageExceeded.exceeded).toBe(true)
    expect(result.current.storageExceeded.usedBytes).toBe(900)
    expect(result.current.storageExceeded.quotaBytes).toBe(1000)
    expect(result.current.storageExceeded.remainingBytes).toBe(100)
    expect(result.current.storageExceeded.tier).toBe("free")
  })

  it("re-throws the error after setting state", async () => {
    const error = new Error("Upload failed")
    mockUploadFile.mockRejectedValue(error)
    const { result } = renderHook(() => useFileUpload())

    let caught: unknown
    await act(async () => {
      try {
        await result.current.upload(new File(["test"], "test.png"))
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBe(error)
  })

  it("clearError resets uploadError to null", async () => {
    mockUploadFile.mockRejectedValue(new Error("fail"))
    const { result } = renderHook(() => useFileUpload())

    await act(async () => {
      try {
        await result.current.upload(new File(["test"], "test.png"))
      } catch {
        // expected
      }
    })

    expect(result.current.uploadError).toBe("fail")

    act(() => {
      result.current.clearError()
    })

    expect(result.current.uploadError).toBeNull()
  })

  it("clearStorageExceeded resets storage state", async () => {
    const err = new MockStorageExceededError("Storage full", 900, 1000, 100, "free")
    mockUploadFile.mockRejectedValue(err)
    const { result } = renderHook(() => useFileUpload())

    await act(async () => {
      try {
        await result.current.upload(new File(["test"], "test.png"))
      } catch {
        // expected
      }
    })

    expect(result.current.storageExceeded.exceeded).toBe(true)

    act(() => {
      result.current.clearStorageExceeded()
    })

    expect(result.current.storageExceeded.exceeded).toBe(false)
  })

  it("passes user id to uploadFile", async () => {
    mockUploadFile.mockResolvedValue({ url: "https://example.com/f.png", key: "f.png" })
    const { result } = renderHook(() => useFileUpload())
    const file = new File(["test"], "test.png")

    await act(async () => {
      await result.current.upload(file)
    })

    expect(mockUploadFile).toHaveBeenCalledWith(file, "user-1")
  })
})
