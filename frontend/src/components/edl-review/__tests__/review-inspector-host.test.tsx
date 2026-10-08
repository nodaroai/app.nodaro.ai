// The review's way in from the URL and from the editor (A3-5, R17 a):
// `?review=<id>` opens the inspector at that render (a plan id opens at the
// first render it feeds), replaces history on open, and removes the param on
// close; every entry point opens it through the store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom"

vi.mock("../review-inspector", () => ({
  ReviewInspector: (p: { renderId: string; onClose: () => void; onRenderChange?: (id: string) => void }) => (
    <div data-testid="inspector" data-render={p.renderId}>
      <button onClick={p.onClose}>close</button>
      <button onClick={() => p.onRenderChange?.("cut2")}>switch</button>
    </div>
  ),
}))

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast: toasts }))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { openReview, useReviewOpenStore } from "@/hooks/use-review-open-store"
import { ReviewInspectorHost } from "../review-inspector-host"
import { loadCanvas } from "./review-canvas"

const search = { current: "" }
function Probe() {
  search.current = useLocation().search
  const [, setParams] = useSearchParams()
  return <button onClick={() => setParams({})}>drop param</button>
}
const mountAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ReviewInspectorHost />
      <Probe />
    </MemoryRouter>,
  )
const inspector = () => screen.queryByTestId("inspector")

beforeEach(() => {
  toasts.info.mockClear()
  toasts.error.mockClear()
  loadCanvas({ extraRender: true })
  search.current = ""
})
afterEach(() => {
  cleanup()
  useReviewOpenStore.setState({ renderId: null, hostMounted: false })
  useWorkflowStore.setState({ isWorkflowLoading: false, workflowId: null } as never)
})

describe("?review=", () => {
  it("opens the inspector at the render it names", async () => {
    mountAt("/editor?review=cut")
    expect((await screen.findByTestId("inspector")).dataset.render).toBe("cut")
  })

  it("a plan id opens at the first render the plan feeds, and the param then names that render", async () => {
    mountAt("/editor?review=plan")
    expect((await screen.findByTestId("inspector")).dataset.render).toBe("cut")
    await waitFor(() => expect(search.current).toBe("?review=cut"))
  })

  it("an id that names nothing reviewable is dropped, and the other params stay", async () => {
    mountAt("/editor?focusType=x&review=nope")
    await waitFor(() => expect(search.current).toBe("?focusType=x"))
    expect(inspector()).toBeNull()
  })

  it("tells the person when the id names nothing reviewable: one toast, then the param goes", async () => {
    mountAt("/editor?review=nope")
    await waitFor(() => expect(search.current).toBe(""))
    await new Promise((r) => setTimeout(r, 20))
    expect(toasts.info).toHaveBeenCalledTimes(1)
    expect(toasts.info).toHaveBeenCalledWith("That review isn't available any more.", expect.anything())
  })

  it("a node with no Edit Plan cut behind it gets the same toast", async () => {
    mountAt("/editor?review=tr")
    await waitFor(() => expect(search.current).toBe(""))
    expect(toasts.info).toHaveBeenCalledTimes(1)
  })

  it("a valid id gives no toast", async () => {
    mountAt("/editor?review=cut")
    await screen.findByTestId("inspector")
    await new Promise((r) => setTimeout(r, 20))
    expect(toasts.info).not.toHaveBeenCalled()
  })

  it("waits for the workflow to load before judging the id", async () => {
    useWorkflowStore.setState({ nodes: [], edges: [] } as never)
    mountAt("/editor?review=cut")
    expect(inspector()).toBeNull()
    expect(search.current).toBe("?review=cut")
    expect(toasts.info).not.toHaveBeenCalled()
    act(() => loadCanvas({ extraRender: true }))
    expect((await screen.findByTestId("inspector")).dataset.render).toBe("cut")
    expect(toasts.info).not.toHaveBeenCalled()
  })

  it("no toast while the workflow is loading, one once it has loaded without that id", async () => {
    useWorkflowStore.setState({ isWorkflowLoading: true } as never)
    mountAt("/editor?review=nope")
    await new Promise((r) => setTimeout(r, 20))
    expect(toasts.info).not.toHaveBeenCalled()
    expect(search.current).toBe("?review=nope")
    act(() => useWorkflowStore.setState({ isWorkflowLoading: false } as never))
    await waitFor(() => expect(search.current).toBe(""))
    expect(toasts.info).toHaveBeenCalledTimes(1)
  })

  it("closing removes the param and the inspector, and the other params stay", async () => {
    mountAt("/editor?review=cut&focusType=x")
    fireEvent.click(await screen.findByText("close"))
    await waitFor(() => expect(inspector()).toBeNull())
    expect(search.current).toBe("?focusType=x")
  })

  it("choosing another render in the header rewrites the param to it", async () => {
    mountAt("/editor?review=cut")
    fireEvent.click(await screen.findByText("switch"))
    await waitFor(() => expect(search.current).toBe("?review=cut2"))
  })

  it("a navigation that drops the param closes the inspector", async () => {
    mountAt("/editor?review=cut")
    await screen.findByTestId("inspector")
    fireEvent.click(screen.getByText("drop param"))
    await waitFor(() => expect(inspector()).toBeNull())
  })
})

