// The review, reached the way a person reaches it (A3-5): the render's Review
// cut, a ?review= link, Escape to leave. Whole path, real inspector: the host,
// the URL, the model, the footer. The pieces have their own tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
vi.mock("@/components/editor/workflow-editor/newer-run-check", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  newerRunOnServer: vi.fn(async () => null),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { openReview, useReviewOpenStore } from "@/hooks/use-review-open-store"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { ReviewCutButton } from "@/components/render/review-cut-button"
import { ReviewInspectorHost } from "../review-inspector-host"
import { escape, layOut, loadCanvas } from "./review-test-canvas"

let page: ReturnType<typeof layOut>
const search = { current: "" }
function Probe() {
  search.current = useLocation().search
  return null
}
const mountAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ReviewCutButton renderId="cut" />
      <ReviewInspectorHost />
      <Probe />
    </MemoryRouter>,
  )
const previewOn = () => {
  ;(window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__ = { previewStopRule: true }
}
const footerButtons = () => within(screen.getByTestId("review-footer")).queryAllByRole("button").map((b) => b.textContent)

beforeEach(() => {
  resetUndoStacks()
  page = layOut()
  useWorkflowStore.setState({ renderFinal: vi.fn() } as never)
})
afterEach(() => {
  cleanup()
  page.restore()
  delete (window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__
  useReviewOpenStore.setState({ hostMounted: false, renderId: null })
  useWorkflowStore.setState({ renderFinal: null, renderCheck: null })
})

describe("the review from a render's node", () => {
  it("Review cut opens the inspector on a render that has no take at all, and writes ?review=", async () => {
    loadCanvas({ cut: { quality: "final" } })
    mountAt("/editor")
    fireEvent.click(await screen.findByRole("button", { name: "Review cut" }))
    expect(await screen.findByRole("dialog", { name: "Review cut · Tighten Plan → Apply Cut" })).toBeTruthy()
    await waitFor(() => expect(search.current).toBe("?review=cut"))
    expect(screen.getByText("No preview yet.")).toBeTruthy()
  })

  it("with the stop rule off there is no Update preview, and Render final stays (R18 a)", async () => {
    loadCanvas({ cut: { quality: "final", generatedResults: [{ url: "f.mp4", quality: "final" }], activeResultIndex: 0 } })
    mountAt("/editor?review=cut")
    await screen.findByTestId("review-footer")
    const labels = footerButtons().join("|")
    expect(labels).toMatch(/Render final/)
    expect(labels).not.toMatch(/Update preview/)
  })

  it("with the stop rule on, a Final take can still be previewed from the review", async () => {
    previewOn()
    loadCanvas({ cut: { generatedResults: [{ url: "f.mp4", quality: "final" }], activeResultIndex: 0 } })
    mountAt("/editor?review=cut")
    await screen.findByTestId("review-footer")
    expect(footerButtons().join("|")).toMatch(/Update preview/)
  })

  it("Escape closes the review and takes the param with it", async () => {
    loadCanvas()
    mountAt("/editor?review=cut")
    await screen.findByRole("dialog")
    escape()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(search.current).toBe("")
  })
})

describe("?review=<plan id>", () => {
  it("opens at the render the plan feeds", async () => {
    loadCanvas()
    mountAt("/editor?review=plan")
    expect(await screen.findByRole("dialog", { name: "Review cut · Tighten Plan → Apply Cut" })).toBeTruthy()
  })

  it("with several renders opens at the first, and the header's picker offers the rest", async () => {
    loadCanvas({ extraRender: true })
    mountAt("/editor?review=plan")
    await screen.findByRole("dialog")
    expect(screen.getByRole("button", { name: "Choose the render to review" })).toBeTruthy()
  })
})

// Where focus goes when the review closes. The opener is not always still there:
// the context menu unmounts the moment it is clicked and a ?review= link has no
// opener at all, and focus on <body> leaves a keyboard user nowhere. Those fall
// back to the node being reviewed.
describe("focus on close", () => {
  // The React Flow node wrapper the review is anchored at.
  const NodeEl = () => <div className="react-flow__node" data-id="cut" tabIndex={0} data-testid="cut-node" />
  const MenuLike = () => {
    const [shown, setShown] = useState(true)
    return shown ? (
      <button onClick={() => { openReview("cut"); setShown(false) }}>menu entry</button>
    ) : null
  }
  const mountWith = (url: string, extra: React.ReactNode) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <NodeEl />
        {extra}
        <ReviewInspectorHost />
      </MemoryRouter>,
    )
  const closeAndWait = async () => {
    escape()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  }

  it("Review cut: back on the button", async () => {
    loadCanvas()
    mountWith("/editor", <ReviewCutButton renderId="cut" />)
    const button = await screen.findByRole("button", { name: "Review cut" })
    button.focus()
    fireEvent.click(button)
    await screen.findByRole("dialog")
    await closeAndWait()
    expect(document.activeElement).toBe(button)
  })

  it("the context menu (gone by the time the inspector mounts): on the node", async () => {
    loadCanvas()
    mountWith("/editor", <MenuLike />)
    const entry = await screen.findByText("menu entry")
    entry.focus()
    fireEvent.click(entry)
    await screen.findByRole("dialog")
    await closeAndWait()
    expect(document.activeElement).toBe(screen.getByTestId("cut-node"))
  })

  it("a ?review= link (no opener): on the node", async () => {
    loadCanvas()
    mountWith("/editor?review=cut", null)
    await screen.findByRole("dialog")
    await closeAndWait()
    expect(document.activeElement).toBe(screen.getByTestId("cut-node"))
  })
})
