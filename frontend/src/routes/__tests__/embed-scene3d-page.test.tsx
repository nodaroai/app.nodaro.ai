import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import EmbedScene3DPage from "../embed-scene3d-page"
import { makePlan, REV_A, REV_B } from "@/lib/scene3d/__tests__/fixture"
import {
  SCENE3D_EMBED_EVENT_TYPE,
  SCENE3D_EMBED_PROTOCOL_VERSION,
  SCENE3D_EMBED_READY_TYPE,
  SCENE3D_EMBED_STATE_TYPE,
} from "@/lib/scene3d/embed-protocol"

/**
 * The frame under test. jsdom has no WebGL, so `Scene3DPreview` renders its
 * documented viewport fallback and the DATA half of the panel — object list,
 * transport, history, numeric editors — is what these exercise. That is the
 * half the protocol is about.
 *
 * At the top level `window.parent === window`, so "a message from the parent"
 * is one whose `source` is `window`, and the frame's own outbound posts land on
 * the spied `window.postMessage`.
 */
const PARENT = "https://studio.nodaro.ai"
const CHANNEL = "3f1c9a2e-7b4d-4c8f-9a11-5d6e7f801234"

let posted: Array<{ message: Record<string, unknown>; targetOrigin: unknown }>

function mount(search = `?parentOrigin=${encodeURIComponent(PARENT)}&channel=${CHANNEL}`) {
  render(
    <MemoryRouter initialEntries={[`/embed/scene3d${search}`]}>
      <Routes>
        <Route path="/embed/scene3d" element={<EmbedScene3DPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Deliver an inbound message exactly as the browser would. */
function deliver(
  data: unknown,
  { origin = PARENT, source = window as unknown as Window | null } = {},
) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source }))
  })
}

function stateMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: SCENE3D_EMBED_STATE_TYPE,
    version: SCENE3D_EMBED_PROTOCOL_VERSION,
    channel: CHANNEL,
    scenePlan: makePlan(),
    ...overrides,
  }
}

const sent = (type: string) => posted.filter((p) => p.message.type === type)

