/**
 * Admin → Trends → one trend → 6. Face masking → Role outlines (decided
 * 2026-11-01): a coloured outline around each masked person role.
 *
 * - The switch: a trend's, Faces hidden only, offered once some environment's
 *   engine draws them; on is `roleOutlines: true`, off no key; a depth
 *   preparation drops it.
 * - While the SAVED draft has them on, every person (required too) is a box's
 *   choice; each person's boxes are in their role colour, fixed per role (the
 *   shared palette by slot order, never by their place in the list).
 * - A required person's marks hold Save only while outlines are off.
 * - The masks say how many regions each role's ring went round; the boxes'
 *   hint says a whole-person mask needs the box over the person's middle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { ROLE_OUTLINE_PALETTE } from "@nodaro/render-rules"
import type { AdminTrendFaceMask, AdminTrendFaceMaskMark, AdminTrendFaceMasking, TrendEngineEnvironment } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, slot, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { clipPreparationIssues, someEngineDrawsRoleOutlines, withClipPreparation } from "../clip-preparation"
import { cleanMasking, describeBlocker, personMarkIssues } from "../model"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"
import { markChoices, markStyle } from "../components/FaceMaskMarks"
import { unmarkedPeople } from "../components/FaceMaskPanel"

const BASE = `/v1/admin/trends/${TREND_ID}`
const box = { fromFrame: 0, toFrame: 359, leftPct: 10, topPct: 10, rightPct: 30, bottomPct: 50 }
const LEAD_MARK: AdminTrendFaceMaskMark = { label: { slot: "dancer" }, ...box }
// The required dancer first, then a location, then two optional people.
const SLOTS = [
  slot(),
  slot({ key: "place", kind: "location", label: { en: "Place" }, required: false }),
  slot({ key: "amy", label: { en: "Amy" }, required: false }),
  slot({ key: "ben", label: { en: "Ben" }, required: false }),
]

const outlinesAt = (env: string, roleOutlines?: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap!, ...(roleOutlines === undefined ? {} : { roleOutlines }) } },
})
const OUTLINE_ENVS = [outlinesAt("production", true), outlinesAt("staging", true)]
const OLD_ENVS = [outlinesAt("production"), outlinesAt("staging", false)]

const STORED: AdminTrendFaceMask = {
  url: "https://cdn.test/trends/a1/mask.mp4",
  frames: 360,
  recipe: { core: "2026-10-25", plugin: "1" },
  settingsKey: "v2:abc",
  jobId: "fm-1",
  stats: { shots: 2, heldFrames: 7, coverage: 0.042, droppedRegions: 0 },
  approvedAt: "2026-11-01T10:00:00.000Z",
  approvedBy: "admin",
  rawMaskUrl: "https://cdn.test/trends/a1/raw.mp4",
  baseKey: "v2:base",
}

describe("the helpers", () => {
  it("a trend offers outlines once some environment's engine draws them", () => {
    expect(someEngineDrawsRoleOutlines(undefined)).toBe(false)
    expect(someEngineDrawsRoleOutlines(OLD_ENVS)).toBe(false)
    expect(someEngineDrawsRoleOutlines([outlinesAt("production"), outlinesAt("staging", true)])).toBe(true)
  })

  it("saves them only on (no key off), Faces hidden only; a depth preparation drops them and holds Save until it does", () => {
    expect(cleanMasking({ mode: "always", roleOutlines: true })).toEqual({ mode: "always", roleOutlines: true })
    expect(Object.hasOwn(cleanMasking({ mode: "always", roleOutlines: false }), "roleOutlines")).toBe(false)
    expect(Object.hasOwn(cleanMasking({ mode: "always", source: "keep-people", roleOutlines: true }), "roleOutlines")).toBe(false)
    expect(withClipPreparation({ mode: "always", roleOutlines: true }, "full-depth").masking).not.toHaveProperty("roleOutlines")
    expect(withClipPreparation({ mode: "always", roleOutlines: true }, "faces").masking).toMatchObject({ roleOutlines: true })
    expect(clipPreparationIssues({ mode: "always", source: "keep-people", roleOutlines: true })[0]).toMatch(/role outlines .*need Faces hidden/)
  })

  it("a required person's marks hold Save only while outlines are off", () => {
    const form = { slots: SLOTS.map((s) => ({ ...s, uid: s.key, isNew: false })), faceMasking: { mode: "always" as const, marks: [LEAD_MARK] } }
    expect(personMarkIssues(form)[0]).toMatch(/"Dancer" is required, but has face marks.*turn Role outlines on/)
    expect(personMarkIssues({ ...form, faceMasking: { ...form.faceMasking, roleOutlines: true } })).toEqual([])
    // Leaving Faces hidden drops the outlines: the way out is then only removing the marks.
    const kept = { ...form, faceMasking: withClipPreparation({ ...form.faceMasking, roleOutlines: true }, "keep-people").masking! }
    expect(personMarkIssues(kept)[0]).toMatch(/Remove that person's face marks first/)
  })

  it("a person's box colour is their role colour, whatever their place in the list", () => {
    const people = [
      { key: "amy", label: "Amy", colour: ROLE_OUTLINE_PALETTE[1].hex },
      { key: "dancer", label: "Dancer", colour: ROLE_OUTLINE_PALETTE[0].hex, required: true, outlined: true },
    ]
    expect(markStyle({ slot: "dancer" }, people)).toEqual({ borderColor: "#FF00FF" })
    expect(markStyle({ slot: "amy" }, people)).toEqual({ borderColor: "#FFE600" })
    expect(markStyle("erased", people)).toBeUndefined()
    expect(markStyle({ slot: "gone" }, people)?.borderColor).toMatch(/^#/)
    expect(markChoices(people, false).map((c) => c.label)).toEqual(["Everyone (unmasked on every run)", "Amy (unmasked when left empty)", "Dancer (their role outline)"])
    // A required person is never "left empty": never in the unmarked people's hint.
    expect(unmarkedPeople(people, []).map((p) => p.key)).toEqual(["amy"])
  })

  it("its publish need reads as a sentence", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "roleOutlines" })).toMatch(/production.*role outlines/)
  })
})

function Harness({ initial, envs, onValue, offer = true }: {
  initial: AdminTrendFaceMasking | undefined
  envs?: TrendEngineEnvironment[]
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
  offer?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceMaskingEditor
      value={value}
      envs={envs}
      offerRoleOutlines={offer}
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const outlinesBox = () => screen.queryByRole("checkbox", { name: "Role outlines" })

describe("the switch", () => {
  it("ticked writes roleOutlines: true; unticked removes the key", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always" }} envs={OUTLINE_ENVS} onValue={(m) => seen.push(m)} />)
    expect(outlinesBox()).toBeEnabled()
    await user.click(outlinesBox()!)
    expect(seen.at(-1)).toEqual({ mode: "always", roleOutlines: true })
    await user.click(outlinesBox()!)
    expect(Object.hasOwn(seen.at(-1)!, "roleOutlines")).toBe(false)
  })

  it("is not shown off, without an engine that draws them, or on Admin → Nodaro Motion; one already on stays shown", () => {
    for (const props of [
      { initial: { mode: "off" as const }, envs: OUTLINE_ENVS },
      { initial: { mode: "always" as const }, envs: OLD_ENVS },
      { initial: { mode: "always" as const }, envs: OUTLINE_ENVS, offer: false },
    ]) {
      const { unmount } = render(<Harness {...props} />)
      expect(outlinesBox(), JSON.stringify(props.initial)).not.toBeInTheDocument()
      unmount()
    }
    render(<Harness initial={{ mode: "always", roleOutlines: true }} envs={OLD_ENVS} />)
    expect(outlinesBox()).toBeChecked()
    expect(screen.getByText(/No environment's Cast Swap engine draws role outlines yet/)).toBeInTheDocument()
  })
})

describe("the marks with role outlines on", { timeout: 20_000 }, () => {
  beforeEach(() => {
    resetRoutes()
    vi.stubGlobal("fetch", fetchMock)
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: OUTLINE_ENVS } })
  })
  afterEach(() => vi.unstubAllGlobals())
  const renderEditor = () => renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")

  it("every person is a box's choice, the required one too, each box in its role colour; the counts per role show", async () => {
    const outlines = [{ slot: "dancer", colour: "#FF00FF", regionsDrawn: 310 }, { slot: "amy", colour: "#FFE600", regionsDrawn: 0 }]
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true },
          { slots: SLOTS, faceMasking: { mode: "always", target: "body", roleOutlines: true, marks: [LEAD_MARK] }, faceMask: { ...STORED, outlines } },
        ),
      },
    })
    renderEditor()
    expect(await screen.findByLabelText("The approved face mask")).toBeInTheDocument()
    const who = screen.getByRole("combobox", { name: /who new boxes are for/i })
    expect(within(who).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Everyone (unmasked on every run)",
      "Dancer (their role outline)",
      "Amy (role outline; unmasked when left empty)",
      "Ben (role outline; unmasked when left empty)",
    ])
    // The dancer's box: magenta, the first person slot's colour (the location in between takes none).
    expect(screen.getByTestId("face-mask-mark-box")).toHaveStyle({ borderColor: "#FF00FF" })
    expect(screen.getByTestId("face-mask-outline-hint")).toHaveTextContent(/must cover the person's middle/)
    const counts = screen.getByTestId("face-mask-outlines-approved")
    expect(counts).toHaveTextContent("Dancer: 310 regions")
    expect(counts).toHaveTextContent("Amy: no region outlined")
  })

  it("off, the required person is not offered and no outline counts show", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "approved", reasons: [] }, faceMaskMarksSupported: true },
          { slots: SLOTS, faceMasking: { mode: "always" }, faceMask: STORED },
        ),
      },
    })
    renderEditor()
    expect(await screen.findByLabelText("The approved face mask")).toBeInTheDocument()
    const who = screen.getByRole("combobox", { name: /who new boxes are for/i })
    expect(within(who).getAllByRole("option").map((o) => o.textContent)).not.toContain("Dancer (their role outline)")
    expect(screen.queryByTestId("face-mask-outlines-approved")).toBeNull()
    expect(screen.queryByTestId("face-mask-outline-hint")).toBeNull()
  })
})
