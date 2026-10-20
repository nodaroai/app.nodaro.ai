// The Trailer settings panel: the formats it delivers (never none — the route
// refuses an empty list), Review before render, and the plan's settings.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/components/editor/config-panels/run-up-to-here-notice", () => ({ RunUpToHereNotice: () => null }))
// The viewer's answer: may they use Speaker Map (several recordings, decided 2026-10-19)? Not landed by default.
const viewer = vi.hoisted(() => ({ state: "loading" as "loading" | "offered" | "withheld" }))
vi.mock("@/lib/use-case-multicam-viewer", () => ({
  usecaseMulticamOffered: () => viewer.state === "offered",
  usecaseMulticamViewer: () => viewer.state,
  useUseCaseMulticamViewer: () => viewer.state,
}))

import { ConfigPanel as EpisodeTrailerConfig } from "../config"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { EpisodeTrailerData } from "../types"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

function renderConfig(data: Partial<EpisodeTrailerData>, onUpdate: (d: Record<string, unknown>) => void = () => {}) {
  return render(
    <EpisodeTrailerConfig
      data={{ label: "Trailer", fieldMappings: {}, ...data } as EpisodeTrailerData as never}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[] as unknown as WorkflowNode[]}
      edges={[] as unknown as WorkflowEdge[]}
      nodeId="tr1"
      kit={{ localizeNodeLabel: (label: string) => label }}
    />,
  )
}

const box = (key: Parameters<typeof translate>[1]) => screen.getByRole("checkbox", { name: t(key) })

afterEach(() => {
  cleanup()
  viewer.state = "loading"
})

describe("EpisodeTrailerConfig", () => {
  it("shows the run's default formats when none are stored", () => {
    renderConfig({})
    expect(box("node.trailerFormat9x16").getAttribute("data-state")).toBe("checked")
    expect(box("node.trailerFormat1x1").getAttribute("data-state")).toBe("checked")
    expect(box("node.trailerFormat4x5").getAttribute("data-state")).toBe("checked")
    expect(box("node.trailerFormat16x9").getAttribute("data-state")).toBe("unchecked")
    expect(screen.getByText(t("proccfg.trailerFormatsHint"))).toBeInTheDocument()
    expect(screen.getByText(t("proccfg.trailerIntroHint"))).toBeInTheDocument()
  })

  it("a ticked format joins the list in the formats' own order", async () => {
    const onUpdate = vi.fn()
    renderConfig({ formats: ["1:1"] }, onUpdate)
    await userEvent.click(box("node.trailerFormat9x16"))
    expect(onUpdate).toHaveBeenCalledWith({ formats: ["9:16", "1:1"] })
  })

  it("the last format left cannot be unticked", async () => {
    const onUpdate = vi.fn()
    renderConfig({ formats: ["4:5"] }, onUpdate)
    expect(box("node.trailerFormat4x5")).toBeDisabled()
    await userEvent.click(box("node.trailerFormat4x5"))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("Review before render writes the setting", async () => {
    const onUpdate = vi.fn()
    renderConfig({}, onUpdate)
    await userEvent.click(screen.getByRole("switch", { name: t("proccfg.trailerReview") }))
    expect(onUpdate).toHaveBeenCalledWith({ reviewBeforeRender: true })
  })
})

describe("the Cameras section (decided 2026-10-17; shown only to a viewer who may use Speaker Map — 2026-10-19)", () => {
  const cam = (id: string, type = "upload-video") => ({ id, type, data: { label: `cam-${id}` } })
  const into = (id: string, handle = "media", sourceHandle = "video") => ({ id: `${id}-${handle}`, source: id, target: "tr1", sourceHandle, targetHandle: handle })
  const src = (id: string, handle = "media", type = "upload-video") => ({ id, type, label: `cam-${id}`, value: "", targetHandle: handle })
  const three = {
    nodes: [cam("a"), cam("b"), cam("c"), cam("mic", "upload-audio")],
    edges: [into("a"), into("b"), into("c"), into("mic", "masterAudio", "audio")],
    sources: [src("a"), src("b"), src("c"), src("mic", "masterAudio", "upload-audio")],
  }
  const renderWired = (data: Partial<EpisodeTrailerData>, wiring: { nodes: unknown[]; edges: unknown[]; sources: unknown[] }, onUpdate: (d: Record<string, unknown>) => void = () => {}) =>
    render(
      <EpisodeTrailerConfig
        data={{ label: "Trailer", fieldMappings: {}, ...data } as EpisodeTrailerData as never}
        onUpdate={onUpdate}
        sources={wiring.sources as never}
        fieldMappings={{}}
        onMapField={() => {}}
        nodes={wiring.nodes as unknown as WorkflowNode[]}
        edges={wiring.edges as unknown as WorkflowEdge[]}
        nodeId="tr1"
        kit={{ localizeNodeLabel: (label: string) => label }}
      />,
    )

  it("one recording: no Cameras section, and no note", () => {
    viewer.state = "offered"
    renderWired({}, { nodes: [cam("a")], edges: [into("a")], sources: [src("a")] })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    cleanup()
    viewer.state = "withheld"
    renderWired({}, { nodes: [cam("a")], edges: [into("a")], sources: [src("a")] })
    expect(screen.queryByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeNull()
  })

  it("three recordings and a master: the recordings in mediaOrder, the wide camera, already in sync, and one override row per camera", () => {
    viewer.state = "offered"
    renderWired({ mediaOrder: ["c", "a"] }, three)
    const text = screen.getByTestId("use-case-cameras").textContent ?? ""
    expect(text.indexOf("cam-c")).toBeLessThan(text.indexOf("cam-a"))
    expect(text.indexOf("cam-a")).toBeLessThan(text.indexOf("cam-b"))
    expect(text).toContain(t("proccfg.usecaseMasterAudio"))
    expect(screen.getByRole("switch", { name: t("proccfg.usecaseSynced") })).toBeInTheDocument()
    expect(screen.getAllByRole("combobox", { name: /^Speaker \d$/ })).toHaveLength(3)
  })

  it("choosing the wide camera writes it", async () => {
    viewer.state = "offered"
    const onUpdate = vi.fn()
    renderWired({}, three, onUpdate)
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.usecaseWideCamera") }))
    await userEvent.click(screen.getByRole("option", { name: "Camera 3" }))
    expect(onUpdate).toHaveBeenCalledWith({ cameras: { wide: 3 } })
  })

  it("six recordings and no master: the refusal the run would give, in the panel", () => {
    viewer.state = "offered"
    const ids = ["a", "b", "c", "d", "e", "f"]
    renderWired({}, { nodes: ids.map((id) => cam(id)), edges: ids.map((id) => into(id)), sources: ids.map((id) => src(id)) })
    expect(screen.getByText(t("apiErr.reason.tooManyRecordings"))).toBeInTheDocument()
  })

  it("a viewer who may not use Speaker Map: no section; a note that the run reads the first recording only", () => {
    viewer.state = "withheld"
    renderWired({}, three)
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.getByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeInTheDocument()
  })

  it("until the viewer's availability has landed: neither (no flash)", () => {
    renderWired({}, three)
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.queryByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeNull()
  })

  it("the panel writes nothing on its own for the Cameras settings (the store's invariant keeps them)", () => {
    viewer.state = "offered"
    const onUpdate = vi.fn()
    renderWired({ cameras: { wide: 9, speakerCameras: { "1": 7 } } }, three, onUpdate)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
