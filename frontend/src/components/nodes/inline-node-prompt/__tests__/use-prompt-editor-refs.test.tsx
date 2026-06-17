import { describe, it, expect, vi } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// useSnippetPool() → useAuth() reaches for useNavigate()/supabase, neither of
// which exist under renderHook. Stub the logged-out contract (user: null) — the
// real hook's return when signed out — so the snippet query stays disabled and
// the pool is []. Mirrors the established @/hooks/use-auth mock in sibling tests.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null }),
}))

import { usePromptEditorRefs } from "../use-prompt-editor-refs"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function seedSingleGenerateImageNode() {
  useWorkflowStore.setState({
    nodes: [
      {
        id: "n1",
        type: "generate-image",
        position: { x: 0, y: 0 },
        data: { type: "generate-image", prompt: "", label: "Gen" },
      } as never,
    ],
    edges: [],
  })
}

describe("usePromptEditorRefs", () => {
  it("returns the four prompt-editor inputs with stable identity across re-renders", () => {
    seedSingleGenerateImageNode()
    const { result, rerender } = renderHook(() => usePromptEditorRefs("n1"), { wrapper })
    expect(result.current).toHaveProperty("referenceImages")
    expect(result.current).toHaveProperty("nodeRefs")
    expect(result.current).toHaveProperty("refMap")
    expect(result.current).toHaveProperty("promptSnippets")
    expect(Array.isArray(result.current.referenceImages)).toBe(true)
    expect(result.current.refMap instanceof Map).toBe(true)
    const before = result.current
    rerender()
    // No topology/data change → memoized identity holds (no per-keystroke churn).
    expect(result.current.nodeRefs).toBe(before.nodeRefs)
    expect(result.current.refMap).toBe(before.refMap)
  })
})
