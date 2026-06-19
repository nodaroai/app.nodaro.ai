import { describe, it, expect, vi } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// useSnippetPool → useAuth reaches for supabase/useNavigate (absent under
// renderHook). Stub logged-out so the snippet query stays disabled and the pool
// is []. Mirrors refs-parity.test.tsx.
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }))

import { useNodeFinalPrompt } from "@/components/editor/config-panels/use-node-final-prompt"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// useNodeFinalPrompt drives the canvas node's "Final" / "Both" view. It must
// assemble through the SAME machinery as the config panel's final view
// (getConnectedSources → buildImageConnectedReferences → useFinalPromptSegments)
// so node-Final == panel-Final == what the run sends.
describe("useNodeFinalPrompt — generate-image", () => {
  it("assembles typed prompt + auto-injected look hint (faithful to run)", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "hp", type: "held-prop", position: { x: 0, y: 0 }, data: { type: "held-prop", label: "Prop", heldProp: "smartphone" } },
        { id: "g1", type: "generate-image", position: { x: 300, y: 0 }, data: { type: "generate-image", label: "Gen", prompt: "a cat in a hat", provider: "nano-banana-pro" } },
      ] as never,
      edges: [{ id: "e1", source: "hp", target: "g1", sourceHandle: "out", targetHandle: "look" } as never],
      characterDefinitions: [] as never,
    })
    const { result } = renderHook(() => useNodeFinalPrompt("g1"), { wrapper })
    expect(result.current.promptText).toContain("a cat in a hat")
    // the held-prop wired to `look` is auto-injected by the shared machinery
    expect(result.current.promptText.toLowerCase()).toContain("smartphone")
  })

  it("is clean (typed only) when nothing is wired", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "g1", type: "generate-image", position: { x: 0, y: 0 }, data: { type: "generate-image", label: "Gen", prompt: "a quiet lake", provider: "nano-banana-pro" } },
      ] as never,
      edges: [] as never,
      characterDefinitions: [] as never,
    })
    const { result } = renderHook(() => useNodeFinalPrompt("g1"), { wrapper })
    expect(result.current.promptText).toContain("a quiet lake")
    expect(result.current.promptText.toLowerCase()).not.toContain("smartphone")
  })
})
