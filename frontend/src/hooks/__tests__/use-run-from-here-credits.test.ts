import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

// "Run from here" on a node quotes the run's own estimate: the set the run's
// confirm gate prices (runFromHereExecutable) through estimateRunCredits —
// the live price of the id each node will reserve. A Text node's button used
// to sum static fallback figures: no markup and blind to the tier (it quoted
// Pro's ten-minute Video Analysis row, 1059, for a Fast run charged 933).

const cache = new Map<string, number>()
const fetched: string[][] = []
vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: (id: string) => cache.get(id),
  prefetchModelCreditCosts: async (ids: string[]) => {
    fetched.push([...ids])
    for (const id of ids) cache.set(id, id.includes("gemini-3-flash") ? 933 : 11)
  },
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useRunFromHereCredits } from "../use-run-from-here-credits"
import { runFromHereExecutable } from "@/components/editor/workflow-editor/run-from-here-set"

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as never
const edge = (source: string, target: string, targetHandle = "in") =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as never

beforeEach(() => {
  cache.clear()
  fetched.length = 0
})

describe("useRunFromHereCredits", () => {
  it("prices the downstream Video Analysis at its own tier's live price, fetched when not cached", async () => {
    useWorkflowStore.setState({
      nodes: [
        node("t", "text-prompt", { text: "https://www.tiktok.com/@a/video/1" }),
        node("va", "video-analysis", { llmModel: "gemini-3-flash" }),
      ],
      edges: [edge("t", "va", "video")],
    } as never)
    const { result } = renderHook(() => useRunFromHereCredits("t"))
    await waitFor(() => expect(result.current).toBe(933))
    expect(fetched.flat().some((id) => id.includes("gemini-3-flash"))).toBe(true)
  })

  it("quotes nothing when nothing executable is downstream", () => {
    useWorkflowStore.setState({ nodes: [node("t", "text-prompt")], edges: [] } as never)
    const { result } = renderHook(() => useRunFromHereCredits("t"))
    expect(result.current).toBe(0)
  })
})

describe("runFromHereExecutable", () => {
  it("is every live executable node downstream — the set the confirm gate prices", () => {
    const nodes = [
      node("t", "text-prompt"),
      node("img", "generate-image"),
      node("vid", "generate-video"),
      node("other", "generate-image"),
    ]
    const edges = [edge("t", "img"), edge("img", "vid")]
    expect(runFromHereExecutable("t", nodes, edges).map((n: { id: string }) => n.id)).toEqual(["img", "vid"])
  })
})
