import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen, act, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NodeQuickStrip } from "../node-quick-strip"

// Real Radix Select in jsdom needs these pointer/scroll shims.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
})

/**
 * Reported: on a Video to Video node, picking Seedance 2.5 in the node's strip
 * did not show the Draft lever. A fresh node stores no provider and RUNS Wan,
 * but the strip displayed the list's first entry ("Seedance 2.5 Edit"), so the
 * node looked like Seedance while every Seedance lever stayed hidden. Driven
 * through the real (unmocked) Radix Select and the real store.
 */
describe("Video to Video strip — choosing Seedance 2.5 shows Draft at once", () => {
  it("fresh node reads Wan; picking Seedance 2.5 Edit reveals Draft", async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [{ id: "v1", type: "video-to-video", position: { x: 0, y: 0 }, data: { label: "V", prompt: "", duration: 5 } }] as never,
        edges: [],
      })
    })
    render(<NodeQuickStrip nodeId="v1" isRunning={false} />)
    const model = screen.getByRole("combobox", { name: "Model" })
    expect(model.textContent).toContain("Wan 2.6")
    expect(screen.queryByRole("combobox", { name: "Draft (480p)" })).toBeNull()

    const user = userEvent.setup()
    await user.click(model)
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Seedance 2\.5 Edit/ }))

    expect((useWorkflowStore.getState().nodes[0].data as { provider?: string }).provider).toBe("seedance-2-5")
    expect(screen.getByRole("combobox", { name: "Draft (480p)" })).toBeTruthy()
  })
})
