import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { NODARO_AI_PANEL_CLOSE, NODARO_AI_PANEL_INIT, NODARO_AI_PANEL_LAYOUT, NODARO_AI_PANEL_READY } from "@nodaro/shared/media"

const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, loading: false, awaitingHandoff: false, credits: true }))
const panelProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }))

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: auth.user, loading: auth.loading }) }))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ useEmbedSessionHandoff: () => ({ awaitingHandoff: auth.awaitingHandoff }) }))
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => auth.credits }))
// The panel is tested on its own; here it only shows what it was given.
vi.mock("@/ee/components/freecut-ai/ai-edit-panel", () => ({
  default: (props: Record<string, unknown>) => {
    panelProps.last = props
    return <div data-testid="panel">{String(props.openedVideoUrl)}</div>
  },
}))

import EditWithAiFramePage from "../page"

const HOST = "https://nodaro.ai"
const VIDEO = "https://cdn.nodaro.ai/uploads/video/u/take.mp4"
const READY_EDITOR = ["edit-ops", "timeline-read", "playback", "presence"]

let parent: { postMessage: ReturnType<typeof vi.fn> }
const undo: Array<() => void> = []
function override(key: "parent" | "self", value: unknown) {
  const before = Object.getOwnPropertyDescriptor(window, key)
  Object.defineProperty(window, key, { configurable: true, value })
  undo.push(() => {
    if (before) Object.defineProperty(window, key, before)
  })
}
function deliver(data: unknown, { origin = HOST, source = parent as unknown } = {}) {
  const event = new MessageEvent("message", { data, origin })
  Object.defineProperty(event, "source", { value: source })
  act(() => {
    window.dispatchEvent(event)
  })
}
const init = (payload: Record<string, unknown> = {}) => ({
  type: NODARO_AI_PANEL_INIT,
  payload: { version: 1, capabilities: READY_EDITOR, videos: [{ url: VIDEO, name: "Shot 1.mp4" }], openedVideoUrl: VIDEO, ...payload },
})

beforeEach(() => {
  auth.user = { id: "u1" }
  auth.loading = false
  auth.awaitingHandoff = false
  auth.credits = true
  panelProps.last = null
  parent = { postMessage: vi.fn() }
  override("parent", parent)
  override("self", {})
})

afterEach(() => {
  while (undo.length) undo.pop()!()
  vi.useRealTimers()
})

