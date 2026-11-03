/**
 * The smallest face with mesh lines (`faceMasking.faceMeshMinFaceHeightPct`,
 * decided 2026-11-03): Full depth's face mesh draws no lines on a face whose
 * box is smaller than this % of the frame's height (0–100; left empty, the
 * engine's 10). In the shared FaceMaskingEditor: Admin → Nodaro Motion's
 * Motion column and a trend's editor (the Precise column is never Full depth).
 *
 * - The pure rules: saved only on Full depth with the face mesh on, and only
 *   when set (empty = the default, no key; 0 and 10 are values); leaving Full
 *   depth or turning the mesh off drops it; Save is held outside 0–100; the
 *   environments that lack it, by their engine and by their platform.
 * - The platform hold: staging and production share one database, so a value
 *   waits until every environment's PLATFORM (the app itself, recorded as
 *   `supports.platform`) takes it, not only its engine: an older platform
 *   refuses a setting or a trend that carries it.
 * - The editor: under the face mesh switch while it is on, on Full depth only,
 *   where the page passes what is missing; greyed out naming the environments
 *   (the engine's and the platform's apart); one already set stays, to be
 *   emptied.
 * - Both pages show it: a trend's editor and the Motion column.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, TrendEngineEnvironment } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import {
  environmentsThatCannotDrawFaceMeshMinFaceHeight,
  environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight,
  faceMeshMinFaceHeightMissing,
  withClipPreparation,
} from "../clip-preparation"
import { cleanMasking, maskingIssues } from "../model"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"
import AdminTrendEditorPage from "../detail/page"
import AdminNodaroMotionPage from "../../nodaro-motion/page"

/**
 * An environment's row: its engine draws the face mesh (and `extra`), and its platform records that it takes the
 * smallest face, unless `platform` is false (an app from before the record).
 */
const at = (env: string, extra: Record<string, unknown> = {}, platform = true): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: {
    castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, sourceModes: ["faces", "full-depth", "keep-people"], faceMesh: true, ...extra },
    ...(platform ? { platform: { faceMeshMinFaceHeightPct: true } } : {}),
  },
})
const NEW = { faceMeshMinFaceHeightPct: true }
const ALL_NEW = [at("production", NEW), at("staging", NEW)]
const FD: AdminTrendFaceMasking = { mode: "always", source: "full-depth" }
const FDM: AdminTrendFaceMasking = { ...FD, faceMesh: true }
const LABEL = "Smallest face with mesh lines"
const HINT = "% of the frame's height; faces smaller than this, or centred in the outer 10 % at the left and right, get no lines; 0 = no size minimum (the side margins still apply)"
const NONE = { engine: [], platform: [] } as const

