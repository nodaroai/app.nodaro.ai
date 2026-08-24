/**
 * The home-page handoff spends credits without the user pressing anything, so
 * the conditions under which it fires are the whole test.
 *
 * The failure to avoid: opening a workflow that happens to have a
 * `source_prompt` and an unused thread, and paying for a turn nobody asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StrictMode } from "react"
import { render, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import type { ReactNode } from "react"

const sendCopilotMessage = vi.fn(async (text: string) => {
  // What the engine does when a turn actually starts. Tests that want a
  // REFUSED send override this per case.
  const { useCopilotStore: store } = await import("@/ee/lib/copilot/turn-store")
  store.setState({ turn: { ...store.getState().turn, userText: text } })
})
vi.mock("@/ee/lib/copilot/turn-engine", () => ({
  sendCopilotMessage: (text: string) => sendCopilotMessage(text),
}))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))

const workflowState = { workflowId: "wf-current" }
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => workflowState },
}))

const { useCopilotHandoff } = await import("../use-copilot-handoff")
const { useCopilotStore } = await import("@/ee/lib/copilot/turn-store")
import type { CopilotThread } from "@/ee/lib/copilot/types"

const thread = (over: Partial<CopilotThread> = {}): CopilotThread => ({
  id: "thread-1",
  workflowId: "wf-1",
  runMode: "ask",
  autoRunLimitCredits: 100,
  userTurnCount: 0,
  lastMessageAt: null,
  createdAt: "now",
  ...over,
})

function wrapper(url: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
}

function stubWorkflow(sourcePrompt: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { sourcePrompt } }) })),
  )
}

/** Each test uses a fresh workflow id: the module remembers what it handed off. */
let seq = 0
const nextWorkflow = () => `wf-${(seq += 1)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  useCopilotStore.setState({
    threadId: "thread-1",
    draft: "",
    notice: null,
    turn: { ...useCopilotStore.getState().turn, userText: "" },
  })
})

/** Point the editor's store at the workflow a test is handing off to. */
function editorShowing(workflowId: string) {
  workflowState.workflowId = workflowId
}

describe("the home-page handoff", () => {
  it("sends what the user typed on the home page", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("a product shot workflow")
    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=thread-1") })

    await waitFor(() => expect(sendCopilotMessage).toHaveBeenCalledWith("a product shot workflow"))
  })

  it("does NOT fire without the arrival parameter — a plain visit must not spend credits", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("a product shot workflow")
    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e") })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("does not replay a thread that has already been used", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("a product shot workflow")
    renderHook(() => useCopilotHandoff(thread({ userTurnCount: 3 }), id), { wrapper: wrapper("/e?copilot=thread-1") })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("ignores a parameter naming a different thread", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("a product shot workflow")
    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=someone-elses") })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("sends nothing when the workflow carries no prompt", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow(null)
    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=thread-1") })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("does NOT send into a workflow the user opened while the read was in flight", async () => {
    // The most expensive failure available here. `sendCopilotMessage` carries
    // no workflow identity — it reads whatever the editor is showing — so a
    // late hop would spend a turn on the wrong workflow AND let the model
    // write nodes into it.
    const id = nextWorkflow()
    editorShowing(id)
    let release: ((v: unknown) => void) | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => {
          release = resolve
        })
        return { ok: true, json: async () => ({ data: { sourcePrompt: "build it" } }) }
      }),
    )

    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=thread-1") })
    await waitFor(() => expect(release).not.toBeNull())

    editorShowing("a-different-workflow")
    release!(null)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("does not send once the panel has moved to a different conversation", async () => {
    // Same workflow id, different thread — a teardown or a workflow switch that
    // reset the panel while the read was in flight. Sending here would open a
    // turn the panel is no longer showing.
    const id = nextWorkflow()
    editorShowing(id)
    let release: ((v: unknown) => void) | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => {
          release = resolve
        })
        return { ok: true, json: async () => ({ data: { sourcePrompt: "build it" } }) }
      }),
    )

    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=thread-1") })
    await waitFor(() => expect(release).not.toBeNull())

    useCopilotStore.setState({ threadId: "another-thread" })
    release!(null)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("hands the sentence back when the panel goes away mid-hop", async () => {
    // An editor tab switch unmounts the panel. Before, this returned without
    // throwing, so the catch never ran, the once-per-workflow latch stayed
    // set, and the sentence was gone for good with nothing said.
    const id = nextWorkflow()
    editorShowing(id)
    let release: ((v: unknown) => void) | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => {
          release = resolve
        })
        return { ok: true, json: async () => ({ data: { sourcePrompt: "build it" } }) }
      }),
    )

    const { unmount } = renderHook(() => useCopilotHandoff(thread(), id), {
      wrapper: wrapper("/e?copilot=thread-1"),
    })
    await waitFor(() => expect(release).not.toBeNull())
    unmount()
    release!(null)

    await waitFor(() => expect(useCopilotStore.getState().draft).toBe("build it"))
    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("does not send once the panel has gone away", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    let release: ((v: unknown) => void) | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => {
          release = resolve
        })
        return { ok: true, json: async () => ({ data: { sourcePrompt: "build it" } }) }
      }),
    )

    const { unmount } = renderHook(() => useCopilotHandoff(thread(), id), {
      wrapper: wrapper("/e?copilot=thread-1"),
    })
    await waitFor(() => expect(release).not.toBeNull())

    unmount()
    release!(null)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("hands the sentence back when the send RESOLVES without starting a turn", async () => {
    // `sendCopilotMessage` never rejects — a read-only workflow, a failed save
    // and the re-entry latch are early returns inside it, not throws. So the
    // only way to know it refused is that no turn carries the text. Otherwise
    // the user pressed Build it, sat through a page transition, and got an
    // empty editor with no explanation and nothing to retry.
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("a product shot workflow")
    sendCopilotMessage.mockImplementationOnce(async () => undefined)

    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=thread-1") })

    await waitFor(() => expect(useCopilotStore.getState().draft).toBe("a product shot workflow"))
    expect(useCopilotStore.getState().notice).toBeTruthy()
  })

  it("stays quiet when the turn did start", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("a product shot workflow")
    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=thread-1") })

    await waitFor(() => expect(sendCopilotMessage).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(useCopilotStore.getState().draft).toBe("")
    expect(useCopilotStore.getState().notice).toBeNull()
  })

  it("says something when it cannot even read what was asked for", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))

    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: wrapper("/e?copilot=thread-1") })

    await waitFor(() => expect(useCopilotStore.getState().notice).toBeTruthy())
    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("strips the parameter from the URL, so a reload cannot re-send", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("build it")
    const seen: string[] = []
    function Probe() {
      seen.push(useLocation().search)
      useCopilotHandoff(thread(), id)
      return null
    }
    render(<Probe />, { wrapper: wrapper("/e?copilot=thread-1&tab=cost") })

    await waitFor(() => expect(seen.at(-1)).not.toContain("copilot="))
    // Only the handoff's own parameter goes; everything else on the URL stays.
    expect(seen.at(-1)).toContain("tab=cost")
  })

  it("consumes a parameter it declines, so the rail does not reopen forever", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("build it")
    const seen: string[] = []
    function Probe() {
      seen.push(useLocation().search)
      useCopilotHandoff(thread({ userTurnCount: 5 }), id)
      return null
    }
    render(<Probe />, { wrapper: wrapper("/e?copilot=thread-1") })

    await waitFor(() => expect(seen.at(-1)).not.toContain("copilot="))
    expect(sendCopilotMessage).not.toHaveBeenCalled()
  })

  it("does not double-send under StrictMode, which the app runs in development", async () => {
    // React invokes every effect twice there. Without the module-level guard
    // that is two paid turns for one press of Build it, and it would only ever
    // show up on a developer's machine.
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("build it")
    const strict = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <MemoryRouter initialEntries={["/e?copilot=thread-1"]}>{children}</MemoryRouter>
      </StrictMode>
    )

    renderHook(() => useCopilotHandoff(thread(), id), { wrapper: strict })

    await waitFor(() => expect(sendCopilotMessage).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(sendCopilotMessage).toHaveBeenCalledTimes(1)
  })

  it("fires once for a workflow, however often the panel remounts", async () => {
    const id = nextWorkflow()
    editorShowing(id)
    stubWorkflow("build it")
    const opts = { wrapper: wrapper("/e?copilot=thread-1") }

    const first = renderHook(() => useCopilotHandoff(thread(), id), opts)
    await waitFor(() => expect(sendCopilotMessage).toHaveBeenCalledTimes(1))
    first.unmount()

    renderHook(() => useCopilotHandoff(thread(), id), opts)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sendCopilotMessage).toHaveBeenCalledTimes(1)
  })
})