beforeEach(() => {
  posted = []
  vi.spyOn(window, "postMessage").mockImplementation(((message: unknown, targetOrigin: unknown) => {
    posted.push({ message: message as Record<string, unknown>, targetOrigin })
  }) as typeof window.postMessage)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("/embed/scene3d — the load handshake", () => {
  it("announces readiness to the exact parent origin, and shows nothing until a scene arrives", () => {
    mount()
    expect(sent(SCENE3D_EMBED_READY_TYPE)).toHaveLength(1)
    expect(sent(SCENE3D_EMBED_READY_TYPE)[0].message).toEqual({
      type: SCENE3D_EMBED_READY_TYPE,
      version: SCENE3D_EMBED_PROTOCOL_VERSION,
      channel: CHANNEL,
    })
    expect(sent(SCENE3D_EMBED_READY_TYPE)[0].targetOrigin).toBe(PARENT)
    expect(screen.getByText(/Waiting for the scene/i)).toBeInTheDocument()
    expect(screen.getByText(/holds no data of its own/i)).toBeInTheDocument()
  })

  it("re-announces readiness while the parent stays silent, and stops once it answers", () => {
    vi.useFakeTimers()
    mount()
    expect(sent(SCENE3D_EMBED_READY_TYPE)).toHaveLength(1)

    // The parent attached its listener late; the repeats are what reach it.
    act(() => void vi.advanceTimersByTime(1_000))
    const beforeAnswer = sent(SCENE3D_EMBED_READY_TYPE).length
    expect(beforeAnswer).toBeGreaterThan(1)

    deliver(stateMessage())
    act(() => void vi.advanceTimersByTime(5_000))
    expect(sent(SCENE3D_EMBED_READY_TYPE)).toHaveLength(beforeAnswer)
  })

  it("stops re-announcing after a REFUSED push too — a rejection still proves the parent is listening", () => {
    vi.useFakeTimers()
    mount()
    act(() => void vi.advanceTimersByTime(1_000))
    const beforeAnswer = sent(SCENE3D_EMBED_READY_TYPE).length

    deliver(stateMessage({ version: 99 }))
    act(() => void vi.advanceTimersByTime(5_000))
    expect(sent(SCENE3D_EMBED_READY_TYPE)).toHaveLength(beforeAnswer)
  })

  it("gives up after a bounded number of attempts rather than announcing forever", () => {
    vi.useFakeTimers()
    mount()
    act(() => void vi.advanceTimersByTime(60_000))
    const attempts = sent(SCENE3D_EMBED_READY_TYPE).length
    expect(attempts).toBeGreaterThan(1)
    expect(attempts).toBeLessThanOrEqual(9) // first announce + READY_RETRY_LIMIT
  })

  it("refuses to announce anything at all without a valid parentOrigin and channel", () => {
    mount("?parentOrigin=null&channel=nope")
    expect(posted).toHaveLength(0)
    expect(screen.getByRole("alert")).toHaveTextContent(/without a valid parent origin and channel/i)
  })
})

describe("/embed/scene3d — what it refuses to listen to", () => {
  it("ignores a message from a window that is not its parent", () => {
    mount()
    const foreign = document.createElement("iframe")
    document.body.appendChild(foreign)
    deliver(stateMessage(), { source: foreign.contentWindow })
    deliver(stateMessage(), { source: null })
    expect(screen.getByText(/Waiting for the scene/i)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
    foreign.remove()
  })

  it("ignores a message from another origin", () => {
    mount()
    deliver(stateMessage(), { origin: "https://evil.example" })
    deliver(stateMessage(), { origin: "https://studio.nodaro.ai.evil.example" })
    expect(screen.getByText(/Waiting for the scene/i)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("ignores a message on another channel", () => {
    mount()
    deliver(stateMessage({ channel: "00000000-0000-4000-8000-000000000000" }))
    expect(screen.getByText(/Waiting for the scene/i)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says so, out loud, when the parent's own push is malformed", () => {
    mount()
    deliver(stateMessage({ scenePlan: makePlan({ backgroundColor: "chartreuse" }) }))
    expect(screen.getByRole("alert")).toHaveTextContent(/last update was refused/i)
    // Still nothing to draw — the refusal did not invent a scene.
    expect(screen.getByText(/Waiting for the scene/i)).toBeInTheDocument()
  })

  it("keeps the scene it already accepted when a later push is refused", () => {
    mount()
    deliver(stateMessage())
    expect(screen.getByText("Hero")).toBeInTheDocument()
    expect(screen.getByText(`rev ${REV_A.slice(0, 8)}`)).toBeInTheDocument()

    deliver(stateMessage({ version: 99 }))
    expect(screen.getByText(/last update was refused/i)).toBeInTheDocument()
    // The accepted revision is untouched — losing it would be worse than the refusal.
    expect(screen.getByText("Hero")).toBeInTheDocument()
    expect(screen.getByText(`rev ${REV_A.slice(0, 8)}`)).toBeInTheDocument()

    // …and the next good push clears the banner.
    deliver(stateMessage({ scenePlan: makePlan({ revisionId: REV_B }) }))
    expect(screen.queryByText(/last update was refused/i)).toBeNull()
    expect(screen.getByText(`rev ${REV_B.slice(0, 8)}`)).toBeInTheDocument()
  })
})

describe("/embed/scene3d — read-only is the default", () => {
  it("renders view-only when the parent does not say otherwise", () => {
    mount()
    deliver(stateMessage({ lockedObjectIds: ["hero"] }))
    expect(screen.getByText("View only")).toBeInTheDocument()
    expect((screen.getByLabelText("Camera focal length") as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByLabelText("Lock Ground")).toBeNull()
    expect(screen.getByLabelText("Hero locked")).toBeInTheDocument()
  })

  it("still scrubs and still reports selection upstream", () => {
    mount()
    deliver(stateMessage())
    fireEvent.change(screen.getByLabelText("Scrub"), { target: { value: "48" } })
    expect(screen.getByText("2.00s")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Hero"))
    const events = sent(SCENE3D_EMBED_EVENT_TYPE)
    expect(events).toHaveLength(1)
    expect(events[0].message.event).toEqual({ kind: "selection", objectIds: ["hero"] })
  })

  it("emits no mutation even when a read-only control is driven directly", () => {
    mount()
    deliver(stateMessage({ selectedObjectIds: ["hero"] }))
    const field = screen.getByLabelText("Hero Position X")
    fireEvent.change(field, { target: { value: "2.5" } })
    fireEvent.blur(field)
    fireEvent.change(screen.getByLabelText("Background color"), { target: { value: "#ff0073" } })
    expect(sent(SCENE3D_EMBED_EVENT_TYPE)).toHaveLength(0)
  })
})

describe("/embed/scene3d — an editable frame", () => {
  const editable = (overrides: Record<string, unknown> = {}) =>
    stateMessage({ readOnly: false, ...overrides })

  const history = [
    { revisionId: REV_B, scenePlan: makePlan({ revisionId: REV_B }), source: "generate", createdAt: "x" },
    { revisionId: REV_A, scenePlan: makePlan(), source: "manual", changeSummary: "moved hero", createdAt: "y" },
  ]

  it("reports a deterministic edit as a NEW revision stamped with the one it came from", () => {
    mount()
    deliver(editable({ selectedObjectIds: ["hero"] }))
    const field = screen.getByLabelText("Hero Position X")
    fireEvent.change(field, { target: { value: "2.5" } })
    fireEvent.blur(field)

    const events = sent(SCENE3D_EMBED_EVENT_TYPE)
    expect(events).toHaveLength(1)
    const message = events[0].message as Record<string, unknown>
    expect(message.expectedRevisionId).toBe(REV_A)
    const event = message.event as { kind: string; plan: Record<string, unknown>; changeSummary: string }
    expect(event.kind).toBe("plan")
    expect(event.plan.parentRevisionId).toBe(REV_A)
    expect(event.plan.revisionId).not.toBe(REV_A)
    expect(event.changeSummary).toBeTruthy()
  })

  it("does NOT advance its own view after an edit — the parent owns the state", () => {
    mount()
    deliver(editable({ selectedObjectIds: ["hero"] }))
    const field = screen.getByLabelText("Hero Position X")
    fireEvent.change(field, { target: { value: "2.5" } })
    fireEvent.blur(field)

    // The frame is still showing REV_A. It moves when the parent pushes, never
    // on its own — a frame that ran ahead could disagree with what gets saved.
    expect(screen.getByText(`rev ${REV_A.slice(0, 8)}`)).toBeInTheDocument()

    const next = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    deliver(editable({ scenePlan: next }))
    expect(screen.getByText(`rev ${REV_B.slice(0, 8)}`)).toBeInTheDocument()
  })

  it("reports lock, restore and pending decisions with the same revision stamp", () => {
    mount()
    deliver(editable({ history, pendingPlan: makePlan({ revisionId: REV_B }) }))

    fireEvent.click(screen.getByLabelText("Lock Hero"))
    fireEvent.click(screen.getByLabelText(`Restore revision ${REV_B.slice(0, 6)}`))
    fireEvent.click(screen.getByText("Use the new one"))
    fireEvent.click(screen.getByText("Keep mine"))

    const events = sent(SCENE3D_EMBED_EVENT_TYPE)
    expect(events.map((e) => (e.message.event as { kind: string }).kind)).toEqual([
      "locks",
      "restore",
      "resolve-pending",
      "resolve-pending",
    ])
    expect(events.map((e) => e.message.expectedRevisionId)).toEqual([REV_A, REV_A, REV_A, REV_A])
    expect(events[0].message.event).toEqual({ kind: "locks", objectIds: ["hero"] })
    expect(events[1].message.event).toEqual({ kind: "restore", revisionId: REV_B })
    expect(events[2].message.event).toEqual({ kind: "resolve-pending", adopt: true })
    expect(events[3].message.event).toEqual({ kind: "resolve-pending", adopt: false })
  })

  it("addresses EVERY outbound message to the exact parent origin — never a wildcard", () => {
    mount()
    deliver(editable({ selectedObjectIds: ["hero"], history }))
    fireEvent.click(screen.getByText("Ground"))
    fireEvent.click(screen.getByLabelText("Lock Hero"))
    fireEvent.click(screen.getByLabelText(`Restore revision ${REV_B.slice(0, 6)}`))

    expect(posted.length).toBeGreaterThan(3)
    for (const { targetOrigin } of posted) expect(targetOrigin).toBe(PARENT)
  })

  it("stamps every outbound message with the protocol version and the channel it was opened on", () => {
    mount()
    deliver(editable())
    fireEvent.click(screen.getByText("Hero"))
    for (const { message } of posted) {
      expect(message.version).toBe(SCENE3D_EMBED_PROTOCOL_VERSION)
      expect(message.channel).toBe(CHANNEL)
    }
  })
})
