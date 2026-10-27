/**
 * Admin → Nodaro Motion: the face masking per engine (Prism, Pulse) for every
 * run people start themselves. Off until saved; each engine edited with the
 * trend editor's controls; Save sends the whole setting, keyed by the public
 * engine ids, and is held while a value is out of range.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { motionEngineGaps, motionIssues, motionToSaved, toSaved } from "../model"

const URL = "/v1/admin/nodaro-motion/masking"
const PROMPT_URL = "/v1/admin/nodaro-motion/prompt-parts"
const MOTION_URL = "/v1/admin/nodaro-motion/motion"
const ANSWER = {
  set: "precise",
  parts: [{ id: "face", default: "Keep the faces.", defaultHash: "0123456789abcdef", placeholders: [], required: [], applies: true }],
  assembled: "edit {video:1} as follows:\nKeep the faces.",
  length: 41,
  max: 8000,
  problems: [],
}
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${URL}`] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes[`GET ${PROMPT_URL}`] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes[`POST ${PROMPT_URL}/preview`] = () => ({ body: { data: ANSWER } })
  routes[`GET ${MOTION_URL}`] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
})
afterEach(() => vi.unstubAllGlobals())

const section = async (name: RegExp) =>
  (await screen.findByRole("heading", { name: new RegExp(`^Nodaro Motion ${name.source}`) })).closest("section") as HTMLElement

describe("Admin → Nodaro Motion", () => {
  it("shows both engines by name, with the model each runs on, Off until saved", async () => {
    renderWith(<AdminNodaroMotionPage />)
    expect(await screen.findByRole("heading", { name: "Nodaro Motion Prism (Seedance 2.5)" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Nodaro Motion Pulse (Kling 4)" })).toBeInTheDocument()
    expect(screen.getByText(/never saved: no engine masks faces/i)).toBeInTheDocument()
    for (const name of [/Prism/, /Pulse/]) {
      expect(within(await section(name)).getByRole("combobox", { name: "Mode" })).toHaveTextContent("Off")
    }
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("saves one engine's setting, keyed by its public id, the others left out", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-10-25T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const lite = await section(/Pulse/)
    await user.click(within(lite).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Auto" }))
    await user.click(within(lite).getByRole("combobox", { name: "Covers" }))
    await user.click(screen.getByRole("option", { name: "Face" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-pulse": { mode: "auto", target: "face" } } }]))
    expect(await screen.findByText(/^Saved /)).toBeInTheDocument()
  })

  it("starts from what is stored, and holds Save while a value is out of range", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL}`] = () => ({
      body: { data: { masking: { "motion-prism": { mode: "always", threshold: 0.4 } }, updatedAt: "2026-10-25T10:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const pro = await section(/Prism/)
    expect(within(pro).getByRole("combobox", { name: "Mode" })).toHaveTextContent("Always")
    const threshold = within(pro).getByLabelText("Detection threshold")
    expect(threshold).toHaveValue(0.4)
    await user.clear(threshold)
    await user.type(threshold, "2")
    expect(screen.getByText(/Nodaro Motion Prism: Face masking: the detection threshold/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})

describe("toSaved", () => {
  it("cleans each engine's setting and leaves out an engine with none", () => {
    expect(toSaved({ "motion-prism": { mode: "auto", zone: {}, fill: undefined }, "motion-pulse": undefined })).toEqual({ "motion-prism": { mode: "auto" } })
    expect(toSaved({})).toEqual({})
  })
})

describe("Admin → Nodaro Motion → Motion column", () => {
  const motionOf = async (name: RegExp) => within(await section(name)).findByRole("group", { name: new RegExp(`${name.source} Motion$`) })

  it("reads Same as Precise, Flexible prompt until it is set", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Prism/)
    expect(within(motion).getByText("Same as Precise, Flexible prompt.")).toBeInTheDocument()
    expect(within(motion).getByRole("combobox", { name: "Motion masking" })).toHaveTextContent("Same as Precise")
    expect(within(motion).getByRole("combobox", { name: "Motion prompt style" })).toHaveTextContent("Flexible (default)")
  })

  it("saves Full depth with its scene, and the prompt style, under the Motion setting only", async () => {
    const user = userEvent.setup()
    routes[`PUT ${MOTION_URL}`] = (init) => ({
      body: { data: { motion: JSON.parse(String(init?.body)).motion, updatedAt: "2026-10-27T12:00:00.000Z", engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Pulse/)
    await user.click(within(motion).getByRole("combobox", { name: "Motion masking" }))
    await user.click(screen.getByRole("option", { name: "Full depth" }))
    await user.click(within(motion).getByRole("combobox", { name: "Scene from" }))
    await user.click(screen.getByRole("option", { name: "None (write it yourself)" }))
    await user.click(within(motion).getByRole("combobox", { name: "Motion prompt style" }))
    await user.click(screen.getByRole("option", { name: "Precise" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sentTo(`PUT ${MOTION_URL}`)).toEqual([
        { motion: { "motion-pulse": { masking: { mode: "always", source: "full-depth", scene: "none" }, promptStyle: "precise" } } },
      ]),
    )
    expect(sentTo(`PUT ${URL}`)).toEqual([])
  })

  it("starts from the stored setting", async () => {
    routes[`GET ${MOTION_URL}`] = () => ({
      body: { data: { motion: { "motion-prism": { masking: { mode: "auto", target: "face" } } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Prism/)
    await waitFor(() => expect(within(motion).getByRole("combobox", { name: "Motion masking" })).toHaveTextContent("Faces hidden"))
    expect(within(motion).getByRole("combobox", { name: "Covers" })).toHaveTextContent("Face")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("says under the Motion column when this environment's engine plugin is out of date for it", async () => {
    routes[`GET ${MOTION_URL}`] = () => ({
      body: {
        data: {
          motion: { "motion-prism": { masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" } },
          updatedAt: null,
          engines: ENGINES,
          promptStyles: ["precise", "flexible"],
          supports: { styles: ["precise", "motion"], sourceModes: ["faces", "full-depth"] },
        },
      },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await motionOf(/Prism/)
    expect(await within(prism).findByText(/engine plugin is out of date: it cannot run the scene "Description \(automatic\)", the Precise prompt style yet/)).toBeInTheDocument()
    // Pulse's Motion is left to its defaults, which this engine runs.
    expect(within(await motionOf(/Pulse/)).queryByText(/out of date/)).not.toBeInTheDocument()
  })
})

describe("motionEngineGaps", () => {
  const ALL = { styles: ["precise", "motion"], sourceModes: ["faces", "full-depth"], promptStyles: ["precise", "flexible"], fullDepthScenes: ["description", "original", "none"] } as const
  const all = { styles: [...ALL.styles], sourceModes: [...ALL.sourceModes], promptStyles: [...ALL.promptStyles], fullDepthScenes: [...ALL.fullDepthScenes] }
  it("names what the engine lacks of the setting, and nothing while the supports are unknown", () => {
    const full = { masking: { mode: "always" as const, source: "full-depth" as const, scene: "none" as const }, promptStyle: "precise" as const }
    expect(motionEngineGaps(full, all)).toEqual([])
    expect(motionEngineGaps(full, undefined)).toEqual([])
    expect(motionEngineGaps(full, {})).toEqual(["the Motion style", "Full depth", 'the scene "None (write it yourself)"', "the Precise prompt style"])
    // An engine before scenes sends the original: that scene needs nothing.
    expect(motionEngineGaps({ masking: { mode: "always", source: "full-depth", scene: "original" } }, { ...all, fullDepthScenes: undefined })).toEqual([])
    // Flexible (the default) is every Motion engine's wording: it needs no prompt styles.
    expect(motionEngineGaps(undefined, { styles: ["precise", "motion"] })).toEqual([])
    expect(motionEngineGaps({ masking: { mode: "auto" } }, { styles: ["precise", "motion"] })).toEqual([])
  })
})

describe("motionToSaved and motionIssues", () => {
  it("cleans each engine's masking, keeps its prompt style, and leaves out an engine with neither", () => {
    expect(
      motionToSaved({
        "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "original", threshold: 0.4 }, promptStyle: "flexible" },
        "motion-pulse": {},
      }),
    ).toEqual({ "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "original", threshold: 0.4 }, promptStyle: "flexible" } })
  })

  it("names what the server would refuse", () => {
    expect(motionIssues({ masking: { mode: "auto", source: "full-depth" } })).toEqual([expect.stringMatching(/^Motion: Clip preparation: Full depth/)])
    expect(motionIssues(undefined)).toEqual([])
  })
})
