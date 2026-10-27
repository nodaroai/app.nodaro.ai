/**
 * Admin → Trends → one trend → 6. Face masking → Clip preparation: Faces
 * hidden (the default), Full depth, Keep people.
 *
 * - The pure rules (`withClipPreparation`, `clipPreparationIssues`,
 *   `cleanMasking`'s `source`): a depth mode is mode "always"; leaving Keep
 *   people drops its whole-person target and its main character boxes.
 * - The editor shows only what the mode reads: Full depth nothing but the
 *   mode note; Keep people what is kept (the whole person by default), no
 *   fill; Faces hidden everything, as before.
 * - The marks: "main" is the main character (never a slot), offered in Keep
 *   people only.
 * - The new publish refusals read as sentences.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendFaceMask, AdminTrendFaceMaskMark, TrendEngineEnvironment } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { clipPreparationIssues, withClipPreparation } from "../clip-preparation"
import { cleanMasking, describeBlocker, maskingIssues } from "../model"
import { labelOf, labelValue, markCounts, markFromDrag, markWho } from "../components/FaceMaskMarks"
import { unmarkedPeople } from "../components/FaceMaskPanel"
import { environmentsLacking } from "../components/ClipPreparationSelect"

const BASE = `/v1/admin/trends/${TREND_ID}`
const BOX = { fromFrame: 0, toFrame: 9, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 60 }
const MAIN: AdminTrendFaceMaskMark = { label: "main", ...BOX }
const ERASED: AdminTrendFaceMaskMark = { label: "erased", ...BOX }

const DEPTH_ENVS: TrendEngineEnvironment[] = ENVIRONMENTS.map((e) => ({
  ...e,
  supports: { castSwap: { ...e.supports.castSwap, sourceModes: ["faces", "full-depth", "keep-people"], faceMaskTargets: ["face", "head", "body"] } },
}))

const STORED: AdminTrendFaceMask = {
  url: "https://cdn.test/trends/a1/mask.mp4",
  frames: 360,
  recipe: { core: "2026-10-25", plugin: "1" },
  settingsKey: "v2:abc",
  jobId: "00000000-0000-4000-8000-0000000000f1",
  stats: { shots: 2, heldFrames: 7, coverage: 0.042, droppedRegions: 0 },
  approvedAt: "2026-10-25T10:00:00.000Z",
  approvedBy: "admin",
  rawMaskUrl: "https://cdn.test/trends/a1/raw.mp4",
  baseKey: "v2:base",
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

describe("the clip preparation's rules", () => {
  it("a depth mode always runs; Faces hidden from nothing stays nothing", () => {
    expect(withClipPreparation(undefined, "faces")).toEqual({ masking: undefined, removedMain: 0 })
    expect(withClipPreparation(undefined, "full-depth").masking).toEqual({ mode: "always", source: "full-depth" })
    expect(withClipPreparation({ mode: "auto", target: "face" }, "keep-people").masking).toEqual({ mode: "always", source: "keep-people", target: "face" })
  })

  it("leaving Keep people drops the whole-person target and the main character boxes, and counts them", () => {
    const from = { mode: "always" as const, source: "keep-people" as const, target: "body" as const, marks: [MAIN, ERASED, MAIN] }
    expect(withClipPreparation(from, "faces")).toEqual({ masking: { mode: "always", marks: [ERASED] }, removedMain: 2 })
    expect(withClipPreparation({ ...from, marks: [MAIN] }, "full-depth")).toEqual({ masking: { mode: "always", source: "full-depth" }, removedMain: 1 })
  })

  it("names what the server would refuse", () => {
    expect(clipPreparationIssues({ mode: "auto", source: "full-depth" })).toEqual(["Clip preparation: Full depth runs every time (mode Always)."])
    expect(clipPreparationIssues({ mode: "always", target: "body" })).toEqual(["Clip preparation: the whole person is covered in Keep people only."])
    expect(clipPreparationIssues({ mode: "always", marks: [MAIN] })[0]).toMatch(/1 box marks the main character, which only Keep people takes/)
    expect(clipPreparationIssues({ mode: "always", source: "keep-people", target: "body", marks: [MAIN] })).toEqual([])
  })

  it("cleanMasking saves the clip preparation (Faces hidden as no key)", () => {
    expect(cleanMasking({ mode: "always", source: "full-depth" })).toEqual({ mode: "always", source: "full-depth" })
    expect(cleanMasking({ mode: "always", source: "faces" })).toEqual({ mode: "always" })
  })

  it("a hidden field never holds Save: Full depth reads the mode only, Keep people has no blur", () => {
    expect(maskingIssues({ mode: "always", source: "full-depth", threshold: 9 })).toEqual([])
    expect(maskingIssues({ mode: "always", source: "keep-people", blurStrengthPct: 99 })).toEqual([])
    expect(maskingIssues({ mode: "always", blurStrengthPct: 99 })).not.toEqual([])
  })

  it("names the environments whose engine lacks the mode", () => {
    expect(environmentsLacking("full-depth", ENVIRONMENTS)).toEqual(["production"])
    expect(environmentsLacking("full-depth", DEPTH_ENVS)).toEqual([])
    expect(environmentsLacking("faces", ENVIRONMENTS)).toEqual([])
  })
})

describe("the main character mark", () => {
  it("is its own label, never a slot", () => {
    expect(labelValue("main")).toBe("main")
    expect(labelOf("main")).toBe("main")
    expect(labelValue({ slot: "kid" })).toBe("slot:kid")
    expect(labelOf("erased")).toBe("erased")
    expect(markFromDrag({ x: 10, y: 10 }, { x: 40, y: 40 }, 100, "main")?.label).toBe("main")
    expect(markWho("main", [])).toBe("Main character")
    expect(markWho("erased", [], true)).toBe("Left out")
    expect(markCounts([MAIN, MAIN, ERASED], [], true)).toEqual([
      { who: "Left out", count: 1 },
      { who: "Main character", count: 2 },
    ])
    // A main mark is no one's person mark.
    expect(unmarkedPeople([{ key: "kid", label: "Kid" }], [MAIN])).toEqual([{ key: "kid", label: "Kid" }])
  })
})

describe("the publish refusals", () => {
  it("read as sentences", () => {
    expect(describeBlocker({ code: "face_mask_source_unsupported", env: "production", need: "keep-people" })).toBe(
      "production: the clip preparation Keep people not supported yet. Choose Faces hidden, or wait for the engine (6. Face masking).",
    )
    expect(describeBlocker({ code: "prompt_parts_unsupported", env: "staging", need: "promptParts" })).toMatch(/^staging: engine prompt changes not supported yet/)
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "faceMaskTarget:body" })).toBe(
      "production: whole-person masks (Keep people) not supported yet",
    )
  })
})

describe("choosing the clip preparation", { timeout: 20_000 }, () => {
  beforeEach(() => {
    resetRoutes()
    vi.stubGlobal("fetch", fetchMock)
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: DEPTH_ENVS } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("Full depth shows only that it always runs, and saves { mode: always, source: full-depth }", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: { mode: "auto", threshold: 0.4 } }) } })
    renderEditor()
    const select = await screen.findByRole("combobox", { name: "Clip preparation" })
    expect(select).toHaveTextContent("Faces hidden")
    expect(screen.getByRole("combobox", { name: "Mode" })).toBeInTheDocument()
    await user.click(select)
    await user.click(screen.getByRole("option", { name: "Full depth" }))
    expect(screen.queryByRole("combobox", { name: "Mode" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Fill" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Covers" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Detection threshold")).not.toBeInTheDocument()
    expect(screen.getByText(/the clip is prepared once, approved and stored/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { faceMasking: unknown } }>
    // The threshold set for Faces hidden is kept (switching back finds it), and neither shown nor sent by the engine.
    expect(body!.data.faceMasking).toEqual({ mode: "always", source: "full-depth", threshold: 0.4 })
  })

  it("Keep people keeps the whole person by default, has no fill, and its boxes mark the main character", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true },
          { faceMasking: { mode: "always", source: "keep-people" }, faceMask: STORED },
        ),
      },
    })
    renderEditor()
    const keeps = await screen.findByRole("combobox", { name: "Keeps" })
    expect(keeps).toHaveTextContent("Whole person (default)")
    expect(screen.queryByRole("combobox", { name: "Fill" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Blur strength (%)")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Smallest person height (%)")).toBeInTheDocument()

    // The who picker is offered with no optional people: left out, or the main character.
    const who = await screen.findByRole("combobox", { name: "Who new boxes are for" })
    expect(within(who).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Left out (turned to depth with the rest)",
      "Main character (the only one kept as filmed)",
    ])
    fireEvent.change(who, { target: { value: "main" } })
    const surface = screen.getByTestId("face-mask-marks-surface")
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.pointerDown(surface, { clientX: 40, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(surface, { clientX: 120, clientY: 60, pointerId: 1 })
    const list = screen.getByRole("list", { name: "Marked people" })
    expect(within(list).getByText(/Box 1: frames 1–360 · Main character/)).toBeInTheDocument()
  })

  it("greys out the whole person while no engine keeps whole people", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: { mode: "always", source: "keep-people", target: "head" } }) } })
    renderEditor()
    expect(await screen.findByText(/No environment's Cast Swap engine keeps whole people yet/)).toBeInTheDocument()
    expect(screen.getByText(/Not supported yet by the Cast Swap engine of: production/)).toBeInTheDocument()
  })

  it("switching away from Keep people says the main character boxes were removed", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: { mode: "always", source: "keep-people", marks: [MAIN] } }) },
    })
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Clip preparation" }))
    await user.click(screen.getByRole("option", { name: "Faces hidden" }))
    expect(screen.getByText(/1 main character box was removed: only Keep people takes them/)).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Covers" })).toHaveTextContent("Head (default)")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { faceMasking: unknown } }>
    expect(body!.data.faceMasking).toEqual({ mode: "always" })
  })
})
