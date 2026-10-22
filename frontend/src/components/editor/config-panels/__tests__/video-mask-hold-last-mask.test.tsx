/**
 * Video Mask's "Hold mask when the subject is lost" toggle: off by default
 * (a node that never set it), and it stores a boolean.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render as rtlRender, screen } from "@testing-library/react"
import { VIDEO_MASK_DEFAULTS } from "@nodaro/shared/media"
import { VideoMaskConfig } from "../video-mask-config"
import type { VideoMaskNodeData } from "@/types/nodes"
import type { ConfigProps } from "../types"

const render = rtlRender

// The prompt field's editor, snippets and model-compare link are not under test here.
vi.mock("@/lib/picker-ui", () => ({ PromptEditor: () => null }))
vi.mock("@/components/editor/node-docs/compare-models-link", () => ({ CompareModelsLink: () => null }))
vi.mock("../snippet-menu-button", () => ({ SnippetMenuButton: () => null }))
vi.mock("@/components/nodes/inline-node-prompt/use-prompt-editor-refs", () => ({
  usePromptEditorRefs: () => ({ referenceImages: [], nodeRefs: [], refMap: {}, promptSnippets: [] }),
}))
vi.mock("../use-final-prompt-segments", () => ({ useFinalPromptSegments: () => ({ promptSegments: [], promptText: "" }) }))

const EXTRA = { nodes: [], edges: [], sources: [], fieldMappings: {}, onMapField: vi.fn() } as unknown as Omit<ConfigProps<VideoMaskNodeData>, "data" | "onUpdate">

const data = (overrides: Partial<VideoMaskNodeData> = {}): VideoMaskNodeData =>
  ({ label: "Video Mask", prompt: "the face", ...VIDEO_MASK_DEFAULTS, fieldMappings: {}, ...overrides }) as VideoMaskNodeData

describe("VideoMaskConfig — hold the last mask", () => {
  it("is off for a node that never set it", () => {
    const d: Partial<VideoMaskNodeData> = data()
    delete d.holdLastMask
    render(<VideoMaskConfig data={d as VideoMaskNodeData} onUpdate={vi.fn()} {...EXTRA} />)
    expect((screen.getByLabelText("Hold mask when the subject is lost") as HTMLInputElement).checked).toBe(false)
  })

  it("stores the toggle as a boolean", () => {
    const onUpdate = vi.fn()
    render(<VideoMaskConfig data={data()} onUpdate={onUpdate} {...EXTRA} />)
    fireEvent.click(screen.getByLabelText("Hold mask when the subject is lost"))
    expect(onUpdate).toHaveBeenCalledWith({ holdLastMask: true })
  })

  it("Ignore subjects smaller than: off (0) by default, stores a % of the frame height", () => {
    const onUpdate = vi.fn()
    const d: Partial<VideoMaskNodeData> = data()
    delete d.minSubjectHeightPct
    render(<VideoMaskConfig data={d as VideoMaskNodeData} onUpdate={onUpdate} {...EXTRA} />)
    const slider = screen.getByLabelText("Ignore subjects smaller than (% of frame height)") as HTMLInputElement
    expect(slider.value).toBe("0")
    expect(screen.getAllByText("Off")).toHaveLength(2) // both size cuts are off
    fireEvent.change(slider, { target: { value: "15" } })
    expect(onUpdate).toHaveBeenCalledWith({ minSubjectHeightPct: 15 })
  })

  it("shows the set % when it is on", () => {
    render(<VideoMaskConfig data={data({ minSubjectHeightPct: 15 })} onUpdate={vi.fn()} {...EXTRA} />)
    expect(screen.getByText("15%")).toBeTruthy()
  })

  it("Ignore subjects larger than: off by default, stores a %, and warns when the smaller-than cut is above it", () => {
    const onUpdate = vi.fn()
    const { unmount } = render(<VideoMaskConfig data={data()} onUpdate={onUpdate} {...EXTRA} />)
    const slider = screen.getByLabelText("Ignore subjects larger than (% of frame height)") as HTMLInputElement
    expect(slider.value).toBe("0")
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.change(slider, { target: { value: "20" } })
    expect(onUpdate).toHaveBeenCalledWith({ maxSubjectHeightPct: 20 })
    unmount()
    render(<VideoMaskConfig data={data({ minSubjectHeightPct: 30, maxSubjectHeightPct: 20 })} onUpdate={vi.fn()} {...EXTRA} />)
    expect(screen.getByRole("alert").textContent).toMatch(/no subject can be kept/)
  })

  it("shows it on when the node has it on", () => {
    render(<VideoMaskConfig data={data({ holdLastMask: true })} onUpdate={vi.fn()} {...EXTRA} />)
    expect((screen.getByLabelText("Hold mask when the subject is lost") as HTMLInputElement).checked).toBe(true)
  })
})

describe("VideoMaskConfig — detect again after every cut (perShot)", () => {
  it("says it finds the subject anew in each shot", () => {
    render(<VideoMaskConfig data={data()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(screen.getByText(/^Finds the subject anew in each shot, so a new face or object after a cut is masked too\. A held mask/)).toBeTruthy()
  })

  it("is off for a node that never set it", () => {
    const d: Partial<VideoMaskNodeData> = data()
    delete d.perShot
    render(<VideoMaskConfig data={d as VideoMaskNodeData} onUpdate={vi.fn()} {...EXTRA} />)
    expect((screen.getByLabelText("Detect again after every cut") as HTMLInputElement).checked).toBe(false)
  })

  it("toggles perShot as a boolean", () => {
    const onUpdate = vi.fn()
    const { unmount } = render(<VideoMaskConfig data={data()} onUpdate={onUpdate} {...EXTRA} />)
    fireEvent.click(screen.getByLabelText("Detect again after every cut"))
    expect(onUpdate).toHaveBeenCalledWith({ perShot: true })
    unmount()
    const onUpdateOn = vi.fn()
    render(<VideoMaskConfig data={data({ perShot: true })} onUpdate={onUpdateOn} {...EXTRA} />)
    const box = screen.getByLabelText("Detect again after every cut") as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(onUpdateOn).toHaveBeenCalledWith({ perShot: false })
  })
})

describe("VideoMaskConfig — zone", () => {
  const SIDES = ["Left", "Right", "Top", "Bottom"] as const
  const field = (side: (typeof SIDES)[number]) => screen.getByLabelText(`${side} margin (%)`) as HTMLInputElement
  const type = (input: HTMLInputElement, value: string) => {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
  }

  it("is off (every margin 0) for a node that never set it", () => {
    const d: Partial<VideoMaskNodeData> = data()
    delete d.zone
    render(<VideoMaskConfig data={d as VideoMaskNodeData} onUpdate={vi.fn()} {...EXTRA} />)
    for (const side of SIDES) expect(field(side).value).toBe("0")
  })

  it("stores the four margins, the others kept, each clamped to 0–49", () => {
    const onUpdate = vi.fn()
    const { unmount } = render(<VideoMaskConfig data={data()} onUpdate={onUpdate} {...EXTRA} />)
    type(field("Left"), "60")
    expect(onUpdate).toHaveBeenLastCalledWith({ zone: { leftPct: 49, rightPct: 0, topPct: 0, bottomPct: 0 } })
    unmount()
    const onUpdate2 = vi.fn()
    render(<VideoMaskConfig data={data({ zone: { leftPct: 10, rightPct: 12, topPct: 5, bottomPct: 0 } })} onUpdate={onUpdate2} {...EXTRA} />)
    expect(field("Right").value).toBe("12")
    type(field("Bottom"), "-4")
    expect(onUpdate2).not.toHaveBeenCalled() // -4 clamps to 0, the value it already had
    type(field("Bottom"), "20")
    expect(onUpdate2).toHaveBeenLastCalledWith({ zone: { leftPct: 10, rightPct: 12, topPct: 5, bottomPct: 20 } })
  })

  it("stores null (off) when every margin is back at 0", () => {
    const onUpdate = vi.fn()
    render(<VideoMaskConfig data={data({ zone: { leftPct: 10, rightPct: 0, topPct: 0, bottomPct: 0 } })} onUpdate={onUpdate} {...EXTRA} />)
    type(field("Left"), "0")
    expect(onUpdate).toHaveBeenLastCalledWith({ zone: null })
  })
})
