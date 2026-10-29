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
import { clipPreparationIssues, environmentsThatCannotHideBodies, supportedTargetsFor, withClipPreparation } from "../clip-preparation"
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

/** Engines that also hide whole people with Faces hidden (`faceMaskHideTargets`). */
const HIDE_ENVS: TrendEngineEnvironment[] = DEPTH_ENVS.map((e) => ({
  ...e,
  supports: { castSwap: { ...e.supports.castSwap, faceMaskHideTargets: ["face", "head", "body"] } },
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

  it("Faces hidden keeps its whole person (Body); Full depth drops it", () => {
    const hide = { mode: "always" as const, target: "body" as const, fill: "depth" as const }
    expect(withClipPreparation(hide, "faces").masking).toEqual(hide)
    expect(withClipPreparation({ ...hide, source: "faces" }, "faces").masking).toEqual(hide)
    expect(withClipPreparation(hide, "full-depth").masking).toEqual({ mode: "always", source: "full-depth", fill: "depth" })
  })

  it("the targets some engine masks: Faces hidden reads faceMaskHideTargets, Keep people faceMaskTargets", () => {
    expect(supportedTargetsFor(undefined, "faces")).toBeUndefined()
    expect(supportedTargetsFor(ENVIRONMENTS, "faces")).toEqual(["head"])
    // An engine that keeps whole people (Keep people) but cannot hide them.
    expect(supportedTargetsFor(DEPTH_ENVS, "faces")).toEqual(["face", "head"])
    expect(supportedTargetsFor(DEPTH_ENVS, "keep-people")).toEqual(["face", "head", "body"])
    expect(supportedTargetsFor(HIDE_ENVS, "faces")).toEqual(["face", "head", "body"])
    expect(supportedTargetsFor([...ENVIRONMENTS, ...HIDE_ENVS], "faces")).toEqual(["head", "face", "body"])
  })

  it("Nodaro Motion's shared setting: the environments that cannot hide whole people, a missing one included", () => {
    const at = (env: string, list: TrendEngineEnvironment[]) => list.map((e) => ({ ...e, env }))
    expect(environmentsThatCannotHideBodies(undefined)).toBeUndefined()
    expect(environmentsThatCannotHideBodies([])).toEqual(["staging", "production"])
    expect(environmentsThatCannotHideBodies([...at("production", HIDE_ENVS)])).toEqual(["staging"])
    expect(environmentsThatCannotHideBodies([...at("production", HIDE_ENVS), ...at("staging", DEPTH_ENVS)])).toEqual(["staging"])
    expect(environmentsThatCannotHideBodies([...at("production", HIDE_ENVS), ...at("staging", HIDE_ENVS)])).toEqual([])
  })

  it("names what the server would refuse", () => {
    expect(clipPreparationIssues({ mode: "auto", source: "full-depth" })).toEqual(["Clip preparation: Full depth runs every time (mode Always)."])
    expect(clipPreparationIssues({ mode: "always", target: "body" })).toEqual([])
    expect(clipPreparationIssues({ mode: "always", source: "faces", target: "body" })).toEqual([])
    expect(clipPreparationIssues({ mode: "always", source: "full-depth", target: "body" })).toEqual(["Clip preparation: Full depth masks no one, so it has no whole-person target."])
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
    expect(describeBlocker({ code: "engine_unsupported", env: "staging", need: "faceMaskHideTarget:body" })).toBe(
      "staging: whole-person hiding (Faces hidden) not supported yet",
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

  it("Faces hidden offers Body greyed out while no engine hides whole people (one that only keeps them included)", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: { mode: "always" } }) } })
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Covers" }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Head (default)", "Face", "Body (not supported yet)"])
    expect(screen.getByRole("option", { name: "Body (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Face" })).not.toHaveAttribute("aria-disabled")
  })

  it("Faces hidden hides the whole person with Body once an engine can, and saves target body with its fill", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: HIDE_ENVS } })
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: { mode: "always", fill: "depth" } }) } })
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Covers" }))
    await user.click(screen.getByRole("option", { name: "Body" }))
    const covers = screen.getByRole("combobox", { name: "Covers" })
    expect(covers).toHaveTextContent("Body")
    expect(screen.getByText(/everyone in the clip is hidden, body and head/)).toBeInTheDocument()
    expect(screen.queryByText(/hides whole people yet/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { faceMasking: unknown } }>
    expect(body!.data.faceMasking).toEqual({ mode: "always", fill: "depth", target: "body" })
  })

  it("Trends offers Body once SOME environment's engine hides whole people (the publish check holds the rest)", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({
      body: { data: [...DEPTH_ENVS, ...HIDE_ENVS.map((e) => ({ ...e, env: "staging" }))] },
    })
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: { mode: "always" } }) } })
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Covers" }))
    expect(screen.getByRole("option", { name: "Body" })).not.toHaveAttribute("aria-disabled")
  })

  it("a saved Body on engines that cannot hide whole people says so", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: { mode: "always", target: "body" } }) } })
    renderEditor()
    expect(await screen.findByText(/No environment's Cast Swap engine hides whole people yet/)).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Covers" })).toHaveTextContent("Body")
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
