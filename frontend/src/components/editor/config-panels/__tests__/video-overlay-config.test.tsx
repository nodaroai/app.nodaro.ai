// frontend/src/components/editor/config-panels/__tests__/video-overlay-config.test.tsx
/**
 * The Video Overlay panel (UX §2): the base line, the read-only timeline whose
 * bar selects (and so seeks) a layer, the per-slot validator messages in the
 * user's language, the advisory clipped hint, the preset radiogroup — and, for
 * video layers, the Layout picker, a video layer's sound, and the limits a run
 * would refuse. The panel reads its wires as the node and the run do
 * (`useVideoOverlayUpstream`), so the fixture wires the graph in the store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useVideoOverlaySelectionStore } from "@/hooks/use-video-overlay-selection"
import { useVideoOverlayAspectStore } from "@/hooks/use-video-overlay-aspects"
import type { VideoOverlayData, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { assembleVideoOverlayRequest, validateVideoOverlayRequest } from "@nodaro/shared/video"
import { VideoOverlayConfig } from "../video-overlay-config"

const BASE = "https://x/base.mp4"
const CARD = "https://x/a.png"
const CLIP = "https://x/clip.mp4"

const graphNode = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const wire = (source: string, sourceHandle: string, targetHandle: string) =>
  ({ id: `${source}->${targetHandle}`, source, target: "vo", sourceHandle, targetHandle }) as WorkflowEdge

/** By default the base is wired to `video` and an image (CARD) to `overlay`; `wires` replaces the layer wires. */
function renderPanel(data: Partial<VideoOverlayData>, wires?: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, base: Record<string, unknown> = {}) {
  const full = { label: "Video Overlay", fieldMappings: {}, layers: [], ...data } as VideoOverlayData
  const onUpdate = vi.fn()
  const layerWires = wires ?? { nodes: [graphNode("i", "upload-image", { url: CARD })], edges: [wire("i", "image", "overlay")] }
  useWorkflowStore.setState({
    isReadOnly: false,
    nodes: [{ id: "vo", type: "video-overlay", position: { x: 0, y: 0 }, data: full }, graphNode("b", "upload-video", { url: BASE, ...base }), ...layerWires.nodes],
    edges: [wire("b", "video", "video"), ...layerWires.edges],
  } as never)
  render(<VideoOverlayConfig nodeId="vo" data={full} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]} />)
  return { onUpdate, full }
}

/** A generate-video wired to `handle`: the run reads it as a video layer. */
const videoWire = (handle = "overlay") => ({ nodes: [graphNode("gv", "generate-video", { generatedVideoUrl: CLIP })], edges: [wire("gv", "video", handle)] })

const stored = () => useWorkflowStore.getState().nodes.find((n) => n.id === "vo")!.data as VideoOverlayData

/** Opens a Radix select by its accessible name and picks an option. */
function choose(select: string, option: string) {
  const trigger = screen.getByRole("combobox", { name: select })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" })
  fireEvent.click(screen.getByRole("option", { name: option }))
}

/**
 * Every card's remove button, in card order. Not `getAllByRole("button", { name })`:
 * that computes the accessible name of EVERY button on the page (~125 with 24
 * cards), and a button without an aria-label walks the whole document for its
 * `<label>`s — quadratic in the card count, ~90% of a 24-card test (~0.4 s on a
 * laptop, ~2 s alone on the CI runner, past the 5 s test timeout under the full
 * suite: a synchronous test is failed once its wall time exceeds it). Found by
 * title, the same string, then held to the same contract — a button named
 * "Remove layer" — one button at a time.
 */
function removeButtons(): HTMLElement[] {
  const removes = screen.getAllByTitle("Remove layer")
  for (const b of removes) {
    expect(b).toHaveRole("button")
    expect(b).toHaveAccessibleName("Remove layer")
  }
  return removes
}

