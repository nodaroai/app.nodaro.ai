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

  // C1 regression guard on the actual inline/modal runtime surface (the hook):
  // a wired start frame must NOT appear as a {image:N} item, and the reference
  // image must be numbered 1 — matching the config panel + backend
  // `countRefModalityEdges` (frames excluded). Pre-fix the frame stole index 1
  // and the reference shifted to {image:2} → out-of-range → silently dropped.
  it("excludes a wired start frame from {image:N} and numbers the reference 1", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "frame", type: "upload-image", position: { x: 0, y: 0 }, data: { type: "upload-image", url: "https://r2/start.png" } },
        { id: "ref1", type: "upload-image", position: { x: 0, y: 120 }, data: { type: "upload-image", url: "https://r2/ref1.png" } },
        { id: "v1", type: "generate-video", position: { x: 300, y: 0 }, data: { type: "generate-video", prompt: "", label: "Vid" } },
      ] as never,
      edges: [
        // Frame edge FIRST so the pre-fix frame-blind numbering would give it index 1.
        { id: "e_frame", source: "frame", target: "v1", sourceHandle: "image", targetHandle: "startFrame" } as never,
        { id: "e_ref", source: "ref1", target: "v1", sourceHandle: "image", targetHandle: "imageReferences" } as never,
      ],
    })
    const { result } = renderHook(() => usePromptEditorRefs("v1"), { wrapper })
    const imgs = result.current.referenceImages
    // The start frame is NOT a {image:N} reference.
    expect(imgs.find((i) => i.url === "https://r2/start.png")).toBeUndefined()
    // The reference image is numbered 1 (slot 1 of the backend reference_image_urls).
    expect(imgs.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
  })
})
