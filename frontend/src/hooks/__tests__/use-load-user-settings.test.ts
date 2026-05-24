import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — the hook reads the React Query result + the auth user, then pushes
// the loaded settings into the workflow store + locale store via getState().
// ---------------------------------------------------------------------------

const mockSetUserPromptTemplates = vi.fn()
const mockSetUserTextTemplates = vi.fn()
const mockMarkHydrated = vi.fn()

let mockUser: { id: string } | null = { id: "u1" }
let mockData: Record<string, unknown> | undefined

vi.mock("../use-auth", () => ({
  useAuth: () => ({ user: mockUser }),
}))

vi.mock("../queries/use-user-settings-queries", () => ({
  useUserSettings: () => ({ data: mockData }),
}))

vi.mock("../use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      setUserPromptTemplates: mockSetUserPromptTemplates,
      setUserTextTemplates: mockSetUserTextTemplates,
    }),
  },
}))

vi.mock("@/lib/locale-store", () => ({
  useLocaleStore: {
    getState: () => ({ markHydrated: mockMarkHydrated }),
  },
}))

import { useLoadUserSettings } from "../use-load-user-settings"

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { id: "u1" }
  mockData = undefined
})

describe("useLoadUserSettings", () => {
  it("does nothing when there is no data", () => {
    mockData = undefined
    renderHook(() => useLoadUserSettings())
    expect(mockSetUserPromptTemplates).not.toHaveBeenCalled()
    expect(mockSetUserTextTemplates).not.toHaveBeenCalled()
  })

  it("sets userTextTemplates from data.textTemplates", () => {
    const textTemplates = [
      { id: "t1", label: "Blog Outline", systemPrompt: "You write blog outlines." },
    ]
    mockData = { promptTemplates: { k: "v" }, textTemplates, preferredLocale: "en" }
    renderHook(() => useLoadUserSettings())
    expect(mockSetUserPromptTemplates).toHaveBeenCalledWith({ k: "v" })
    expect(mockSetUserTextTemplates).toHaveBeenCalledWith(textTemplates)
  })

  it("defaults userTextTemplates to [] when data.textTemplates is missing", () => {
    mockData = { promptTemplates: {}, preferredLocale: null }
    renderHook(() => useLoadUserSettings())
    expect(mockSetUserTextTemplates).toHaveBeenCalledWith([])
  })
})