beforeEach(() => {
  useVideoOverlaySelectionStore.setState({ selected: {}, base: {} })
  useVideoOverlayAspectStore.setState({ aspects: {}, unreadable: {} })
})

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

  // The stand-in image that keeps `layer_without_image` off the cards must not
  // be added to a slot that stores a video: that would read as two sources.
  it("a stored, unwired video layer shows no issue", () => {
    renderPanel({ layers: [null, { videoUrl: "https://x/clip.mp4", start: 0 }] })
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("a stored, unwired layer with both an image and a video shows the refusal", () => {
    renderPanel({ layers: [null, { imageUrl: "https://x/b.png", videoUrl: "https://x/clip.mp4", start: 0 }] })
    expect(screen.getByRole("alert")).toHaveTextContent("A layer takes an image or a video, not both")
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
    const removes = removeButtons()
    expect(removes).toHaveLength(24)
    const verdict = () => {
      const data = useWorkflowStore.getState().nodes[0]!.data as VideoOverlayData
      return validateVideoOverlayRequest(assembleVideoOverlayRequest({ videoUrl: BASE, data, wiredImageUrls: [CARD] }))
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
    const removes = removeButtons()
    expect(removes).toHaveLength(24)
    for (const i of [0, 1, 2, 3]) fireEvent.click(removes[i]!)
    const data = useWorkflowStore.getState().nodes[0]!.data as VideoOverlayData
    expect(data.layers).toHaveLength(24)
    expect(data.layers!.slice(0, 4)).toEqual([null, null, null, null])
    // Layer 24 is past the 20-slot mark but still has its image: the card's
    // source tag is the source-OK one (green), not the muted "no image" one.
    // By its own text, not by role + name (see removeButtons).
    const layer24 = screen.getByText("Layer 24")
    expect(layer24).toHaveRole("button")
    expect(layer24).toHaveAccessibleName(/^Layer 24/)
    const layer24Tag = layer24.querySelector("span")
    expect(layer24Tag).toHaveTextContent("image URL — no handle (layers 13 and up)")
    expect(layer24Tag).toHaveClass("text-emerald-500")
    const request = assembleVideoOverlayRequest({ videoUrl: BASE, data, wiredImageUrls: [] })
    expect(request.layers.map((l) => l.slot)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5))
    expect(validateVideoOverlayRequest(request)).toEqual({ ok: true })
  })
})