describe("/embed/edit-with-ai", () => {
  it("announces itself to the page that frames it, and waits for that page", () => {
    render(<EditWithAiFramePage />)
    expect(parent.postMessage).toHaveBeenCalledWith({ type: NODARO_AI_PANEL_READY, payload: { version: 1 } }, "*")
    expect(screen.getByText("Connecting to the editor…")).toBeTruthy()
    expect(screen.queryByTestId("panel")).toBeNull()
  })

  it("shows the panel on the opened video once its host answers, and talks to the editor through that host", () => {
    render(<EditWithAiFramePage />)
    deliver(init())
    expect(screen.getByTestId("panel").textContent).toBe(VIDEO)
    expect((panelProps.last?.editorWindow as () => unknown)()).toBe(parent)
    expect(panelProps.last?.editorOrigin).toBe(HOST)
    // The host loaded each video under the name it sent: the run tells them apart by it.
    expect(panelProps.last?.videos).toEqual([{ url: VIDEO, name: "Shot 1.mp4" }])
    expect(panelProps.last?.matchByName).toBe(true)
  })

  it("asks its host for the editor's whole area while it shows the original, and gives it back", () => {
    render(<EditWithAiFramePage />)
    deliver(init())
    act(() => (panelProps.last?.onLayout as (wide: boolean) => void)(true))
    expect(parent.postMessage).toHaveBeenCalledWith({ type: NODARO_AI_PANEL_LAYOUT, payload: { wide: true } }, HOST)
    act(() => (panelProps.last?.onLayout as (wide: boolean) => void)(false))
    expect(parent.postMessage).toHaveBeenLastCalledWith({ type: NODARO_AI_PANEL_LAYOUT, payload: { wide: false } }, HOST)
  })

  it("never starts for a page on another site, or for a frame that is not its parent", () => {
    render(<EditWithAiFramePage />)
    deliver(init(), { origin: "https://evil.example" })
    deliver(init(), { source: { other: true } })
    deliver(init(), { origin: "https://cdn.nodaro.ai" })
    expect(screen.queryByTestId("panel")).toBeNull()
  })

  it("keeps its first host: a second page that answers later is not listened to", () => {
    render(<EditWithAiFramePage />)
    deliver(init())
    deliver(init({ openedVideoUrl: "https://cdn.nodaro.ai/other.mp4", videos: [] }), { origin: "https://next.tools.nodaro.ai" })
    expect(screen.getByTestId("panel").textContent).toBe(VIDEO)
    // The same host may update what the panel works on.
    const next = { url: "https://cdn.nodaro.ai/next.mp4", name: "Shot 2.mp4" }
    deliver(init({ videos: [{ url: VIDEO, name: "Shot 1.mp4" }, next], openedVideoUrl: next.url, project: 2 }))
    expect(screen.getByTestId("panel").textContent).toBe(next.url)
    expect(panelProps.last?.project).toBe(2)
    // An opened video that is not one of the videos the panel may edit is not taken.
    deliver(init({ openedVideoUrl: "https://cdn.nodaro.ai/elsewhere.mp4" }))
    expect(screen.getByTestId("panel").textContent).toBe("undefined")
  })

  it("keeps the panel once shown, when a later INIT has no video or the editor is reloading", () => {
    render(<EditWithAiFramePage />)
    deliver(init())
    expect(screen.getByTestId("panel")).toBeTruthy()
    deliver(init({ videos: [], openedVideoUrl: undefined, capabilities: [] }))
    // Unmounting it would end a run in progress and forget what it can undo.
    expect(screen.getByTestId("panel")).toBeTruthy()
  })

  it("closes through its host", () => {
    render(<EditWithAiFramePage />)
    deliver(init())
    act(() => (panelProps.last?.onClose as () => void)())
    expect(parent.postMessage).toHaveBeenCalledWith({ type: NODARO_AI_PANEL_CLOSE, payload: {} }, HOST)
  })

  it("waits for the sign-in its host hands over, and says to sign in when there is none", () => {
    auth.user = null
    auth.awaitingHandoff = true
    const { rerender } = render(<EditWithAiFramePage />)
    deliver(init())
    expect(screen.getByText("Signing in…")).toBeTruthy()
    auth.awaitingHandoff = false
    rerender(<EditWithAiFramePage />)
    expect(screen.getByText("Sign in to Nodaro to edit with AI.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("target")).toBe("_blank")
    expect(screen.queryByTestId("panel")).toBeNull()
  })

  it("waits for the editor, and says so when the editor cannot be edited from here", () => {
    const { unmount } = render(<EditWithAiFramePage />)
    deliver(init({ capabilities: [] }))
    expect(screen.getByText("Waiting for the editor to open…")).toBeTruthy()
    deliver(init({ capabilities: ["timeline-add"] }))
    expect(screen.getByText("This editor does not take edits from Edit with AI yet.")).toBeTruthy()
    unmount()
  })

  it("asks for a video when its host has none it can give an address for", () => {
    render(<EditWithAiFramePage />)
    deliver(init({ videos: [], openedVideoUrl: undefined }))
    expect(screen.getByText("Load a video into the editor first.")).toBeTruthy()
  })

  it("says where to open it when nobody frames it, or nobody answers", () => {
    vi.useFakeTimers()
    render(<EditWithAiFramePage />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByText("Open Edit with AI from the video editor.")).toBeTruthy()
    // The announcement repeats a bounded number of times, then stops.
    const announced = parent.postMessage.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(parent.postMessage.mock.calls.length).toBe(announced)
  })

  it("is not offered on a build without credits", () => {
    auth.credits = false
    render(<EditWithAiFramePage />)
    expect(screen.getByText("Edit with AI is not available here.")).toBeTruthy()
  })
})