describe("the rules", () => {
  it("saved on Full depth with the face mesh on, when set (0 and 10 are values); empty, the mesh off or another preparation saves no key", () => {
    for (const v of [0, 10, 20, 100]) {
      expect(cleanMasking({ ...FDM, faceMeshMinFaceHeightPct: v }), String(v)).toEqual({ ...FDM, faceMeshMinFaceHeightPct: v })
    }
    expect(cleanMasking(FDM)).toEqual(FDM)
    expect(cleanMasking({ ...FD, faceMeshMinFaceHeightPct: 20 })).toEqual(FD)
    expect(cleanMasking({ mode: "always", faceMesh: true, faceMeshMinFaceHeightPct: 20 })).toEqual({ mode: "always", faceMesh: true })
    expect(cleanMasking({ mode: "always", source: "keep-people", faceMeshMinFaceHeightPct: 20 })).toEqual({ mode: "always", source: "keep-people" })
  })

  it("Save is held on a value the server would refuse (outside 0–100)", () => {
    for (const v of [0, 10.5, 100]) expect(maskingIssues({ ...FDM, faceMeshMinFaceHeightPct: v }), String(v)).toEqual([])
    for (const v of [-1, 101, 150]) {
      expect(maskingIssues({ ...FDM, faceMeshMinFaceHeightPct: v }), String(v)).toEqual(["Clip preparation: the smallest face with mesh lines is 0–100 %."])
    }
  })

  it("leaving Full depth drops it", () => {
    expect(withClipPreparation({ ...FDM, faceMeshMinFaceHeightPct: 20 }, "faces").masking).toEqual({ mode: "always", faceMesh: true })
    expect(withClipPreparation({ ...FDM, faceMeshMinFaceHeightPct: 20 }, "keep-people").masking).toEqual({ mode: "always", source: "keep-people" })
    expect(withClipPreparation({ ...FDM, faceMeshMinFaceHeightPct: 20 }, "full-depth").masking).toEqual({ ...FDM, faceMeshMinFaceHeightPct: 20 })
  })

  it("the environments whose engine lacks it (a Cast Swap engine before 0.436.1, or none recorded); unknown while the environments are", () => {
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight(undefined)).toBeUndefined()
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight(ALL_NEW)).toEqual([])
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight([at("production", NEW), at("staging")])).toEqual(["staging"])
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight([at("production", NEW)])).toEqual(["staging"])
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight([])).toEqual(["staging", "production"])
  })

  it("the environments whose platform does not take it yet (an app from before it records no `platform`), apart from the engines", () => {
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight(undefined)).toBeUndefined()
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight(ALL_NEW)).toEqual([])
    // Its engine declares the field (plugin 0.436.1), its platform is older: the platform decides.
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([at("production", NEW, false), at("staging", NEW)])).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([at("staging", NEW)])).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([])).toEqual(["staging", "production"])
    expect(faceMeshMinFaceHeightMissing(undefined)).toBeUndefined()
    expect(faceMeshMinFaceHeightMissing(ALL_NEW)).toEqual(NONE)
    expect(faceMeshMinFaceHeightMissing([at("production", NEW, false), at("staging")])).toEqual({ engine: ["staging"], platform: ["production"] })
  })
})

