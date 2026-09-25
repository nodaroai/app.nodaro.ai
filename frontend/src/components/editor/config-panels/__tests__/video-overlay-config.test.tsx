// frontend/src/components/editor/config-panels/__tests__/video-overlay-config.test.tsx
/**
 * The Video Overlay panel (UX §2): the base line, the read-only timeline whose
 * bar selects (and so seeks) a layer, the per-slot validator messages in the
 * user's language, the advisory clipped hint, and the preset radiogroup.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useVideoOverlaySelectionStore } from "@/hooks/use-video-overlay-selection"
import type { VideoOverlayData } from "@/types/nodes"
import { assembleVideoOverlayRequest, validateVideoOverlayRequest } from "@nodaro/shared"
import { VideoOverlayConfig } from "../video-overlay-config"

const BASE = "https://x/base.mp4"

function renderPanel(data: Partial<VideoOverlayData>) {
  const full = { label: "Video Overlay", fieldMappings: {}, layers: [], ...data } as VideoOverlayData
  useWorkflowStore.setState({ isReadOnly: false, nodes: [{ id: "vo", type: "video-overlay", position: { x: 0, y: 0 }, data: full }], edges: [] } as never)
  render(
    <VideoOverlayConfig
      nodeId="vo"
      data={full}
      onUpdate={vi.fn()}
      sources={[
        { id: "b", type: "upload-video", label: "Base", value: BASE, targetHandle: "video" },
        { id: "i", type: "upload-image", label: "Card", value: "https://x/a.png", targetHandle: "overlay" },
      ]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />,
  )
}

beforeEach(() => useVideoOverlaySelectionStore.setState({ selected: {} }))

describe("VideoOverlayConfig", () => {
  it("shows the probed base, one bar per used layer, and the advisory clipped hint", () => {
    renderPanel({ layers: [{ start: 1, end: 3, preset: "card" }], probedVideo: { url: BASE, durationSec: 2.5, width: 1080, height: 1920 } })
    expect(screen.getByText("Base: 1080×1920 · 2.5 s")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Layer 1, 1–3 s" })).toBeInTheDocument()
    expect(screen.getByText("Clipped to the video end (2.5 s)")).toBeInTheDocument()
    // Placement is folded in the sidebar; its summary names the preset.
    const placement = screen.getAllByRole("button", { name: /Placement/ })[0]!
    expect(placement).toHaveTextContent("Card")
    fireEvent.click(placement)
    expect(screen.getByRole("radio", { name: "Card" })).toHaveAttribute("aria-checked", "true")
  })

  it("a bar click selects the layer for the node's stage", () => {
    renderPanel({ layers: [{ start: 1, end: 3 }], probedVideo: { url: BASE, durationSec: 5 } })
    fireEvent.click(screen.getByRole("button", { name: "Layer 1, 1–3 s" }))
    expect(useVideoOverlaySelectionStore.getState().selected.vo).toBe(0)
  })

  it("renders the validator's code in the user's words, never its English", () => {
    renderPanel({ layers: [{ start: 5, end: 4 }] })
    expect(screen.getByRole("alert")).toHaveTextContent("End must be after start")
  })

  // A partial box comes back from the normaliser untouched (so `incomplete_box`
  // fires), unknown `preset` tag and missing fields included. Workflow JSON
  // writers (update_workflow_json, templates, REST full-body saves) can store
  // one; the card must still render so the user can fix the layer.
  it.each([
    ["an unknown preset with a partial box", { preset: "banner", x: 10 }],
    ["a misspelt preset with only an anchor", { preset: "cardd", anchor: "top" }],
    ["a partial box without a preset", { x: 10 }],
  ])("%s renders the incomplete_box alert as Custom, never a crash or NaN", (_name, layer) => {
    renderPanel({ layers: [layer as never], probedVideo: { url: BASE, durationSec: 5 } })
    expect(screen.getByRole("alert")).toHaveTextContent("A custom box needs an anchor and a width")
    const placement = screen.getAllByRole("button", { name: /Placement/ })[0]!
    expect(placement).toHaveTextContent("Custom")
    fireEvent.click(placement)
    expect(screen.getByRole("radio", { name: "Custom" })).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getAllByRole("button", { name: /Look/ })[0]!)
    expect(screen.getByRole("button", { name: "Layer 1, from 0 s to the end" })).toBeInTheDocument()
    // Text AND attributes (the bar's aria-label, slider values, left: …%).
    expect(document.body.innerHTML).not.toContain("NaN")
  })

  it("a failed probe says so instead of reading forever", () => {
    renderPanel({ probedVideo: { url: BASE, error: true } })
    expect(screen.getByText("Length unknown — enter times in seconds")).toBeInTheDocument()
  })

  // A JSON-written node (MCP, a template, a full-body save) can store more than
  // 20 imaged layers; the run refuses it (too_many_layers). The panel lists
  // every stored layer, so the normal remove button brings it down to 20.
  it("lists every stored layer past 20, so removing the extras clears the too_many_layers refusal", () => {
    const layers = Array.from({ length: 24 }, (_, i) => ({ imageUrl: `https://x/${i}.png`, start: 0 }))
    renderPanel({ layers })
    const removes = screen.getAllByRole("button", { name: "Remove layer" })
    expect(removes).toHaveLength(24)
    const verdict = () => {
      const data = useWorkflowStore.getState().nodes[0]!.data as VideoOverlayData
      return validateVideoOverlayRequest(assembleVideoOverlayRequest({ videoUrl: BASE, data, wiredImageUrls: ["https://x/a.png"] }))
    }
    expect(verdict()).toMatchObject({ ok: false, code: "too_many_layers", params: { count: 24 } })
    // The panel's `data` prop is static here: remove layers 21–24 by their own cards.
    for (const i of [23, 22, 21, 20]) fireEvent.click(removes[i]!)
    expect((useWorkflowStore.getState().nodes[0]!.data as VideoOverlayData).layers).toHaveLength(20)
    expect(verdict()).toEqual({ ok: true })
  })

  // Removing the FIRST four instead: removal never re-numbers (a handle and its
  // slot stay aligned), so the 20 remaining layers keep slots 5–24 — and run.
  it("removing layers 1–4 of a 24-layer node keeps the rest at slots 5–24, and the node runs", () => {
    const layers = Array.from({ length: 24 }, (_, i) => ({ imageUrl: `https://x/${i}.png`, start: 0 }))
    renderPanel({ layers })
    const removes = screen.getAllByRole("button", { name: "Remove layer" })
    for (const i of [0, 1, 2, 3]) fireEvent.click(removes[i]!)
    const data = useWorkflowStore.getState().nodes[0]!.data as VideoOverlayData
    expect(data.layers).toHaveLength(24)
    expect(data.layers!.slice(0, 4)).toEqual([null, null, null, null])
    // Layer 24 is past the 20-slot mark but still has its image: the card's
    // source tag is the source-OK one (green), not the muted "no image" one.
    const layer24Tag = screen.getByRole("button", { name: /^Layer 24/ }).querySelector("span")
    expect(layer24Tag).toHaveTextContent("image URL — no handle (layers 13 and up)")
    expect(layer24Tag).toHaveClass("text-emerald-500")
    const request = assembleVideoOverlayRequest({ videoUrl: BASE, data, wiredImageUrls: [] })
    expect(request.layers.map((l) => l.slot)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5))
    expect(validateVideoOverlayRequest(request)).toEqual({ ok: true })
  })
})
