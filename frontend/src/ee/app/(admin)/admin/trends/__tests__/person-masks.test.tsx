/**
 * Admin → Trends → one trend → 6. Face masking → people's face marks and the
 * person masks (decided 2026-10-27).
 *
 * - A box may be for one optional person: new boxes take the last choice,
 *   each box can be reassigned, and the list counts each one's boxes.
 * - A person's marks on a slot that is no longer an optional person hold Save
 *   with a sentence (the server refuses such a save).
 * - The person masks list each combination with its state; "Make person
 *   masks" starts the missing ones with the screen's revision; while any is
 *   being made the panel moves them on.
 * - A trend with examples says the people's marks have no run effect; more
 *   than 3 marked people says it can't be published.
 * - The new publish blockers read as sentences.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendFaceMask, AdminTrendFaceMaskMark, AdminTrendFaceMaskVariantsState } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, slot, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { labelOf, labelValue, markCounts, markFromDrag } from "../components/FaceMaskMarks"
import { peopleNamed } from "../components/FaceMaskVariants"
import { describeBlocker, personMarkIssues } from "../model"
import { unmarkedPeople } from "../components/FaceMaskPanel"

const BASE = `/v1/admin/trends/${TREND_ID}`
const MASKING = { mode: "always" as const }
const box = { fromFrame: 0, toFrame: 359, leftPct: 10, topPct: 10, rightPct: 30, bottomPct: 50 }
const AMY_MARK: AdminTrendFaceMaskMark = { label: { slot: "amy" }, ...box }
const PEOPLE = [{ key: "amy", label: "Amy" }, { key: "ben", label: "Ben" }]
const SLOTS = [slot(), slot({ key: "amy", label: { en: "Amy" }, required: false }), slot({ key: "ben", label: { en: "Ben" }, required: false })]

const STORED: AdminTrendFaceMask = {
  url: "https://cdn.test/trends/a1/mask.mp4",
  frames: 360,
  recipe: { core: "2026-10-25", plugin: "1" },
  settingsKey: "v2:abc",
  jobId: "fm-1",
  stats: { shots: 2, heldFrames: 7, coverage: 0.042, droppedRegions: 0 },
  approvedAt: "2026-10-25T10:00:00.000Z",
  approvedBy: "admin",
  rawMaskUrl: "https://cdn.test/trends/a1/raw.mp4",
  baseKey: "v2:base",
}

function variants(over: Partial<AdminTrendFaceMaskVariantsState> = {}): AdminTrendFaceMaskVariantsState {
  return {
    applies: true,
    people: ["amy"],
    overCap: false,
    baseProblem: null,
    variants: [{ emptySlots: ["amy"], status: "missing" }],
    ...over,
  }
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

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

describe("the people's marks: helpers", () => {
  it("labels, a drag for a person, the counts per person", () => {
    expect(labelValue("erased")).toBe("erased")
    expect(labelValue({ slot: "amy" })).toBe("slot:amy")
    expect(labelOf("slot:amy")).toEqual({ slot: "amy" })
    expect(labelOf("erased")).toBe("erased")
    expect(markFromDrag({ x: 10, y: 10 }, { x: 30, y: 50 }, 360, { slot: "amy" })).toEqual(AMY_MARK)
    const marks = [AMY_MARK, { ...AMY_MARK, label: "erased" as const }, AMY_MARK]
    expect(markCounts(marks, PEOPLE)).toEqual([{ who: "Everyone", count: 1 }, { who: "Amy", count: 2 }])
    expect(peopleNamed(["amy", "ben"], PEOPLE)).toBe("Amy and Ben")
  })

  it("holds Save on a person's marks when the slot is no longer an optional person", () => {
    const form = { slots: SLOTS.map((s) => ({ ...s, uid: s.key, isNew: false })), faceMasking: { ...MASKING, marks: [AMY_MARK] } }
    expect(personMarkIssues(form)).toEqual([])
    const required = { ...form, slots: form.slots.map((s) => (s.key === "amy" ? { ...s, required: true } : s)) }
    expect(personMarkIssues(required)).toEqual([`Face masking: "Amy" is now required, but has face marks. Remove that person's face marks first (6. Face masking).`])
    expect(personMarkIssues({ ...form, slots: form.slots.filter((s) => s.key !== "amy") })[0]).toMatch(/"amy" is no longer a slot/)
  })

  it("reads the person mask blockers as sentences", () => {
    expect(describeBlocker({ code: "face_mask_people_over_cap", slots: ["a", "b", "c", "d"] })).toMatch(/More than 3 people/)
    expect(describeBlocker({ code: "face_mask_variant_missing", slots: ["amy"] })).toMatch(/runs without amy is not made yet/)
    expect(describeBlocker({ code: "face_mask_variant_out_of_date", slots: ["amy", "ben"] })).toMatch(/runs without amy, ben is out of date/)
  })
})

describe("the hint for optional people without person marks", { timeout: 20_000 }, () => {
  it("lists them on a masked trend with no examples", async () => {
    expect(unmarkedPeople(PEOPLE, [AMY_MARK])).toEqual([{ key: "ben", label: "Ben" }])
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [], variants: variants() } }, { slots: SLOTS, faceMasking: { ...MASKING, marks: [AMY_MARK] }, faceMask: STORED }) },
    })
    renderEditor()
    expect(await screen.findByTestId("face-mask-unmarked-people")).toHaveTextContent(/Ben has no person marks, so a run that leaves this person empty keeps them blurred/)
  })

  it("says nothing on a trend with examples", async () => {
    const example = { videoUrl: "https://cdn.test/ex.mp4", width: 720, height: 1280, durationSec: 12, slots: {}, sourceJobId: "j" }
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [] } }, { slots: SLOTS, faceMasking: MASKING, faceMask: STORED, examples: [example] }) },
    })
    renderEditor()
    expect(await screen.findByLabelText("Face mask")).toBeInTheDocument()
    expect(screen.queryByTestId("face-mask-unmarked-people")).toBeNull()
  })
})

describe("marking people and making their masks", { timeout: 20_000 }, () => {
  it("new boxes are for the chosen person; a box can be reassigned; the list counts them", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true }, { slots: SLOTS, faceMasking: MASKING, faceMask: STORED }) },
    })
    renderEditor()
    expect(await screen.findByLabelText("The approved face mask")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("combobox", { name: /who new boxes are for/i }), { target: { value: "slot:amy" } })
    const s = surface()
    fireEvent.pointerDown(s, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(s, { clientX: 60, clientY: 50, pointerId: 1 })
    // The choice holds for the next box too.
    fireEvent.pointerDown(s, { clientX: 100, clientY: 10, pointerId: 2 })
    fireEvent.pointerUp(s, { clientX: 140, clientY: 50, pointerId: 2 })
    const list = screen.getByRole("list", { name: /faces left unmasked/i })
    expect(within(list).getAllByText(/· Amy$/)).toHaveLength(2)
    expect(screen.getByTestId("face-mask-mark-counts")).toHaveTextContent("Amy: 2 boxes")
    fireEvent.change(within(list).getByRole("combobox", { name: /who box 2 is for/i }), { target: { value: "slot:ben" } })
    expect(screen.getByTestId("face-mask-mark-counts")).toHaveTextContent("Amy: 1 box · Ben: 1 box")
  })

  it("lists each person mask and makes the missing ones with the screen's revision", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "approved", reasons: [], variants: variants() }, faceMaskMarksSupported: true },
          { slots: SLOTS, faceMasking: { ...MASKING, marks: [AMY_MARK] }, faceMask: STORED },
        ),
      },
    })
    routes[`POST ${BASE}/face-mask/variants`] = () => ({ status: 202, body: { data: { started: 1, recorded: true, version: 1, revision: "rev-2" } } })
    renderEditor()
    const panel = await screen.findByLabelText("Person masks")
    expect(within(panel).getByText("Runs without Amy")).toBeInTheDocument()
    expect(within(panel).getByText("Not made")).toBeInTheDocument()
    await user.click(within(panel).getByRole("button", { name: /make person masks \(1\)/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/face-mask/variants`)).toHaveLength(1))
    expect(sentTo(`POST ${BASE}/face-mask/variants`)[0]).toEqual({ revision: expect.any(String) })
  })

  it("moves the person masks being made on, and shows an approved one", async () => {
    const making = variants({ variants: [{ emptySlots: ["amy"], status: "making", job: { emptySlots: ["amy"], key: "pv1:k", jobId: "j", eraseJobId: "e", startedAt: "t" } }] })
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [], variants: making } }, { slots: SLOTS, faceMasking: { ...MASKING, marks: [AMY_MARK] }, faceMask: STORED }) },
    })
    routes[`POST ${BASE}/face-mask/variants/advance`] = () => ({ body: { data: { changed: false, revision: "rev-1", faceMaskState: { status: "approved", reasons: [], variants: making } } } })
    renderEditor()
    expect(await screen.findByText("Being made")).toBeInTheDocument()
    await waitFor(() => expect(sentTo(`POST ${BASE}/face-mask/variants/advance`).length).toBeGreaterThan(0), { timeout: 8_000 })

    const approved = variants({
      variants: [{ emptySlots: ["amy"], status: "approved", variant: { emptySlots: ["amy"], key: "pv1:k", url: "https://cdn.test/v.mp4", frames: 360, jobId: "j", stats: { coverage: 0.02, erasedRegions: 3 }, approvedAt: "t" } }],
    })
    resetRoutes()
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [], variants: approved } }, { slots: SLOTS, faceMasking: { ...MASKING, marks: [AMY_MARK] }, faceMask: STORED }) },
    })
    renderEditor()
    expect(await screen.findAllByLabelText("The mask for runs without Amy")).not.toHaveLength(0)
  }, 20_000)

  it("says the marks have no run effect on a trend with examples, and that more than 3 people can't be published", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [], variants: variants({ applies: false, variants: [] }) } }, { slots: SLOTS, faceMasking: { ...MASKING, marks: [AMY_MARK] }, faceMask: STORED }) },
    })
    renderEditor()
    expect(await screen.findByText(/these face marks have no effect on runs/i)).toBeInTheDocument()
  })

  it("says more than 3 marked people can't be published", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [], variants: variants({ people: ["a", "b", "c", "d"], overCap: true, variants: [] }) } }, { slots: SLOTS, faceMasking: { ...MASKING, marks: [AMY_MARK] }, faceMask: STORED }) },
    })
    renderEditor()
    expect(await screen.findByText(/at most 3 may/i)).toBeInTheDocument()
  })
})