describe("VideoOverlayConfig — layouts", () => {
  it("the Layout select lists the five layouts plus Custom, and reads Custom while none is stored", () => {
    renderPanel({ layers: [] })
    expect(screen.getByRole("combobox", { name: "Layout" })).toHaveTextContent("Custom")
    fireEvent.pointerDown(screen.getByRole("combobox", { name: "Layout" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Video at bottom", "Video at top", "Stack whole", "Stack filled", "Picture in picture", "Custom"])
  })

  it("choosing Stack whole writes the layout and a 9:16 output when the node has none, and clears a stored base box", () => {
    renderPanel({ layers: [], baseBox: { anchor: "top", width: 50 } }, videoWire())
    choose("Layout", "Stack whole")
    expect(stored()).toMatchObject({ layout: "stack-whole", outputAspect: "9:16" })
    expect(stored().baseBox).toBeUndefined()
  })

  it("Custom clears the layout (never an empty string)", () => {
    renderPanel({ layers: [], outputAspect: "9:16", layout: "video-bottom" })
    expect(screen.getByRole("combobox", { name: "Layout" })).toHaveTextContent("Video at bottom")
    choose("Layout", "Custom")
    expect(stored().layout).toBeUndefined()
    expect(stored().baseBox).toEqual({ anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" })
  })

  it("a box edit on a card (a preset click) makes the layout Custom, keeping the base where the layout put it", () => {
    renderPanel({ outputAspect: "9:16", layout: "video-bottom", layers: [{ start: 0 }] })
    // [0] is the Base video card's (it has an output aspect).
    fireEvent.click(screen.getAllByRole("button", { name: /Placement/ })[1]!)
    fireEvent.click(screen.getByRole("radio", { name: "Card" }))
    expect(stored().layout).toBeUndefined()
    expect(stored().baseBox).toEqual({ anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" })
    expect(stored().layers[0]).toMatchObject({ preset: "card" })
  })

  it("a stack or pip sees a WIRED video: no 'needs a video layer' refusal", () => {
    renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [] }, videoWire())
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("without a video layer, a layout that needs one says so in the panel", () => {
    renderPanel({ layout: "pip", layers: [] })
    expect(screen.getByRole("alert")).toHaveTextContent("This layout needs a video layer — connect a video to a layer handle")
  })

  it("a layout that places the base hides Video fit and shows the padding colour", () => {
    renderPanel({ outputAspect: "9:16", layout: "video-bottom", layers: [] })
    expect(screen.queryByRole("combobox", { name: "Video fit" })).toBeNull()
    expect(screen.getByLabelText("Padding colour", { selector: "input[type=color]" })).toBeInTheDocument()
  })

  it("Same as video clears what needs an output aspect: a layout that needs one and a base box", () => {
    const { onUpdate } = renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [] }, videoWire())
    choose("Output aspect", "Same as video")
    expect(onUpdate).toHaveBeenCalledWith({ outputAspect: undefined, baseFit: undefined, backgroundColor: undefined, baseBox: undefined, layout: undefined })
  })
})

describe("VideoOverlayConfig — a video layer", () => {
  it("a video layer's card has Sound; an image layer's does not; turning it on writes { volume: 1 }", () => {
    renderPanel({ layers: [null, { videoUrl: CLIP, start: 0 }] })
    const sound = screen.getAllByRole("button", { name: /^Sound/ })
    expect(sound).toHaveLength(1)
    expect(sound[0]).toHaveTextContent("Off")
    fireEvent.click(sound[0]!)
    fireEvent.click(screen.getByRole("switch", { name: "Play this video's sound" }))
    expect(stored().layers[1]).toMatchObject({ videoUrl: CLIP, sound: { volume: 1 } })
  })

  it("with sound on, the volume shows in % and turning it off removes the sound", () => {
    renderPanel({ layers: [null, { videoUrl: CLIP, start: 0, sound: { volume: 0.8 } }] })
    const section = screen.getByRole("button", { name: /^Sound/ })
    expect(section).toHaveTextContent("On · 80%")
    fireEvent.click(section)
    expect(screen.getByText("Volume").parentElement).toHaveTextContent("80%")
    fireEvent.click(screen.getByRole("switch", { name: "Play this video's sound" }))
    expect(stored().layers[1]).not.toHaveProperty("sound")
  })

  it("a WIRED video: fade off by default (as the run), Sound shown, and its stored sound is no issue", () => {
    renderPanel({ layers: [{ start: 0, sound: { volume: 0.5 } }] }, videoWire())
    expect(screen.queryByRole("alert")).toBeNull()
    // Slot 1's card (slots 2–4 are empty handles).
    expect(screen.getAllByRole("button", { name: /^Look/ })[0]).toHaveTextContent("100% · static")
    expect(screen.getByRole("button", { name: /^Sound/ })).toHaveTextContent("On · 50%")
  })

  it("a WIRED image keeps a stale stored sound out of the way: no Sound, no issue (the run skips it)", () => {
    renderPanel({ layers: [{ start: 0, sound: { volume: 0.5 } }] })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("button", { name: /^Sound/ })).toBeNull()
    expect(screen.getAllByRole("button", { name: /^Look/ })[0]).toHaveTextContent("100% · animated")
  })

  it("an image with its own URL and a sound is refused, as the run refuses it", () => {
    renderPanel({ layers: [null, { imageUrl: "https://x/own.png", start: 0, sound: { volume: 1 } }] })
    expect(screen.getByRole("alert")).toHaveTextContent("Only a video layer can have sound")
  })

  it("an unwired stored video is a video URL, never 'not connected'", () => {
    renderPanel({ layers: [null, { videoUrl: CLIP, start: 0 }] })
    const tag = screen.getByText("Layer 2").querySelector("span")
    expect(tag).toHaveTextContent("video URL")
    expect(tag).toHaveClass("text-emerald-500")
  })
})

describe("VideoOverlayConfig — limits before a run", () => {
  it("more than 2 video layers", () => {
    renderPanel({ layers: [null, { videoUrl: "https://x/1.mp4", start: 0 }, { videoUrl: "https://x/2.mp4", start: 0 }] }, videoWire())
    expect(screen.getByRole("alert")).toHaveTextContent("At most 2 video layers (this node has 3)")
  })

  // Show-only: the server measures the real file and decides; the length is the one the price reads (the base's wire).
  const WARNING = "With a video layer the base video can be up to 60 s — this one is 61 s. Trim it, or the run will be refused."
  it("a base past 60 s with a video layer is a warning, not a refusal", () => {
    renderPanel({ layers: [{ start: 0 }] }, videoWire(), { duration: 61 })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByText(WARNING)).toHaveClass("text-amber-500")
  })
  it("…not at 60.04 s (as the server prices it), nor while the length is not known", () => {
    renderPanel({ layers: [{ start: 0 }] }, videoWire(), { duration: 60.04 })
    expect(screen.queryByText(/can be up to 60 s/)).toBeNull()
  })
  it("an image-only node has no length cap", () => {
    renderPanel({ layers: [{ start: 0 }] }, undefined, { duration: 600 })
    expect(screen.queryByText(/can be up to 60 s/)).toBeNull()
  })
})

describe("VideoOverlayConfig — the Base video card", () => {
  const card = () => screen.getByRole("region", { name: "Base video" })
  it("without an output aspect it says a base box needs one, and offers no fields", () => {
    renderPanel({ layers: [] })
    expect(card()).toHaveTextContent("Choose an output aspect to move or resize the base video.")
    expect(within(card()).queryByRole("button", { name: /Placement/ })).toBeNull()
  })
  // No box of its own: Video fit places it, said plainly — no derived box fields to edit (an anchor click would move it).
  it("with an output aspect and no box of its own: placed by Video fit, Move on preview, and nothing to edit", () => {
    renderPanel({ outputAspect: "9:16", baseFit: "contain", layers: [], probedVideo: { url: BASE, durationSec: 5, width: 1920, height: 1080 } })
    expect(card()).toHaveTextContent("Placed by Video fit.")
    expect(within(card()).getByRole("button", { name: "Move on preview" })).toBeInTheDocument()
    expect(within(card()).queryByRole("button", { name: /Placement/ })).toBeNull()
    expect(within(card()).queryByRole("radiogroup", { name: "Anchor" })).toBeNull()
  })
  it("once it has a box, the fields show the STORED box, its fit included, and an edit changes only the field", () => {
    renderPanel({ outputAspect: "9:16", layers: [], baseBox: { anchor: "bottom", x: 0, y: -10, width: 80, height: 40, fit: "cover" } })
    fireEvent.click(within(card()).getByRole("button", { name: /Placement/ }))
    expect(within(card()).getByRole("radio", { name: "bottom" })).toHaveAttribute("aria-checked", "true")
    expect(within(card()).getByRole("combobox", { name: "Fit (when height is set)" })).toHaveTextContent("Cover")
    fireEvent.click(within(card()).getByRole("radio", { name: "top" }))
    expect(stored().baseBox).toEqual({ anchor: "top", x: 0, y: -10, width: 80, height: 40, fit: "cover" })
  })
  it("the Base card's menus are the card's: a press in them keeps the base selected; a layer card's menus are not", () => {
    renderPanel({ outputAspect: "9:16", layers: [{ imageUrl: "https://x/own.png", start: 0, anchor: "top", width: 50, height: 30 }], baseBox: { anchor: "bottom", x: 0, y: 0, width: 80, height: 40, fit: "cover" } })
    fireEvent.click(within(card()).getByRole("button", { name: /Placement/ }))
    fireEvent.pointerDown(within(card()).getByRole("combobox", { name: "Fit (when height is set)" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    expect(screen.getByRole("listbox").closest('[data-video-overlay-base="vo"]')).not.toBeNull()
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" })
    fireEvent.click(screen.getAllByRole("button", { name: /Placement/ })[1]!)
    const layerFit = screen.getAllByRole("combobox", { name: "Fit (when height is set)" }).find((c) => !card().contains(c))!
    fireEvent.pointerDown(layerFit, { button: 0, ctrlKey: false, pointerType: "mouse" })
    expect(screen.getByRole("listbox").closest("[data-video-overlay-base]")).toBeNull()
  })
  it("under a stack it says the layout places the base (and, with both shapes read, that Custom lets you place it)", () => {
    useVideoOverlayAspectStore.setState({ aspects: { [CLIP]: 16 / 9 } })
    renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [], probedVideo: { url: BASE, durationSec: 10, width: 1920, height: 1080 } }, videoWire())
    expect(card()).toHaveTextContent("The stack layout places the base video. Choose Custom to place it yourself.")
  })
  it("under an edge layout it shows the layout's box; a stored box offers Reset, which removes it", () => {
    renderPanel({ outputAspect: "9:16", layout: "video-bottom", layers: [] })
    expect(within(card()).getByRole("button", { name: /Placement/ })).toHaveTextContent("Video at bottom")
    expect(within(card()).queryByRole("button", { name: "Reset" })).toBeNull()
    cleanup()
    renderPanel({ outputAspect: "9:16", layers: [], baseBox: { anchor: "top", x: 0, y: 0, width: 50, fit: "contain" } })
    expect(within(card()).getByRole("button", { name: /Placement/ })).toHaveTextContent("Custom")
    // A stored box places the base: Video fit is hidden and the padding colour shows.
    expect(screen.queryByRole("combobox", { name: "Video fit" })).toBeNull()
    expect(screen.getByLabelText("Padding colour", { selector: "input[type=color]" })).toBeInTheDocument()
    fireEvent.click(within(card()).getByRole("button", { name: "Reset" }))
    expect(stored().baseBox).toBeUndefined()
  })
})

describe("VideoOverlayConfig — an image-only node is left as it is", () => {
  it("opening the panel writes nothing (no base box, no layout)", () => {
    const { onUpdate, full } = renderPanel({ outputAspect: "9:16", layers: [{ start: 0 }], probedVideo: { url: BASE, durationSec: 5, width: 1920, height: 1080 } })
    expect(stored()).toBe(full)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(full).not.toHaveProperty("baseBox")
    expect(full).not.toHaveProperty("layout")
  })
})

describe("VideoOverlayConfig — selecting the base", () => {
  const card = () => screen.getByRole("region", { name: "Base video" })
  const baseSelected = () => "vo" in useVideoOverlaySelectionStore.getState().base
  it("the card's Move on preview selects the base (the only way to), and selecting a layer lets it go", () => {
    renderPanel({ outputAspect: "9:16", layers: [{ start: 0 }] })
    const move = within(card()).getByRole("button", { name: "Move on preview" })
    expect(move).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(move)
    expect(baseSelected()).toBe(true)
    // A layer selected from its card (or the timeline) deselects the base: never two selections.
    fireEvent.click(screen.getByText("Layer 1"))
    expect(baseSelected()).toBe(false)
    expect(useVideoOverlaySelectionStore.getState().selected.vo).toBe(0)
  })
  it("offers no Move on preview without a box to move", () => {
    renderPanel({ layers: [] })
    expect(within(card()).queryByRole("button", { name: "Move on preview" })).toBeNull()
  })
  it("under a stack: Move on preview once Custom is available (a drag turns it Custom), none while it is held back", () => {
    useVideoOverlayAspectStore.setState({ aspects: { [CLIP]: 16 / 9 } })
    renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [], probedVideo: { url: BASE, durationSec: 5, width: 1920, height: 1080 } }, videoWire())
    expect(within(card()).getByRole("button", { name: "Move on preview" })).toBeInTheDocument()
    cleanup()
    useVideoOverlayAspectStore.setState({ aspects: {} })
    renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [], probedVideo: { url: BASE, durationSec: 5, width: 1920, height: 1080 } }, videoWire())
    expect(within(card()).queryByRole("button", { name: "Move on preview" })).toBeNull()
  })
})