describe("the editor's entry points", () => {
  it("openReview opens the inspector and writes the param", async () => {
    mountAt("/editor")
    act(() => openReview("cut2"))
    expect((await screen.findByTestId("inspector")).dataset.render).toBe("cut2")
    await waitFor(() => expect(search.current).toBe("?review=cut2"))
  })

  it("is a no-op, and says so, where no host is mounted", () => {
    expect(useReviewOpenStore.getState().hostMounted).toBe(false)
    openReview("cut")
    expect(useReviewOpenStore.getState().renderId).toBeNull()
  })

  it("the host announces itself while mounted, and closes any open review on unmount", async () => {
    const view = mountAt("/editor")
    expect(useReviewOpenStore.getState().hostMounted).toBe(true)
    act(() => openReview("cut"))
    await screen.findByTestId("inspector")
    view.unmount()
    expect(useReviewOpenStore.getState().hostMounted).toBe(false)
    expect(useReviewOpenStore.getState().renderId).toBeNull()
  })

  it("closes the review when the workflow changes under it", async () => {
    useWorkflowStore.setState({ workflowId: "first" } as never)
    mountAt("/editor?review=cut")
    await screen.findByTestId("inspector")
    act(() => useWorkflowStore.setState({ workflowId: "other" } as never))
    await waitFor(() => expect(inspector()).toBeNull())
  })
})

// In-app navigation between workflows: the editor is not remounted when only
// `:workflowId` changes, so the store still holds the previous workflow's nodes
// for a while. A ?review= link is judged against the workflow the route NAMES.
describe("navigating between workflows", () => {
  const nav = { current: (() => undefined) as (to: string | number) => void }
  function Nav() {
    const go = useNavigate()
    nav.current = (to) => go(to as never)
    return null
  }
  const mountRoutes = (entries: string[], index: number) =>
    render(
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <Nav />
        <Routes>
          <Route path="/wf/:workflowId" element={<><ReviewInspectorHost /><Probe /></>} />
        </Routes>
      </MemoryRouter>,
    )
  const holdWorkflow = (id: string, extraRender: boolean) => {
    loadCanvas({ extraRender })
    useWorkflowStore.setState({ workflowId: id } as never)
  }

  it("Back then Forward to a ?review= entry reopens it, though the store still holds the other workflow", async () => {
    holdWorkflow("A", false)
    mountRoutes(["/wf/B", "/wf/A?review=cut"], 1)
    await screen.findByTestId("inspector")
    // Back to B: the review closes with the param. Store swaps to B (no cut).
    act(() => nav.current(-1))
    await waitFor(() => expect(inspector()).toBeNull())
    act(() => {
      useWorkflowStore.setState({ nodes: [], edges: [], workflowId: "B" } as never)
      useWorkflowStore.setState({ nodes: [{ id: "n", type: "text", position: { x: 0, y: 0 }, data: {} }] as never, workflowId: "B" } as never)
    })
    // Forward to A?review=cut while the store still holds B.
    act(() => nav.current(1))
    await waitFor(() => expect(search.current).toBe("?review=cut"))
    expect(inspector()).toBeNull()
    // A loads.
    act(() => holdWorkflow("A", false))
    expect((await screen.findByTestId("inspector")).dataset.render).toBe("cut")
    expect(search.current).toBe("?review=cut")
  })

  it("a ?review= link into another workflow survives the swap, and the old review closing does not take it away", async () => {
    holdWorkflow("A", true)
    mountRoutes(["/wf/A?review=cut"], 0)
    await screen.findByTestId("inspector")
    act(() => nav.current("/wf/A2?review=cut2"))
    // Nothing is judged against A's nodes.
    expect(search.current).toBe("?review=cut2")
    act(() => holdWorkflow("A2", true))
    await waitFor(() => expect(inspector()?.dataset.render).toBe("cut2"))
    expect(search.current).toBe("?review=cut2")
    expect(toasts.info).not.toHaveBeenCalled()
  })

  it("a swap is not a bad link: no toast while the store still holds the other workflow", async () => {
    holdWorkflow("A", true)
    mountRoutes(["/wf/A"], 0)
    act(() => nav.current("/wf/B?review=cut"))
    await new Promise((r) => setTimeout(r, 20))
    expect(toasts.info).not.toHaveBeenCalled()
    expect(search.current).toBe("?review=cut")
  })

  it("first load of a workflow (null to id) with a ?review= link keeps the review open", async () => {
    useWorkflowStore.setState({ nodes: [], edges: [], workflowId: null } as never)
    mountRoutes(["/wf/A?review=cut"], 0)
    expect(inspector()).toBeNull()
    act(() => holdWorkflow("A", false))
    expect((await screen.findByTestId("inspector")).dataset.render).toBe("cut")
    // Let any follow-up effect run.
    await new Promise((r) => setTimeout(r, 20))
    expect(inspector()?.dataset.render).toBe("cut")
    expect(search.current).toBe("?review=cut")
  })

  it("waits while the workflow is loading", async () => {
    holdWorkflow("A", false)
    useWorkflowStore.setState({ isWorkflowLoading: true } as never)
    mountRoutes(["/wf/A?review=cut"], 0)
    expect(inspector()).toBeNull()
    expect(search.current).toBe("?review=cut")
    act(() => useWorkflowStore.setState({ isWorkflowLoading: false } as never))
    expect((await screen.findByTestId("inspector")).dataset.render).toBe("cut")
  })
})

describe("history", () => {
  it("opening replaces history: Back from an opened review leaves the page", async () => {
    const nav = { current: (() => undefined) as (to: number) => void }
    function Nav() {
      const go = useNavigate()
      nav.current = go
      return null
    }
    render(
      <MemoryRouter initialEntries={["/prev", "/editor"]} initialIndex={1}>
        <Nav />
        <ReviewInspectorHost />
        <Probe />
      </MemoryRouter>,
    )
    act(() => openReview("cut"))
    await screen.findByTestId("inspector")
    await waitFor(() => expect(search.current).toBe("?review=cut"))
    act(() => nav.current(-1))
    await waitFor(() => expect(inspector()).toBeNull())
  })
})