function Harness({ initial, source, missing, trend, onValue }: {
  initial: AdminTrendFaceMasking | undefined
  source?: AdminTrendFaceMaskingSource
  missing?: { readonly engine: readonly string[]; readonly platform: readonly string[] }
  trend?: boolean
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceMaskingEditor
      value={value}
      source={source}
      faceMeshMissingIn={[]}
      faceMeshMinFaceHeightMissing={missing}
      offerRoleOutlines={trend}
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const field = () => screen.queryByRole("spinbutton", { name: LABEL })

describe("the control", () => {
  it("under the face mesh switch while it is on, on Full depth, where the page offers it; default shown, 0–100 in steps of 1", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness initial={FD} source="full-depth" missing={NONE} />)
    expect(field()).not.toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "Face mesh" }))
    expect(field()).toBeEnabled()
    expect(field()).toHaveValue(null)
    expect(field()).toHaveAttribute("placeholder", "10")
    expect(field()).toHaveAttribute("min", "0")
    expect(field()).toHaveAttribute("max", "100")
    expect(field()).toHaveAttribute("step", "1")
    expect(field()).toHaveAccessibleDescription(HINT)
    unmount()
    // Faces hidden's mesh (the masked heads) takes none; a page that passes nothing (the Precise column) offers none.
    const faces = render(<Harness initial={{ mode: "always", faceMesh: true }} missing={NONE} />)
    expect(field()).not.toBeInTheDocument()
    faces.unmount()
    render(<Harness initial={FDM} source="full-depth" />)
    expect(field()).not.toBeInTheDocument()
  })

  it("a number writes it (0 and 10 included); empty removes the key (the default); the mesh turned off removes it", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={FDM} source="full-depth" missing={NONE} onValue={(m) => seen.push(m)} />)
    await user.type(field()!, "20")
    expect(seen.at(-1)).toEqual({ ...FDM, faceMeshMinFaceHeightPct: 20 })
    await user.clear(field()!)
    expect(seen.at(-1)).toEqual(FDM)
    await user.type(field()!, "0")
    expect(seen.at(-1)).toEqual({ ...FDM, faceMeshMinFaceHeightPct: 0 })
    await user.clear(field()!)
    await user.type(field()!, "10")
    expect(seen.at(-1)).toEqual({ ...FDM, faceMeshMinFaceHeightPct: 10 })
    await user.click(screen.getByRole("checkbox", { name: "Face mesh" }))
    expect(seen.at(-1)).toEqual(FD)
    expect(field()).not.toBeInTheDocument()
  })

  it("greyed out while an environment's engine lacks it, naming it; one already set stays, to be emptied", () => {
    const { unmount } = render(<Harness initial={FDM} source="full-depth" missing={{ engine: ["staging"], platform: [] }} />)
    expect(field()).toBeDisabled()
    expect(
      screen.getByText("The Cast Swap engine of staging cannot set the smallest face with mesh lines yet, and this setting is shared by every environment."),
    ).toBeInTheDocument()
    unmount()
    render(<Harness initial={{ ...FDM, faceMeshMinFaceHeightPct: 20 }} source="full-depth" missing={{ engine: ["staging", "production"], platform: [] }} />)
    expect(field()).toBeEnabled()
    expect(field()).toHaveValue(20)
    expect(
      screen.getByText("The Cast Swap engine of staging, production cannot set the smallest face with mesh lines yet, and this setting is shared by every environment: empty it to save."),
    ).toBeInTheDocument()
  })

  it("in a trend's editor: greyed out the same way, worded for the trend's own face mask", () => {
    const { unmount } = render(<Harness initial={FDM} source="full-depth" missing={{ engine: ["production"], platform: [] }} trend />)
    expect(field()).toBeDisabled()
    expect(field()).toHaveAccessibleDescription(`${HINT}. Make the face mask again after a change.`)
    expect(screen.getByText("The Cast Swap engine of production cannot set the smallest face with mesh lines yet.")).toBeInTheDocument()
    unmount()
    render(<Harness initial={{ ...FDM, faceMeshMinFaceHeightPct: 20 }} source="full-depth" missing={{ engine: ["production"], platform: [] }} trend />)
    expect(field()).toBeEnabled()
    expect(
      screen.getByText("The Cast Swap engine of production cannot set the smallest face with mesh lines yet: a face mask made there is refused while it is set."),
    ).toBeInTheDocument()
  })

  it("greyed out while one environment's platform does not take it, naming it apart from the engines; one already set stays, to be emptied", () => {
    const old = { engine: [], platform: ["production"] }
    const { unmount } = render(<Harness initial={FDM} source="full-depth" missing={old} />)
    expect(field()).toBeDisabled()
    expect(
      screen.getByText("The platform in production does not take the smallest face with mesh lines yet, and this setting is shared by every environment."),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Cast Swap engine of/)).not.toBeInTheDocument()
    unmount()
    const set = render(<Harness initial={{ ...FDM, faceMeshMinFaceHeightPct: 20 }} source="full-depth" missing={old} />)
    expect(field()).toBeEnabled()
    expect(
      screen.getByText("The platform in production does not take the smallest face with mesh lines yet, and this setting is shared by every environment: empty it to save."),
    ).toBeInTheDocument()
    set.unmount()
    // A trend's editor: trends are in the same shared database (their saves and publishes are held too).
    const trend = render(<Harness initial={FDM} source="full-depth" missing={old} trend />)
    expect(field()).toBeDisabled()
    expect(screen.getByText("The platform in production does not take the smallest face with mesh lines yet, and trends are shared by every environment.")).toBeInTheDocument()
    trend.unmount()
    // Both an engine and a platform missing: each said apart.
    render(<Harness initial={FDM} source="full-depth" missing={{ engine: ["staging"], platform: ["production"] }} />)
    expect(field()).toBeDisabled()
    expect(screen.getByText(/^The Cast Swap engine of staging cannot set/)).toBeInTheDocument()
    expect(screen.getByText(/^The platform in production does not take/)).toBeInTheDocument()
  })

  it("enabled once every environment's platform (and engine) takes it", () => {
    render(<Harness initial={FDM} source="full-depth" missing={NONE} />)
    expect(field()).toBeEnabled()
    expect(screen.queryByText(/^The platform in/)).not.toBeInTheDocument()
    expect(screen.queryByText(/smallest face with mesh lines yet/)).not.toBeInTheDocument()
  })
})

