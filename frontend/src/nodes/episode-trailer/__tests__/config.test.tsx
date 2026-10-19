// The Trailer settings panel: the formats it delivers (never none — the route
// refuses an empty list), Review before render, and the plan's settings.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/components/editor/config-panels/run-up-to-here-notice", () => ({ RunUpToHereNotice: () => null }))

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

afterEach(() => cleanup())

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
