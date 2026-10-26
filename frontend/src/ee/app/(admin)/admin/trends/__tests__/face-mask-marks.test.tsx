/**
 * Admin → Trends → one trend → 6. Face masking → marks (faces left unmasked).
 *
 * - The pure helpers: the frame at a time, the picture's rectangle in a
 *   letterboxed player, a box from a drag, In / Out.
 * - On the approved mask: drag a box (whole clip by default), set In / Out
 *   from the frame shown, delete one; "Apply edits" saves the draft's
 *   `faceMasking.marks` (the rest of the draft as saved), then makes the mask
 *   again with the revision that save returned.
 * - A mask approved before marks (no raw mask kept) says the first edit makes
 *   the whole mask; the erased-faces stat shows.
 * - A draft save keeps the marks (`cleanMasking`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendFaceMask, AdminTrendFaceMaskMark } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { frameAt, markFromDrag, pictureRect, timeOfFrame, withRangeEnd } from "../components/FaceMaskMarks"
import { cleanMasking } from "../model"

const BASE = `/v1/admin/trends/${TREND_ID}`
const JOB = "00000000-0000-4000-8000-0000000000f1"
const MASKING = { mode: "always" as const }
const MARK: AdminTrendFaceMaskMark = { label: "erased", fromFrame: 10, toFrame: 99, leftPct: 60, topPct: 10, rightPct: 90, bottomPct: 50 }

const STORED: AdminTrendFaceMask = {
  url: "https://cdn.test/trends/a1/mask.mp4",
  frames: 360,
  recipe: { core: "2026-10-25", plugin: "1" },
  settingsKey: "v2:abc",
  jobId: JOB,
  stats: { shots: 2, heldFrames: 7, coverage: 0.042, droppedRegions: 0 },
  approvedAt: "2026-10-25T10:00:00.000Z",
  approvedBy: "admin",
  rawMaskUrl: "https://cdn.test/trends/a1/raw.mp4",
  baseKey: "v2:base",
}

describe("the marks' helpers", () => {
  it("frameAt: the frame of a time on the mask's own frame count, clamped", () => {
    expect(frameAt(0, 12, 360)).toBe(0)
    expect(frameAt(6, 12, 360)).toBe(180)
    expect(frameAt(12, 12, 360)).toBe(359)
    expect(frameAt(99, 12, 360)).toBe(359)
    expect(frameAt(-1, 12, 360)).toBe(0)
    expect(frameAt(3, 0, 360)).toBe(0)
    // A seek to a frame's time shows that frame.
    for (const f of [0, 1, 179, 359]) expect(frameAt(timeOfFrame(f, 12, 360), 12, 360)).toBe(f)
  })

  it("frameAt / timeOfFrame with the clip's frame rate: the picture's own clock, not the container's duration", () => {
    // A 300-frame 30 fps picture in a container whose sound runs to 12 s: frames by the rate.
    expect(frameAt(5, 12, 300, 30)).toBe(150)
    expect(frameAt(1 / 30, 12, 300, 30)).toBe(1)
    expect(frameAt(11.9, 12, 300, 30)).toBe(299)
    expect(timeOfFrame(150, 12, 300, 30)).toBeCloseTo(150.5 / 30)
    for (const f of [0, 1, 149, 299]) expect(frameAt(timeOfFrame(f, 12, 300, 30), 12, 300, 30)).toBe(f)
    // NTSC: 29.97 fps.
    for (const f of [0, 1, 1000]) expect(frameAt(timeOfFrame(f, 60, 1798, 30000 / 1001), 60, 1798, 30000 / 1001)).toBe(f)
  })

  it("pictureRect: the letterboxed picture inside the player (object-contain)", () => {
    // A portrait 720×1280 clip in a 400×300 player: pillarboxed.
    expect(pictureRect(400, 300, 720, 1280)).toEqual({ x: 115.625, y: 0, w: 168.75, h: 300 })
    // A landscape clip in a tall player: letterboxed.
    expect(pictureRect(200, 400, 1920, 1080)).toEqual({ x: 0, y: 143.75, w: 200, h: 112.5 })
    // Not known yet: the whole element.
    expect(pictureRect(200, 100, 0, 0)).toEqual({ x: 0, y: 0, w: 200, h: 100 })
  })

  it("markFromDrag: either drag direction, clamped to the picture, over the whole clip; a click is no box", () => {
    expect(markFromDrag({ x: 80, y: 60 }, { x: 20, y: -5 }, 360)).toEqual({ label: "erased", fromFrame: 0, toFrame: 359, leftPct: 20, topPct: 0, rightPct: 80, bottomPct: 60 })
    expect(markFromDrag({ x: 50, y: 50 }, { x: 50.4, y: 70 }, 360)).toBeNull()
  })

  it("withRangeEnd: In and Out from a frame, the other end moving when it would cross", () => {
    expect(withRangeEnd(MARK, "in", 20)).toMatchObject({ fromFrame: 20, toFrame: 99 })
    expect(withRangeEnd(MARK, "in", 150)).toMatchObject({ fromFrame: 150, toFrame: 150 })
    expect(withRangeEnd(MARK, "out", 50)).toMatchObject({ fromFrame: 10, toFrame: 50 })
    expect(withRangeEnd(MARK, "out", 5)).toMatchObject({ fromFrame: 5, toFrame: 5 })
  })

  it("cleanMasking keeps the marks (none = no key)", () => {
    expect(cleanMasking({ mode: "always", marks: [MARK] })).toEqual({ mode: "always", marks: [MARK] })
    expect(cleanMasking({ mode: "always", marks: [] })).toEqual({ mode: "always" })
  })
})

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

/** The marking surface laid out as a 200×100 picture at the viewport's origin. */
function surface(): HTMLElement {
  const el = screen.getByTestId("face-mask-marks-surface")
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return el
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
})
afterEach(() => vi.unstubAllGlobals())

