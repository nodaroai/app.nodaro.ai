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
 * A fresh Video to Video node stores no provider and RUNS the default,
 * Seedance 2.5 Edit: the strip shows that model and its levers (Draft) at
 * once, never the levers of a model the node does not run. Picking another
 * model swaps them. Driven through the real (unmocked) Radix Select and the
 * real store.
 */
describe("Video to Video strip — the model a node runs and its levers", () => {
  it("fresh node reads Seedance 2.5 Edit with Draft; picking Wan 2.6 takes Draft away", async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [{ id: "v1", type: "video-to-video", position: { x: 0, y: 0 }, data: { label: "V", prompt: "", duration: 5 } }] as never,
        edges: [],
      })
    })
    render(<NodeQuickStrip nodeId="v1" isRunning={false} />)
    const model = screen.getByRole("combobox", { name: "Model" })
    expect(model.textContent).toContain("Seedance 2.5 Edit")
    expect(screen.getByRole("combobox", { name: "Draft (480p)" })).toBeTruthy()

    const user = userEvent.setup()
    await user.click(model)
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: /^Wan 2\.6(?! Flash)/ }))

    expect((useWorkflowStore.getState().nodes[0].data as { provider?: string }).provider).toBe("wan")
    expect(screen.queryByRole("combobox", { name: "Draft (480p)" })).toBeNull()
  })
})
