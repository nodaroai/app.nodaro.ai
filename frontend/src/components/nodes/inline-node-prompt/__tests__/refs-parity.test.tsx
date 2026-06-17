import { describe, it, expect, vi } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// useSnippetPool() → useAuth() reaches for useNavigate()/supabase, neither of
// which exist under renderHook. Stub the logged-out contract (user: null) — the
// real hook's return when signed out — so the snippet query stays disabled and
// the pool is []. Mirrors use-prompt-editor-refs.test.tsx.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null }),
}))

import { usePromptEditorRefs } from "../use-prompt-editor-refs"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// A generate-video node with an upstream character + image connection produces
// the SAME @-candidate set regardless of surface (config panel / modal / inline)
// because all three now call usePromptEditorRefs.
describe("usePromptEditorRefs parity", () => {
  it("includes connected references for a video node (no empty/degenerate set)", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "char1", type: "character", position: { x: 0, y: 0 }, data: { type: "character", label: "Alice", generatedImageUrl: "https://example.com/alice.png" } },
        { id: "v1", type: "generate-video", position: { x: 300, y: 0 }, data: { type: "generate-video", prompt: "", label: "Vid" } },
      ] as never,
      edges: [
        { id: "e1", source: "char1", target: "v1", sourceHandle: "characterRef", targetHandle: "references" } as never,
      ],
    })
    const { result } = renderHook(() => usePromptEditorRefs("v1"), { wrapper })
    // The image builder is null-safe on video data and surfaces the wired character.
    expect(result.current.referenceImages.length).toBeGreaterThan(0)
  })
})