describe("VideoOverlayConfig — the Layout select's edge cases", () => {
  it("an unknown stored layout selects nothing, and Custom clears it", () => {
    renderPanel({ layout: "diagonal" as never, layers: [] })
    expect(screen.getByRole("combobox", { name: "Layout" })).toHaveTextContent("Unknown layout — choose one")
    choose("Layout", "Custom")
    expect(stored().layout).toBeUndefined()
  })
  it("while Custom is held back, the Base card does not point at it", () => {
    renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [], probedVideo: { url: BASE, durationSec: 10, width: 1920, height: 1080 } }, videoWire())
    expect(screen.getByRole("region", { name: "Base video" })).toHaveTextContent("The stack layout places the base video.")
    expect(screen.getByRole("region", { name: "Base video" })).not.toHaveTextContent("Choose Custom")
  })
  it("a clip whose shape cannot be read: the reason says the layout still renders and Custom stays unavailable; reopening the panel reads it again", () => {
    const UNREADABLE = "The clip's shape could not be read. The layout still renders (the server reads the real shape), but it cannot be turned Custom."
    const open = () => renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [], probedVideo: { url: BASE, durationSec: 10, width: 1920, height: 1080 } }, videoWire())
    open()
    fireEvent.error(document.querySelector<HTMLVideoElement>(`video[src="${CLIP}"]`)!)
    expect(screen.getByText(UNREADABLE)).toBeInTheDocument()
    // While it stands, it is not read again in this panel.
    expect(document.querySelector(`video[src="${CLIP}"]`)).toBeNull()
    fireEvent.pointerDown(screen.getByRole("combobox", { name: "Layout" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    expect(screen.getByRole("option", { name: "Custom" })).toHaveAttribute("aria-disabled", "true")
    // The panel closed and reopened: the mark is forgotten and the clip is read again.
    cleanup()
    open()
    expect(screen.queryByText(UNREADABLE)).toBeNull()
    expect(screen.getByText("Reading the videos' shapes — Custom is available once they load.")).toBeInTheDocument()
    expect(document.querySelector(`video[src="${CLIP}"]`)).not.toBeNull()
  })
  it("a stack-whole whose clip's shape is not read holds Custom back (with the reason) and reads it; once read, Custom is offered", () => {
    renderPanel({ outputAspect: "9:16", layout: "stack-whole", layers: [], probedVideo: { url: BASE, durationSec: 10, width: 1920, height: 1080 } }, videoWire())
    expect(screen.getByText("Reading the videos' shapes — Custom is available once they load.")).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole("combobox", { name: "Layout" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    expect(screen.getByRole("option", { name: "Custom" })).toHaveAttribute("aria-disabled", "true")
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    const probe = document.querySelector<HTMLVideoElement>(`video[src="${CLIP}"]`)!
    Object.defineProperty(probe, "videoWidth", { configurable: true, value: 1920 })
    Object.defineProperty(probe, "videoHeight", { configurable: true, value: 1080 })
    fireEvent.loadedMetadata(probe)
    expect(useVideoOverlayAspectStore.getState().aspects[CLIP]).toBeCloseTo(16 / 9)
    expect(screen.queryByText("Reading the videos' shapes — Custom is available once they load.")).toBeNull()
  })
  it("pip: the inset's card picks its corner, which moves it and keeps the layout", () => {
    renderPanel({ layout: "pip", layers: [] }, videoWire())
    // No output aspect: the Base video card has no Placement; [0] is the inset's.
    fireEvent.click(screen.getAllByRole("button", { name: /Placement/ })[0]!)
    fireEvent.click(screen.getByRole("radio", { name: "Top left" }))
    expect(stored().layout).toBe("pip")
    expect(stored().layers[0]).toMatchObject({ corner: "top-left" })
  })
})
