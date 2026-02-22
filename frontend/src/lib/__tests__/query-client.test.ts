import { describe, it, expect, vi, beforeEach } from "vitest"
import { QueryClient } from "@tanstack/react-query"

const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

import { queryClient } from "../query-client"

describe("queryClient", () => {
  beforeEach(() => {
    mockToastError.mockClear()
  })

  it("is a QueryClient instance", () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })

  describe("default query options", () => {
    const queryDefaults = queryClient.getDefaultOptions().queries

    it("has staleTime of 60_000 (1 minute)", () => {
      expect(queryDefaults?.staleTime).toBe(60_000)
    })

    it("has gcTime of 300_000 (5 minutes)", () => {
      expect(queryDefaults?.gcTime).toBe(300_000)
    })

    it("has retry set to 1", () => {
      expect(queryDefaults?.retry).toBe(1)
    })

    it("has refetchOnWindowFocus disabled", () => {
      expect(queryDefaults?.refetchOnWindowFocus).toBe(false)
    })
  })

  describe("default mutation onError", () => {
    it("calls toast.error with the error message for Error instances", () => {
      const onError = queryClient.getDefaultOptions().mutations?.onError
      expect(onError).toBeTypeOf("function")

      ;(onError as Function)(new Error("test error"), "", undefined, undefined)

      expect(mockToastError).toHaveBeenCalledOnce()
      expect(mockToastError).toHaveBeenCalledWith("test error")
    })

    it("calls toast.error with fallback message for non-Error objects", () => {
      const onError = queryClient.getDefaultOptions().mutations?.onError
      expect(onError).toBeTypeOf("function")

      ;(onError as Function)("string error", "", undefined, undefined)

      expect(mockToastError).toHaveBeenCalledOnce()
      expect(mockToastError).toHaveBeenCalledWith("Something went wrong")
    })
  })
})
