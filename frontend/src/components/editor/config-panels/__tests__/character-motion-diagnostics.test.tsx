import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ensureLocaleCatalogLoaded, resolveLabel } from "@nodaro/shared/i18n"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { CharacterMotionDiagnostics } from "../character-motion-diagnostics"
import { ParameterPreviewContext } from "../parameter-preview-context"
import type { WorkflowNode, WorkflowEdge, CharacterMotionData } from "@/types/nodes"

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")))

describe("Character Motion attention messages", () => {
  it("uses graph minor filtering and reports an empty contribution", () => {
    const data: CharacterMotionData = { label: "Motion", characterMotion: "kiss-partner" }
    const node = { id: "motion", type: "character-motion", data } as WorkflowNode
    const child = { id: "child", type: "character", data: { description: "a 10-year-old child", characterName: "Mira" } } as WorkflowNode
    const edges = [{ id: "e", source: "child", target: "motion", targetHandle: "target" }] as WorkflowEdge[]
    render(<ParameterPreviewContext.Provider value={{ node, nodes: [node, child], edges }}><CharacterMotionDiagnostics data={data} /></ParameterPreviewContext.Provider>)
    expect(screen.getByRole("status")).toHaveTextContent("No selected motion contributes a fragment")
  })
  it("switches the diagnostic explanation and motion labels to the selected locale", async () => {
    await ensureLocaleCatalogLoaded("character-motion", "he")
    render(<CharacterMotionDiagnostics data={{ label: "Motion", characterMotion: ["walk-out-left", "wave-hello"] }} />)
    expect(screen.getByRole("status")).toHaveTextContent("ends out of view")
    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByRole("status")).toHaveTextContent(translate("he", "motionReview.diagnostic.visibility", {
      before: resolveLabel("character-motion", "walk-out-left", "Exit frame left", "he"),
      after: resolveLabel("character-motion", "wave-hello", "Wave hello", "he"),
    }))
    expect(screen.getByRole("status")).not.toHaveTextContent("ends out of view")
  })
  it("reports an exit followed by an in-frame gesture outside graph context", () => {
    render(<CharacterMotionDiagnostics data={{ label: "Motion", characterMotion: ["walk-out-left", "wave-hello"] }} />)
    expect(screen.getByRole("status")).toHaveTextContent("ends out of view")
  })
})