describe("marking faces on the face mask", { timeout: 20_000 }, () => {
  it("draws a box over the whole clip, sets In and Out, and Apply edits saves the marks then makes the mask with that revision", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true }, { faceMasking: MASKING, faceMask: STORED }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    routes[`POST ${BASE}/face-mask`] = () => ({ status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-3", recorded: true, draftMoved: false } } })
    routes[`GET /v1/jobs/${JOB}`] = () => ({ body: { data: { id: JOB, status: "processing", progress: 10 } } })
    renderEditor()

    expect(await screen.findByLabelText("The approved face mask")).toHaveAttribute("src", STORED.url)
    expect(screen.getByRole("button", { name: /apply edits/i })).toBeDisabled()
    // Drag from (40, 10) to (120, 60) on a 200×100 picture: 20–60 % across, 10–60 % down.
    const s = surface()
    fireEvent.pointerDown(s, { clientX: 40, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(s, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(s, { clientX: 120, clientY: 60, pointerId: 1 })
    const list = screen.getByRole("list", { name: /faces left unmasked/i })
    expect(within(list).getByText("Box 1: frames 1–360")).toBeInTheDocument()

    // Frame 180 from the scrubber, then In; frame 200, then Out.
    fireEvent.change(screen.getByRole("slider", { name: /frame/i }), { target: { value: "180" } })
    await user.click(within(list).getByRole("button", { name: /in here/i }))
    fireEvent.change(screen.getByRole("slider", { name: /frame/i }), { target: { value: "200" } })
    await user.click(within(list).getByRole("button", { name: /out here/i }))
    expect(within(list).getByText("Box 1: frames 181–201")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /apply edits/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/face-mask`)).toEqual([{ revision: "rev-2" }]))
    const [saved] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { faceMasking: unknown }; revision: string }>
    expect(saved!.revision).toBe("rev-1")
    expect(saved!.data.faceMasking).toEqual({
      mode: "always",
      marks: [{ label: "erased", fromFrame: 180, toFrame: 200, leftPct: 20, topPct: 10, rightPct: 60, bottomPct: 60 }],
    })
  })

  it("lists the saved marks, deletes one, and a mask approved before marks says the first edit makes it whole", async () => {
    const user = userEvent.setup()
    const OLD = { ...STORED, rawMaskUrl: undefined, baseKey: undefined, stats: { ...STORED.stats, erasedRegions: 3 } }
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true }, { faceMasking: { ...MASKING, marks: [MARK, { ...MARK, fromFrame: 0 }] }, faceMask: OLD }) },
    })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    routes[`POST ${BASE}/face-mask`] = () => ({ status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-3", recorded: true, draftMoved: false } } })
    routes[`GET /v1/jobs/${JOB}`] = () => ({ body: { data: { id: JOB, status: "processing" } } })
    renderEditor()

    const list = await screen.findByRole("list", { name: /faces left unmasked/i })
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByTestId("face-mask-stats")).toHaveTextContent("3 faces left unmasked")
    expect(screen.queryByText(/makes the whole mask again/i)).not.toBeInTheDocument()

    await user.click(within(list).getByRole("button", { name: "Delete box 1" }))
    expect(within(list).getAllByRole("listitem")).toHaveLength(1)
    expect(screen.getByText(/makes the whole mask again/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /apply edits/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/face-mask`)).toHaveLength(1))
    const [saved] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { faceMasking: unknown } }>
    expect(saved!.data.faceMasking).toEqual({ mode: "always", marks: [{ ...MARK, fromFrame: 0 }] })
  })

  it("removing every mark when the approved mask is already the one for no marks saves only, and makes nothing", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "out_of_date", reasons: [{ why: "settings" }] }, faceMaskMarksSupported: true }, { faceMasking: { ...MASKING, marks: [MARK] }, faceMask: STORED }) },
    })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2", faceMaskState: { status: "approved", reasons: [] } } } })
    renderEditor()
    const list = await screen.findByRole("list", { name: /faces left unmasked/i })
    await user.click(within(list).getByRole("button", { name: "Delete box 1" }))
    await user.click(screen.getByRole("button", { name: /apply edits/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    expect((sentTo(`PUT ${BASE}/draft`)[0] as { data: { faceMasking: unknown } }).data.faceMasking).toEqual({ mode: "always" })
    expect(sentTo(`POST ${BASE}/face-mask`)).toEqual([])
  })

  it("on an engine that cannot leave faces unmasked, the marks editor is disabled and says why", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: false }, { faceMasking: { ...MASKING, marks: [MARK] }, faceMask: STORED }) } })
    renderEditor()
    expect(await screen.findByText(/cannot leave faces unmasked yet/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete box 1" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /apply edits/i })).toBeDisabled()
    expect(screen.getByTestId("face-mask-marks-surface")).toHaveClass("pointer-events-none")
  })

  it("a save the server answers with marksCleared (a new source clip) says so and drops the marks from the form", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true }, { faceMasking: { ...MASKING, marks: [MARK] }, faceMask: STORED }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2", faceMaskState: { status: "out_of_date", reasons: [{ why: "settings" }] }, marksCleared: true } } })
    renderEditor()
    await user.type(await screen.findByLabelText(/trend prompt/i), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    expect(await screen.findByText(/erase marks were cleared because the source clip changed/i)).toBeInTheDocument()
    // The form now matches what was saved: nothing left to save, and the next save sends no marks.
    await waitFor(() => expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled())
    await user.type(screen.getByLabelText(/trend prompt/i), "?")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(2))
    expect((sentTo(`PUT ${BASE}/draft`)[1] as { data: { faceMasking: unknown } }).data.faceMasking).toEqual({ mode: "always" })
  })

  it("waits while the form has unsaved edits, and a normal save keeps the saved marks", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true }, { faceMasking: { ...MASKING, marks: [MARK] }, faceMask: STORED }) },
    })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    const list = await screen.findByRole("list", { name: /faces left unmasked/i })
    await user.click(within(list).getByRole("button", { name: "Delete box 1" }))
    await user.type(screen.getByLabelText(/trend prompt/i), "!")
    expect(screen.getByRole("button", { name: /apply edits/i })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [saved] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { faceMasking: unknown } }>
    // The form's save carries the SAVED marks: the panel's edit is applied only by Apply edits.
    expect(saved!.data.faceMasking).toEqual({ mode: "always", marks: [MARK] })
  })
})
