import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

// Icons only — render nothing, so text assertions are unambiguous.
vi.mock("lucide-react", () => new Proxy({} as Record<PropertyKey, unknown>, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

// One mutable node list the overlay reads its own slice out of (it subscribes
// by id, exactly as BaseNode does at base-node.tsx:244).
const store = vi.hoisted(() => ({ nodes: [] as Array<{ id: string; data: Record<string, unknown> }> }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(store),
    { getState: () => store },
  ),
}))

import { NodePolicyOverlay } from "../node-policy-overlay"

function renderFor(data: Record<string, unknown>) {
  store.nodes = [{ id: "n1", data }]
  return render(<NodePolicyOverlay nodeId="n1" />)
}

describe("NodePolicyOverlay", () => {
  beforeEach(() => {
    cleanup()
    store.nodes = []
  })

  it("renders nothing for an ordinary running node", () => {
    const { container } = renderFor({ executionStatus: "running" })
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing when the node id is not in the store", () => {
    store.nodes = []
    const { container } = render(<NodePolicyOverlay nodeId="missing" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("held job: shows the awaiting-review chrome and the credits-held line", () => {
    renderFor({ executionStatus: "running", jobAwaitingReview: true })
    expect(screen.getByText("Awaiting review")).toBeInTheDocument()
    expect(screen.getByText("The result is being reviewed before it's released.")).toBeInTheDocument()
    expect(screen.getByText("Your credits stay held until the review finishes.")).toBeInTheDocument()
  })

  it("STALENESS GUARD (a): a leftover flag on a COMPLETED node paints nothing", () => {
    // Approve goes pending_review -> completed with no intervening poll tick,
    // so nothing re-enters a branch that clears the flag. Without the
    // executionStatus gate the overlay would cover the delivered result.
    const { container } = renderFor({ executionStatus: "completed", jobAwaitingReview: true })
    expect(container).toBeEmptyDOMElement()
  })

  it("result-gate block: shows the policy title and the policy's own reason", () => {
    renderFor({
      executionStatus: "failed",
      errorHint: { kind: "policy-block", policyId: "sai-moderation", reason: "Nudity is not allowed here.", hookPoint: "result" },
    })
    expect(screen.getByText("Blocked by content policy")).toBeInTheDocument()
    expect(screen.getByText("Nudity is not allowed here.")).toBeInTheDocument()
  })

  it("result-gate block with no reason: falls back to the output-withheld sentence", () => {
    renderFor({
      executionStatus: "failed",
      errorHint: { kind: "policy-block", policyId: "p", reason: "", hookPoint: "result" },
    })
    expect(screen.getByText("The result was blocked and wasn't saved.")).toBeInTheDocument()
  })

  it("request-gate block with no reason: falls back to the blocked-before-it-ran sentence", () => {
    renderFor({
      executionStatus: "failed",
      errorHint: { kind: "policy-block", policyId: "p", reason: "", hookPoint: "request" },
    })
    expect(screen.getByText("This request was blocked before it ran.")).toBeInTheDocument()
  })

  it("a PROVIDER safety block is not ours to render — the node card owns that", () => {
    const { container } = renderFor({
      executionStatus: "failed",
      errorHint: { kind: "safety-block", class: "safety", retried: true },
    })
    expect(container).toBeEmptyDOMElement()
  })

  it("a policy-block hint on a node that is not failed paints nothing", () => {
    const { container } = renderFor({
      executionStatus: "idle",
      errorHint: { kind: "policy-block", policyId: "p", reason: "no", hookPoint: "request" },
    })
    expect(container).toBeEmptyDOMElement()
  })
})