describe("both pages show it", { timeout: 20_000 }, () => {
  beforeEach(() => {
    resetRoutes()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const BASE = `/v1/admin/trends/${TREND_ID}`
  const renderTrend = () => renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")

  it("a trend's editor: a Full depth trend with the face mesh offers it and saves it; greyed out, naming the environments, while one lacks it", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: FDM }) } })
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ALL_NEW } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const { unmount } = renderTrend()
    const input = await screen.findByRole("spinbutton", { name: LABEL })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, "18")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { faceMasking: unknown } }>
    expect(body!.data.faceMasking).toEqual({ ...FDM, faceMeshMinFaceHeightPct: 18 })
    unmount()

    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [at("production"), at("staging", NEW)] } })
    const engineGap = renderTrend()
    const greyed = await screen.findByRole("spinbutton", { name: LABEL })
    await waitFor(() => expect(greyed).toBeDisabled())
    expect(screen.getByText("The Cast Swap engine of production cannot set the smallest face with mesh lines yet.")).toBeInTheDocument()
    engineGap.unmount()

    // Production's engine declares it, its platform is older: greyed out, naming production's platform.
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [at("production", NEW, false), at("staging", NEW)] } })
    renderTrend()
    const held = await screen.findByRole("spinbutton", { name: LABEL })
    await waitFor(() => expect(held).toBeDisabled())
    expect(screen.getByText("The platform in production does not take the smallest face with mesh lines yet, and trends are shared by every environment.")).toBeInTheDocument()
  })

  it("Admin → Nodaro Motion's Motion column: Full depth with the face mesh offers it and saves it; the Precise column never does; greyed out while a platform does not take it", async () => {
    const user = userEvent.setup()
    const ENGINES = [
      { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
      { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
    ]
    const MOTION_URL = "/v1/admin/nodaro-motion/motion"
    routes["GET /v1/admin/nodaro-motion/masking"] = () => ({ body: { data: { masking: { "motion-prism": { mode: "always", faceMesh: true } }, updatedAt: null, engines: ENGINES } } })
    routes["GET /v1/admin/nodaro-motion/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
    routes["GET /v1/admin/nodaro-motion/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
    routes["GET /v1/admin/nodaro-motion/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
    routes["POST /v1/admin/nodaro-motion/prompt-parts/preview"] = () => ({
      body: { data: { set: "precise", parts: [], assembled: "edit {video:1} as follows:", length: 26, max: 8000, problems: [] } },
    })
    routes[`GET ${MOTION_URL}`] = () => ({
      body: { data: { motion: { "motion-prism": { masking: FDM } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    routes[`PUT ${MOTION_URL}`] = (init) => ({
      body: { data: { motion: JSON.parse(String(init?.body)).motion, updatedAt: "2026-11-03T12:00:00.000Z", engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
    routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
    routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ALL_NEW } })
    const prismOf = async () => (await screen.findByRole("heading", { name: /^Nodaro Motion Prism/ })).closest("section") as HTMLElement
    const { unmount } = renderWith(<AdminNodaroMotionPage />)
    const prism = await prismOf()
    const motion = await within(prism).findByRole("group", { name: /Prism Motion$/ })
    const input = await within(motion).findByRole("spinbutton", { name: LABEL })
    expect(input).toBeEnabled()
    // The Precise column's Faces hidden face mesh takes none.
    expect(within(within(prism).getByRole("group", { name: /Prism Precise$/ })).queryByRole("spinbutton", { name: LABEL })).toBeNull()
    await user.type(input, "15")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${MOTION_URL}`)).toEqual([{ motion: { "motion-prism": { masking: { ...FDM, faceMeshMinFaceHeightPct: 15 } } } }]))
    unmount()

    // Staging's platform is older (its engine declares the field): greyed out, naming it.
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [at("production", NEW), at("staging", NEW, false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const again = await within(await within(await prismOf()).findByRole("group", { name: /Prism Motion$/ })).findByRole("spinbutton", { name: LABEL })
    await waitFor(() => expect(again).toBeDisabled())
    expect(
      within(await prismOf()).getByText("The platform in staging does not take the smallest face with mesh lines yet, and this setting is shared by every environment."),
    ).toBeInTheDocument()
  })
})
