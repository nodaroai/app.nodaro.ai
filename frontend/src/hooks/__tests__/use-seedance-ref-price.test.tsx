/**
 * What a Generate Video / Video to Video node shows for a Seedance run with a
 * reference video: the server's quote when exact; the range "shortest clip –
 * worst case" (and the worst case on Run) while a clip is not produced yet;
 * and NO figure while the quote loads or was refused — never the row price,
 * which is below what the run reserves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

const quote = vi.hoisted(() => ({ value: undefined as undefined | { credits: number; min: number; exact: boolean }, keys: [] as Array<string | undefined> }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  useSeedanceRefQuote: (key: string | undefined) => {
    quote.keys.push(key)
    return key ? quote.value : undefined
  },
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useNodeVideoPrice } from "../use-seedance-ref-price"

const upload = { id: "clip", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "clip", url: "https://cdn.example/clip.mp4" } }
const gv = { id: "gv", type: "generate-video", position: { x: 0, y: 0 }, data: { label: "gv", provider: "seedance-2-5", duration: 8 } }
const wire = { id: "e", source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }

function setGraph(wired: boolean) {
  useWorkflowStore.setState({ nodes: [upload, gv] as never, edges: (wired ? [wire] : []) as never })
}

beforeEach(() => {
  quote.value = undefined
  quote.keys = []
})

describe("useNodeVideoPrice", () => {
  it("no reference video: the row price", () => {
    setGraph(false)
    const { result } = renderHook(() => useNodeVideoPrice("gv", 760))
    expect(result.current).toEqual({ credits: 760, creditsRange: undefined, runCredits: 760, quoted: false })
  })

  it("quote loading: no figure rather than the row price", () => {
    setGraph(true)
    const { result } = renderHook(() => useNodeVideoPrice("gv", 760))
    expect(result.current).toEqual({ credits: undefined, creditsRange: undefined, runCredits: 0, quoted: true })
    expect(quote.keys.at(-1)).toMatch(/^seedance-ref-quote:/)
  })

  it("exact quote: that figure on the node and on Run", () => {
    setGraph(true)
    quote.value = { credits: 1911, min: 1911, exact: true }
    const { result } = renderHook(() => useNodeVideoPrice("gv", 760))
    expect(result.current).toEqual({ credits: 1911, creditsRange: undefined, runCredits: 1911, quoted: true })
  })

  it("a clip not produced yet: the range on the node, the worst case on Run", () => {
    setGraph(true)
    quote.value = { credits: 5700, min: 950, exact: false }
    const { result } = renderHook(() => useNodeVideoPrice("gv", 760))
    expect(result.current).toEqual({ credits: undefined, creditsRange: { min: 950, max: 5700 }, runCredits: 5700, quoted: true })
  })
})
