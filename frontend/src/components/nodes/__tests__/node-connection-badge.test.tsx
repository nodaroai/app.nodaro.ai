import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

// Icons only — render nothing, so text assertions are unambiguous.
vi.mock("lucide-react", () => new Proxy({} as Record<PropertyKey, unknown>, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

const store = vi.hoisted(() => ({ nodes: [] as Array<{ id: string; data: Record<string, unknown> }> }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(store),
    { getState: () => store },
  ),
}))

import { NodeConnectionBadge } from "../node-connection-badge"

function renderFor(data: Record<string, unknown>) {
  store.nodes = [{ id: "n1", data }]
  return render(<NodeConnectionBadge nodeId="n1" />)
}

describe("NodeConnectionBadge", () => {
  beforeEach(() => {
    cleanup()
    store.nodes = []
  })

  it("says the node is reconnecting while its running job cannot be read", () => {
    renderFor({ executionStatus: "running", jobConnectionLost: true })
    const desc = "Can't reach the server right now. The job keeps running, and its result will appear here."
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…")
    // Mouse users get the explanation on hover; a screen reader reads it in the
    // status region itself.
    expect(screen.getByRole("status")).toHaveAttribute("title", desc)
    expect(screen.getByRole("status")).toHaveTextContent(desc)
  })

  it("renders nothing for a running node that can be read", () => {
    const { container } = renderFor({ executionStatus: "running" })
    expect(container).toBeEmptyDOMElement()
  })

  it("never sits on a finished card, even with a leftover flag", () => {
    for (const executionStatus of ["completed", "failed", "idle", undefined]) {
      cleanup()
      const { container } = renderFor({ executionStatus, jobConnectionLost: true })
      expect(container).toBeEmptyDOMElement()
    }
  })

  it("renders nothing when the node is not on the canvas", () => {
    const { container } = render(<NodeConnectionBadge nodeId="missing" />)
    expect(container).toBeEmptyDOMElement()
  })
})
