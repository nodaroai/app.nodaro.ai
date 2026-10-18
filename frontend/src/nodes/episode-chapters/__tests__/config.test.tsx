// The Chapters settings panel: what it does in one line, the plan tier
// (economy by default — the run's own default), and the planner's
// instructions and style guide.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("@/components/editor/config-panels/run-up-to-here-notice", () => ({ RunUpToHereNotice: () => null }))

import { ConfigPanel as EpisodeChaptersConfig } from "../config"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { EpisodeChaptersData } from "../types"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

function renderConfig(data: Partial<EpisodeChaptersData>, onUpdate: (d: Record<string, unknown>) => void = () => {}) {
  return render(
    <EpisodeChaptersConfig
      data={{ label: "Chapters", fieldMappings: {}, ...data } as EpisodeChaptersData as never}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[] as unknown as WorkflowNode[]}
      edges={[] as unknown as WorkflowEdge[]}
      nodeId="c1"
      kit={{ localizeNodeLabel: (label: string) => label }}
    />,
  )
}

afterEach(() => cleanup())

describe("EpisodeChaptersConfig", () => {
  it("says what it makes, and shows the run's default tier when none is stored", () => {
    renderConfig({})
    expect(screen.getByText(t("proccfg.chaptersHint"))).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: t("proccfg.chaptersPlanTier") }).textContent).toBe(t("proccfg.tightenTierEconomy"))
  })

  it("writes the instructions and the style guide", () => {
    const onUpdate = vi.fn()
    renderConfig({}, onUpdate)
    fireEvent.change(screen.getByLabelText(t("proccfg.tightenInstructions")), { target: { value: "5 to 8 chapters" } })
    expect(onUpdate).toHaveBeenCalledWith({ instructions: "5 to 8 chapters" })
    fireEvent.change(screen.getByLabelText(t("proccfg.tightenStyleGuide")), { target: { value: "short titles" } })
    expect(onUpdate).toHaveBeenCalledWith({ styleGuide: "short titles" })
  })

  it("opening a settled node writes nothing", () => {
    const onUpdate = vi.fn()
    renderConfig({ planTier: "premium", instructions: "x", styleGuide: "y" }, onUpdate)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
