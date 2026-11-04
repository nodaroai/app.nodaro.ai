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

import type { TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { motionEngineGaps, motionIssues, motionToSaved, toSaved } from "../model"

const URL = "/v1/admin/nodaro-motion/masking"
const PROMPT_URL = "/v1/admin/nodaro-motion/prompt-parts"
const MOTION_URL = "/v1/admin/nodaro-motion/motion"
const PULSE_AUDIO_URL = "/v1/admin/nodaro-motion/pulse-audio"
const PRISM_AUDIO_URL = "/v1/admin/nodaro-motion/prism-reference-audio"
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
const ENVS_URL = "/v1/admin/trends/engine-environments"
/** An engine that hides whole people with faces hidden (`faceMaskHideTargets`), and one from before (keeps them only). */
const hides = (env: string): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, faceMaskTargets: ["face", "head", "body"], faceMaskHideTargets: ["face", "head", "body"] } },
})
const keepsOnly = (env: string): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, faceMaskTargets: ["face", "head", "body"] } },
})
/** An engine that draws the face mesh (`castSwap.faceMesh`). */
const meshes = (env: string): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, faceMesh: true } },
})
/** An engine that draws the depth in every colormap (`castSwap.depthColormaps`), or in some. */
const maps = (env: string, depthColormaps: string[] = ["grayscale", "turbo", "inferno", "magma", "viridis"]): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, depthColormaps } as never },
})
/** An engine that draws the depth with every model size (`castSwap.depthModelSizes`), or with some. */
const sizes = (env: string, depthModelSizes: string[] = ["small", "base", "large"]): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, depthModelSizes } as never },
})
/** Every environment the setting is shared by can hide whole people. */
const HIDE_ENVS: TrendEngineEnvironment[] = [hides("production"), hides("staging")]

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${URL}`] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  // The Style choice (style.test.tsx): never saved, people choose on every engine.
  routes["GET /v1/admin/nodaro-motion/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  // The page's Advanced switch (advanced.test.tsx): never saved, hidden.
  routes["GET /v1/admin/nodaro-motion/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  routes[`GET ${PROMPT_URL}`] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes[`POST ${PROMPT_URL}/preview`] = () => ({ body: { data: ANSWER } })
  routes[`GET ${MOTION_URL}`] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes[`GET ${PULSE_AUDIO_URL}`] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes[`GET ${PRISM_AUDIO_URL}`] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes[`GET ${ENVS_URL}`] = () => ({ body: { data: ENVIRONMENTS } })
  // The preparation steps (steps.test.tsx): never saved; these environments' engines take none.
  routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
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

  it("offers Body greyed out, naming the environments that lack it, while no environment's engine hides whole people", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click(within(prism).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    await user.click(within(prism).getByRole("combobox", { name: "Covers" }))
    // Staging has no recorded engine (unknown counts as lacking); production's predates it.
    await waitFor(() => expect(screen.getByRole("option", { name: "Body (not supported yet: staging, production)" })).toHaveAttribute("aria-disabled", "true"))
  })

  it("keeps Body greyed out until EVERY environment's engine hides whole people (the setting is shared)", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [keepsOnly("production"), hides("staging")] } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click(within(prism).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    await user.click(within(prism).getByRole("combobox", { name: "Covers" }))
    await waitFor(() => expect(screen.getByRole("option", { name: "Body (not supported yet: production)" })).toHaveAttribute("aria-disabled", "true"))
  })

  it("shows the face mesh only while masking, greyed out and naming the environments whose engine cannot draw it", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [meshes("production"), hides("staging")] } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    expect(within(prism).queryByRole("checkbox", { name: "Face mesh" })).not.toBeInTheDocument()
    await user.click(within(prism).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    expect(await within(prism).findByRole("checkbox", { name: "Face mesh" })).toBeDisabled()
    expect(within(prism).getByText(/The Cast Swap engine of staging cannot draw the face mesh yet/)).toBeInTheDocument()
  })

  it("saves the face mesh as true once every environment's engine draws it, and turning it off removes the key", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [meshes("production"), meshes("staging")] } })
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-10-31T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click(within(prism).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    const mesh = await within(prism).findByRole("checkbox", { name: "Face mesh" })
    expect(mesh).toBeEnabled()
    await user.click(mesh)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-prism": { mode: "always", faceMesh: true } } }]))
    await user.click(within(prism).getByRole("checkbox", { name: "Face mesh" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toHaveLength(2))
    expect(sentTo(`PUT ${URL}`)[1]).toEqual({ masking: { "motion-prism": { mode: "always" } } })
  })

  it("the Precise column offers what the face mesh draws once every environment's engine lists the parts, and saves it", async () => {
    const user = userEvent.setup()
    const parts = (env: string): TrendEngineEnvironment => {
      const base = meshes(env)
      return { ...base, supports: { ...base.supports, castSwap: { ...base.supports.castSwap, faceMeshParts: ["full", "features", "mouth"] } } }
    }
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [parts("production"), parts("staging")] } })
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-11-02T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const precise = within(await section(/Prism/)).getByRole("group", { name: /Prism Precise$/ })
    await user.click(within(precise).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    await user.click(await within(precise).findByRole("checkbox", { name: "Face mesh" }))
    await user.click(within(precise).getByRole("combobox", { name: "Face mesh lines" }))
    await user.click(screen.getByRole("option", { name: "Mouth only" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-prism": { mode: "always", faceMesh: true, faceMeshParts: "mouth" } } }]))
  })

  it("the Precise column offers the fill None and a depth fill's blur once every environment's engine draws them, and saves them", async () => {
    const user = userEvent.setup()
    const draws = (env: string): TrendEngineEnvironment => {
      const base = meshes(env)
      return { ...base, supports: { ...base.supports, castSwap: { ...base.supports.castSwap, maskFillNone: true, depthFillBlur: true } } }
    }
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [draws("production"), draws("staging")] } })
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-11-02T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const precise = within(await section(/Prism/)).getByRole("group", { name: /Prism Precise$/ })
    await user.click(within(precise).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    await user.click(within(precise).getByRole("combobox", { name: "Fill" }))
    await user.click(screen.getByRole("option", { name: "None (faces as filmed, face mesh only)" }))
    expect(within(precise).getByRole("checkbox", { name: "Face mesh" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-prism": { mode: "always", fill: "none", faceMesh: true } } }]))
    await user.click(within(precise).getByRole("combobox", { name: "Fill" }))
    await user.click(screen.getByRole("option", { name: "Depth colors" }))
    await user.type(within(precise).getByRole("spinbutton", { name: "Depth blur" }), "6")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`).at(-1)).toEqual({ masking: { "motion-prism": { mode: "always", fill: "depth", faceMesh: true, depthBlur: 6 } } }))
  })

  it("the Motion column's Faces hidden never offers the fill None nor a depth fill's blur (the Precise setting's alone)", async () => {
    const user = userEvent.setup()
    const draws = (env: string): TrendEngineEnvironment => {
      const base = meshes(env)
      return { ...base, supports: { ...base.supports, castSwap: { ...base.supports.castSwap, maskFillNone: true, depthFillBlur: true } } }
    }
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [draws("production"), draws("staging")] } })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await within(await section(/Pulse/)).findByRole("group", { name: /Pulse Motion$/ })
    await user.click(within(motion).getByRole("combobox", { name: "Motion masking" }))
    await user.click(screen.getByRole("option", { name: "Faces hidden" }))
    await user.click(within(motion).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    await user.click(within(motion).getByRole("combobox", { name: "Fill" }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Blur (default)", "Depth colors"])
    await user.click(screen.getByRole("option", { name: "Depth colors" }))
    expect(within(motion).queryByRole("spinbutton", { name: "Depth blur" })).toBeNull()
  })

  it("a face mesh saved on stays shown and can be turned off while an environment lacks it", async () => {
    routes[`GET ${URL}`] = () => ({ body: { data: { masking: { "motion-prism": { mode: "always", faceMesh: true } }, updatedAt: "2026-10-31T12:00:00.000Z", engines: ENGINES } } })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [meshes("production")] } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    const mesh = await within(prism).findByRole("checkbox", { name: "Face mesh" })
    expect(mesh).toBeChecked()
    expect(mesh).toBeEnabled()
    expect(within(prism).getByText(/staging cannot draw the face mesh yet.*turn it off to save/)).toBeInTheDocument()
  })

  it("saves a depth fill's colormap once every environment's engine draws it; the default is no key", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [maps("production"), maps("staging")] } })
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-11-01T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click(within(prism).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    expect(within(prism).queryByRole("combobox", { name: "Depth colormap" })).not.toBeInTheDocument()
    await user.click(within(prism).getByRole("combobox", { name: "Fill" }))
    await user.click(screen.getByRole("option", { name: "Depth colors" }))
    await user.click(within(prism).getByRole("combobox", { name: "Depth colormap" }))
    await user.click(await screen.findByRole("option", { name: "Inferno" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-prism": { mode: "always", fill: "depth", depthColormap: "inferno" } } }]))
  })

  it("greys out a colormap an environment's engine cannot draw, naming it", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL}`] = () => ({ body: { data: { masking: { "motion-prism": { mode: "always", fill: "depth" } }, updatedAt: "2026-11-01T12:00:00.000Z", engines: ENGINES } } })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [maps("production"), maps("staging", ["inferno"])] } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click(await within(prism).findByRole("combobox", { name: "Depth colormap" }))
    await waitFor(() => expect(screen.getByRole("option", { name: "Magma (not supported yet)" })).toHaveAttribute("aria-disabled", "true"))
    expect(screen.getByRole("option", { name: "Inferno" })).not.toHaveAttribute("aria-disabled")
  })

  it("saves a depth fill's model size once every environment's engine draws with it; Large is no key", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [sizes("production"), sizes("staging")] } })
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-11-02T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click(within(prism).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    expect(within(prism).queryByRole("combobox", { name: "Depth model" })).not.toBeInTheDocument()
    await user.click(within(prism).getByRole("combobox", { name: "Fill" }))
    await user.click(screen.getByRole("option", { name: "Depth colors" }))
    await user.click(within(prism).getAllByRole("combobox", { name: "Depth model" })[0]!)
    await user.click(await screen.findByRole("option", { name: "Small" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-prism": { mode: "always", fill: "depth", depthModelSize: "small" } } }]))
  })

  it("greys out a model size an environment's engine cannot draw with, naming it", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL}`] = () => ({ body: { data: { masking: { "motion-prism": { mode: "always", fill: "depth" } }, updatedAt: "2026-11-02T12:00:00.000Z", engines: ENGINES } } })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [sizes("production"), sizes("staging", ["small"])] } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click((await within(prism).findAllByRole("combobox", { name: "Depth model" }))[0]!)
    await waitFor(() => expect(screen.getByRole("option", { name: "Base (not supported yet)" })).toHaveAttribute("aria-disabled", "true"))
    expect(screen.getByRole("option", { name: "Small" })).not.toHaveAttribute("aria-disabled")
  })

  it("saves Body (the whole person hidden) once an environment's engine can", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: HIDE_ENVS } })
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-10-29T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    await user.click(within(prism).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    await user.click(within(prism).getByRole("combobox", { name: "Covers" }))
    await user.click(await screen.findByRole("option", { name: "Body" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-prism": { mode: "always", target: "body" } } }]))
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

describe("Admin → Nodaro Motion → Pulse audio", () => {
  it("shows the select in the Pulse section only, Original audio until it is saved", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await section(/Pulse/)
    const audio = await within(pulse).findByRole("combobox", { name: "Pulse audio" })
    expect(audio).toHaveTextContent("Original audio (default)")
    expect(within(pulse).getByText("The original audio goes back on the result, exactly")).toBeInTheDocument()
    expect(within(await section(/Prism/)).queryByRole("combobox", { name: "Pulse audio" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("combobox", { name: "Pulse audio" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("saves Kling's audio on its own, and nothing else", async () => {
    const user = userEvent.setup()
    routes[`PUT ${PULSE_AUDIO_URL}`] = (init) => ({
      body: { data: { pulseAudio: JSON.parse(String(init?.body)).pulseAudio, updatedAt: "2026-10-28T12:00:00.000Z", supported: true } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await section(/Pulse/)
    await user.click(await within(pulse).findByRole("combobox", { name: "Pulse audio" }))
    await user.click(screen.getByRole("option", { name: "Kling's audio" }))
    expect(within(pulse).getByText("Kling keeps the clip's sound and its own track is delivered as is")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${PULSE_AUDIO_URL}`)).toEqual([{ pulseAudio: "generated" }]))
    expect(sentTo(`PUT ${URL}`)).toEqual([])
    expect(sentTo(`PUT ${MOTION_URL}`)).toEqual([])
  })

  it("starts from what is stored, and says when this environment's engine does not take it yet", async () => {
    routes[`GET ${PULSE_AUDIO_URL}`] = () => ({ body: { data: { pulseAudio: "generated", updatedAt: "2026-10-28T10:00:00.000Z", supported: false } } })
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await section(/Pulse/)
    expect(await within(pulse).findByRole("combobox", { name: "Pulse audio" })).toHaveTextContent("Kling's audio")
    expect(within(pulse).getByText(/does not take it yet/)).toBeInTheDocument()
  })
})

describe("Admin → Nodaro Motion → Prism reference audio", () => {
  const HINT = "What the engine hears in the reference video, per output resolution. The original audio always goes back on the result."
  const RESOLUTIONS = ["480p", "720p", "1080p"]
  const audioGroup = async (prism: HTMLElement) => within(prism).findByRole("group", { name: "Prism reference audio" })
  const pitchAt = (group: HTMLElement, r: string) => within(within(group).getByRole("group", { name: r })).getByRole("spinbutton", { name: "Pitch shift (semitones)" })

  it("shows a mode and a pitch shift per output resolution, in the Prism section only, the full mix at +4 until it is saved", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    const group = await audioGroup(prism)
    for (const r of RESOLUTIONS) {
      expect(within(group).getByRole("combobox", { name: r })).toHaveTextContent("Full mix")
      expect(pitchAt(group, r)).toHaveValue("4")
    }
    expect(within(group).getAllByRole("combobox")).toHaveLength(3)
    expect(within(prism).getByText(HINT)).toBeInTheDocument()
    expect(within(await section(/Pulse/)).queryByRole("group", { name: "Prism reference audio" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("group", { name: "Prism reference audio" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("offers the modes per resolution and saves every resolution's choice on its own, as today's ids, and nothing else", async () => {
    const user = userEvent.setup()
    routes[`PUT ${PRISM_AUDIO_URL}`] = (init) => ({
      body: { data: { prismReferenceAudio: JSON.parse(String(init?.body)).prismReferenceAudio, updatedAt: "2026-10-29T12:00:00.000Z", supported: true } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    await user.click(within(group).getByRole("combobox", { name: "720p" }))
    // The one-tone modes are listed too, greyed out until every environment's engine takes them.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "No audio",
      "Full mix",
      "Voice only",
      "Full mix, one tone (not supported yet)",
      "Voice only, one tone (not supported yet)",
    ])
    await user.click(screen.getByRole("option", { name: "No audio" }))
    await user.click(within(group).getByRole("combobox", { name: "1080p" }))
    await user.click(screen.getByRole("option", { name: "Voice only" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sentTo(`PUT ${PRISM_AUDIO_URL}`)).toEqual([{ prismReferenceAudio: { "480p": "full", "720p": "none", "1080p": "voice" } }]),
    )
    expect(sentTo(`PUT ${URL}`)).toEqual([])
    expect(sentTo(`PUT ${MOTION_URL}`)).toEqual([])
    expect(sentTo(`PUT ${PULSE_AUDIO_URL}`)).toEqual([])
  })

  it("starts from what is stored, a resolution left out as the full mix at +4, and says when this environment's engine does not take it yet", async () => {
    routes[`GET ${PRISM_AUDIO_URL}`] = () => ({
      body: { data: { prismReferenceAudio: { "720p": "none", "1080p": "octave" }, updatedAt: "2026-10-29T10:00:00.000Z", supported: false } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    const group = await audioGroup(prism)
    expect(within(group).getByRole("combobox", { name: "480p" })).toHaveTextContent("Full mix")
    expect(pitchAt(group, "480p")).toHaveValue("4")
    expect(within(group).getByRole("combobox", { name: "720p" })).toHaveTextContent("No audio")
    expect(pitchAt(group, "720p")).toBeDisabled()
    expect(within(group).getByRole("combobox", { name: "1080p" })).toHaveTextContent("Full mix")
    expect(pitchAt(group, "1080p")).toHaveValue("12")
    expect(within(prism).getByText(/does not take it yet: its runs send the full audio/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  /**
   * An engine that takes Prism's newer reference audio (`castSwap.prismReferenceAudioModes`, and the pitch shift), or
   * some of it; and its platform's claim (`claim`, as the server sends a fresh one: `supports.platform`).
   */
  const tones = (env: string, prismReferenceAudioModes: string[] = ["full", "voice", "none", "one-tone", "octave"], pitch = false, claim = pitch): TrendEngineEnvironment => ({
    ...ENVIRONMENTS[0]!,
    env,
    supports: {
      castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, prismReferenceAudioModes, ...(pitch ? { prismReferenceAudioPitch: true } : {}) } as never,
      ...(claim ? { platform: { prismReferenceAudioPitch: true } } : {}),
    },
  })
  const PITCH_MODES = ["full", "voice", "none", "one-tone", "octave", "full-one-tone", "voice-one-tone"]
  const echo = () => {
    routes[`PUT ${PRISM_AUDIO_URL}`] = (init) => ({
      body: { data: { prismReferenceAudio: JSON.parse(String(init?.body)).prismReferenceAudio, updatedAt: "2026-11-03T12:00:00.000Z", supported: true } },
    })
  }
  const stored = (prismReferenceAudio: unknown) => {
    routes[`GET ${PRISM_AUDIO_URL}`] = () => ({ body: { data: { prismReferenceAudio, updatedAt: "2026-11-03T10:00:00.000Z", supported: true } } })
  }
  const statuses = (el: HTMLElement) => within(el).queryAllByRole("status").map((n) => n.textContent)

  it("greys out the pitch shift and Voice only, one tone while an environment lacks the engine's flag or the platform's claim, saying which", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [tones("production", PITCH_MODES, true), tones("staging", undefined, false, true)] } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    expect(await within(group).findByText(/^The Cast Swap engine of staging cannot take a pitch shift/)).toBeInTheDocument()
    for (const r of RESOLUTIONS) expect(pitchAt(group, r)).toBeDisabled()
    expect(statuses(group)).toEqual(["The Cast Swap engine of staging cannot take a pitch shift or Voice only, one tone yet, and this setting is shared by every environment."])
    await user.click(within(group).getByRole("combobox", { name: "480p" }))
    expect(await screen.findByRole("option", { name: "Voice only, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
  })

  it("the platform's claim missing, the engine there: greyed out too, naming the platform", async () => {
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [tones("production", PITCH_MODES, true, false), tones("staging", PITCH_MODES, true)] } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    expect(await within(group).findByText(/^The platform in production does not take a pitch shift/)).toBeInTheDocument()
    expect(pitchAt(group, "480p")).toBeDisabled()
    expect(statuses(group)).toEqual(["The platform in production does not take a pitch shift or Voice only, one tone yet, and this setting is shared by every environment."])
  })

  it("offers Full mix, one tone where every environment's engine lists one-tone, and saves it at 0 as one-tone", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [tones("production"), tones("staging", ["full", "voice", "none", "one-tone"])] } })
    echo()
    renderWith(<AdminNodaroMotionPage />)
    const prism = await section(/Prism/)
    const group = await audioGroup(prism)
    await within(group).findByText(/^The Cast Swap engine of staging, production cannot take a pitch shift/)
    await user.click(within(group).getByRole("combobox", { name: "480p" }))
    expect(await screen.findByRole("option", { name: "Voice only, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    await user.click(await screen.findByRole("option", { name: "Full mix, one tone" }))
    // A one-tone mode starts unpitched: today's one-tone, which every engine here takes.
    expect(pitchAt(group, "480p")).toHaveValue("0")
    expect(screen.queryByText(/480p: Full mix, one tone/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sentTo(`PUT ${PRISM_AUDIO_URL}`)).toEqual([{ prismReferenceAudio: { "480p": "one-tone", "720p": "full", "1080p": "full" } }]),
    )
  })

  it("offers any pitch shift once every environment's engine and platform take it, and saves a value no id says as { mode, semitones }", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [tones("production", PITCH_MODES, true), tones("staging", PITCH_MODES, true)] } })
    echo()
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    await waitFor(() => expect(pitchAt(group, "720p")).toBeEnabled())
    expect(statuses(group)).toEqual([])
    await user.click(within(group).getByRole("combobox", { name: "1080p" }))
    await user.click(await screen.findByRole("option", { name: "Voice only, one tone" }))
    await user.clear(pitchAt(group, "720p"))
    await user.type(pitchAt(group, "720p"), "-3.5{Enter}")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sentTo(`PUT ${PRISM_AUDIO_URL}`)).toEqual([
        { prismReferenceAudio: { "480p": "full", "720p": { mode: "full", semitones: -3.5 }, "1080p": { mode: "voice-one-tone", semitones: 0 } } },
      ]),
    )
  })

  it("holds Save while a changed value is not on every environment yet, saying what is missing", async () => {
    const user = userEvent.setup()
    stored({ "720p": "octave" })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [tones("production", PITCH_MODES, true), tones("staging")] } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    await within(group).findByText(/^The Cast Swap engine of staging cannot take a pitch shift/)
    // A stored Octave stays open, to be set back; anything typed there no id says waits.
    await user.clear(pitchAt(group, "720p"))
    await user.type(pitchAt(group, "720p"), "7{Enter}")
    expect(within(within(group).getByRole("group", { name: "720p" })).getByText("This pitch shift is not supported yet.")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Prism reference audio, 720p: Full mix at +7 semitones cannot be saved yet: the Cast Swap engine of staging cannot take it, and the platform in staging does not take it.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    // Back as stored: nothing to hold, nothing changed.
    await user.clear(pitchAt(group, "720p"))
    await user.type(pitchAt(group, "720p"), "12{Enter}")
    expect(screen.queryByText(/720p: Full mix at \+7 semitones/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("never holds what was not changed: a stored value an environment does not take leaves the other resolutions, and the page's other saves, free", async () => {
    const user = userEvent.setup()
    stored({ "720p": { mode: "full", semitones: 7 } })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [tones("production", PITCH_MODES, true), tones("staging")] } })
    routes[`PUT ${PULSE_AUDIO_URL}`] = () => ({ body: { data: { pulseAudio: "generated", updatedAt: "2026-11-03T12:00:00.000Z", supported: true } } })
    echo()
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    await within(group).findByText(/^The Cast Swap engine of staging cannot take a pitch shift/)
    expect(within(within(group).getByRole("group", { name: "720p" })).getByText("This pitch shift is not supported yet.")).toBeInTheDocument()
    expect(screen.queryByText(/720p: Full mix at \+7 semitones/)).not.toBeInTheDocument()
    const pulse = await section(/Pulse/)
    await user.click(await within(pulse).findByRole("combobox", { name: "Pulse audio" }))
    await user.click(await screen.findByRole("option", { name: "Kling's audio" }))
    await user.click(within(group).getByRole("combobox", { name: "1080p" }))
    await user.click(await screen.findByRole("option", { name: "No audio" }))
    expect(screen.queryByText(/720p: Full mix at \+7 semitones/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${PULSE_AUDIO_URL}`)).toHaveLength(1))
    await waitFor(() =>
      expect(sentTo(`PUT ${PRISM_AUDIO_URL}`)).toEqual([{ prismReferenceAudio: { "480p": "full", "720p": { mode: "full", semitones: 7 }, "1080p": "none" } }]),
    )
  })

  it("a stored value that is itself held stays open: typed to its mode's default it holds Save, and it can be typed back", async () => {
    const user = userEvent.setup()
    stored({ "720p": { mode: "voice-one-tone", semitones: 3 } })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [tones("production", PITCH_MODES, true, false), tones("staging", PITCH_MODES, true)] } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    await within(group).findByText(/^The platform in production does not take a pitch shift/)
    await user.clear(pitchAt(group, "720p"))
    await user.type(pitchAt(group, "720p"), "0{Enter}")
    expect(screen.getByText("Prism reference audio, 720p: Voice only, one tone at 0 semitones cannot be saved yet: the platform in production does not take it.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(pitchAt(group, "720p")).toBeEnabled()
    await user.clear(pitchAt(group, "720p"))
    await user.type(pitchAt(group, "720p"), "3{Enter}")
    expect(screen.queryByText(/720p: Voice only, one tone/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("a failed read of the environments says so and names none, on the fields and on what Save holds", async () => {
    const user = userEvent.setup()
    stored({ "720p": { mode: "full", semitones: 7 }, "1080p": "one-tone" })
    routes[`GET ${ENVS_URL}`] = () => ({ status: 500, body: { error: { code: "internal_error", message: "down" } } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    expect(await within(group).findByText("The environments could not be read, so a new pitch shift or one-tone mode can't be saved yet. Reload the page to try again.")).toBeInTheDocument()
    // True beside a closed field, an open one and a held one.
    expect(pitchAt(group, "480p")).toBeDisabled()
    expect(pitchAt(group, "720p")).toBeEnabled()
    expect(pitchAt(group, "1080p")).toBeEnabled()
    await user.clear(pitchAt(group, "720p"))
    await user.type(pitchAt(group, "720p"), "8{Enter}")
    expect(screen.getByText("Prism reference audio, 720p: Full mix at +8 semitones cannot be saved yet: the environments could not be read.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(screen.queryByText(/The Cast Swap engine of staging, production/)).not.toBeInTheDocument()
    expect(screen.queryByText(/The platform in staging, production/)).not.toBeInTheDocument()
  })

  it("reads a setting saved as one plain mode as that mode at every resolution, with no change to save", async () => {
    routes[`GET ${PRISM_AUDIO_URL}`] = () => ({ body: { data: { prismReferenceAudio: "voice", updatedAt: "2026-10-29T10:00:00.000Z", supported: true } } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    for (const r of RESOLUTIONS) expect(within(group).getByRole("combobox", { name: r })).toHaveTextContent("Voice only")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("reads a stored { mode, semitones } as it is, with no change to save", async () => {
    stored({ "720p": { mode: "full", semitones: 7 } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await audioGroup(await section(/Prism/))
    expect(pitchAt(group, "720p")).toHaveValue("7")
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

  it("once every environment runs the shot list: Full depth alone, its scene a description or a description + the original", async () => {
    const user = userEvent.setup()
    const shotList = (env: string): TrendEngineEnvironment => ({
      ...ENVIRONMENTS[0]!,
      env,
      supports: {
        castSwap: {
          ...ENVIRONMENTS[0]!.supports.castSwap,
          steps: true,
          shotList: true,
          fullDepthScenes: ["description", "original", "none", "description-and-original"],
        },
      },
    })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [shotList("production"), shotList("staging")] } })
    routes[`PUT ${MOTION_URL}`] = (init) => ({
      body: { data: { motion: JSON.parse(String(init?.body)).motion, updatedAt: "2026-11-01T12:00:00.000Z", engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Pulse/)
    expect(await within(motion).findByText(/Full depth with a shot list/)).toBeInTheDocument()
    expect(within(motion).queryByRole("combobox", { name: "Motion masking" })).toBeNull()
    expect(within(motion).getByText("Full depth, the scene from a description, Flexible prompt.")).toBeInTheDocument()
    await user.click(within(motion).getByRole("combobox", { name: "Scene from" }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Description (automatic)", "Description + original (up to 27.5 s)"])
    await user.click(screen.getByRole("option", { name: "Description + original (up to 27.5 s)" }))
    // A Precise prompt style with Full depth stays allowed.
    await user.click(within(motion).getByRole("combobox", { name: "Motion prompt style" }))
    await user.click(screen.getByRole("option", { name: "Precise" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sentTo(`PUT ${MOTION_URL}`)).toEqual([
        { motion: { "motion-pulse": { masking: { mode: "always", source: "full-depth", scene: "description-and-original" }, promptStyle: "precise" } } },
      ]),
    )
  })

  it("the Motion column's Full depth offers the depth blur and what the face mesh draws (a Cast Swap engine from 0.430.0); the Precise column neither", async () => {
    const user = userEvent.setup()
    const latest = (env: string): TrendEngineEnvironment => ({
      ...ENVIRONMENTS[0]!,
      env,
      supports: {
        castSwap: {
          ...ENVIRONMENTS[0]!.supports.castSwap,
          steps: true,
          shotList: true,
          faceMesh: true,
          depthBlur: true,
          faceMeshParts: ["full", "features", "mouth"],
          fullDepthScenes: ["description", "original", "none", "description-and-original"],
        },
      },
    })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [latest("production"), latest("staging")] } })
    routes[`PUT ${MOTION_URL}`] = (init) => ({
      body: { data: { motion: JSON.parse(String(init?.body)).motion, updatedAt: "2026-11-02T12:00:00.000Z", engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Pulse/)
    const blur = await within(motion).findByRole("spinbutton", { name: "Depth blur" })
    await user.type(blur, "28")
    await user.click(within(motion).getByRole("checkbox", { name: "Face mesh" }))
    await user.click(within(motion).getByRole("combobox", { name: "Face mesh lines" }))
    await user.click(screen.getByRole("option", { name: "Mouth only" }))
    // The Precise column (Faces hidden) has neither.
    const precise = within(await section(/Pulse/)).getByRole("group", { name: /Pulse Precise$/ })
    expect(within(precise).queryByRole("spinbutton", { name: "Depth blur" })).toBeNull()
    expect(within(precise).queryByRole("combobox", { name: "Face mesh lines" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sentTo(`PUT ${MOTION_URL}`)).toEqual([
        { motion: { "motion-pulse": { masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 28, faceMeshParts: "mouth" } } } },
      ]),
    )
  })

  it("once every environment runs the shot list, a stored scene with no shot list says what it runs as", async () => {
    const shotList = (env: string): TrendEngineEnvironment => ({
      ...ENVIRONMENTS[0]!,
      env,
      supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, steps: true, shotList: true } },
    })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [shotList("production"), shotList("staging")] } })
    routes[`GET ${MOTION_URL}`] = () => ({
      body: {
        data: {
          motion: {
            "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "original" } },
            "motion-pulse": { masking: { mode: "always", source: "full-depth", scene: "none" } },
          },
          updatedAt: null,
          engines: ENGINES,
          promptStyles: ["precise", "flexible"],
        },
      },
    })
    renderWith(<AdminNodaroMotionPage />)
    expect(await within(await motionOf(/Prism/)).findByText(/Flex runs it as Description \+ original/)).toBeInTheDocument()
    expect(await within(await motionOf(/Pulse/)).findByText(/Flex runs it as Description \(automatic\)/)).toBeInTheDocument()
  })

  it("before every environment runs the shot list, the shared column never offers a scene only some engines take", async () => {
    const user = userEvent.setup()
    const both = (env: string): TrendEngineEnvironment => ({
      ...ENVIRONMENTS[0]!,
      env,
      supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, fullDepthScenes: ["description", "original", "none", "description-and-original"] } },
    })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [ENVIRONMENTS[0]!, both("staging")] } })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Pulse/)
    await user.click(within(motion).getByRole("combobox", { name: "Motion masking" }))
    await user.click(screen.getByRole("option", { name: "Full depth" }))
    await user.click(within(motion).getByRole("combobox", { name: "Scene from" }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).not.toContain("Description + original (up to 27.5 s)")
  })

  it("once every environment runs the shot list, a stored Faces hidden says it no longer does anything", async () => {
    const user = userEvent.setup()
    const shotList = (env: string): TrendEngineEnvironment => ({
      ...ENVIRONMENTS[0]!,
      env,
      supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, steps: true, shotList: true } },
    })
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [shotList("production"), shotList("staging")] } })
    routes[`GET ${MOTION_URL}`] = () => ({
      body: { data: { motion: { "motion-prism": { masking: { mode: "auto", target: "face" } } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Prism/)
    expect(await within(motion).findByText(/The saved Motion masking \(Faces hidden\) no longer does anything/)).toBeInTheDocument()
    await user.click(within(motion).getByRole("button", { name: "Set Full depth" }))
    expect(within(motion).queryByText(/no longer does anything/)).toBeNull()
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

  it("the Motion column's face mask keeps Body greyed out until every environment's engine hides whole people", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: [hides("production"), keepsOnly("staging")] } })
    routes[`GET ${MOTION_URL}`] = () => ({
      body: { data: { motion: { "motion-prism": { masking: { mode: "always" } } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Prism/)
    await waitFor(() => expect(within(motion).getByRole("combobox", { name: "Covers" })).toBeInTheDocument())
    await user.click(within(motion).getByRole("combobox", { name: "Covers" }))
    await waitFor(() => expect(screen.getByRole("option", { name: "Body (not supported yet: staging)" })).toHaveAttribute("aria-disabled", "true"))
  })

  it("the Motion column's face mask offers Body once every environment's engine hides whole people", async () => {
    const user = userEvent.setup()
    routes[`GET ${ENVS_URL}`] = () => ({ body: { data: HIDE_ENVS } })
    routes[`GET ${MOTION_URL}`] = () => ({
      body: { data: { motion: { "motion-prism": { masking: { mode: "always" } } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    routes[`PUT ${MOTION_URL}`] = (init) => ({
      body: { data: { motion: JSON.parse(String(init?.body)).motion, updatedAt: "2026-10-29T12:00:00.000Z", engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const motion = await motionOf(/Prism/)
    await waitFor(() => expect(within(motion).getByRole("combobox", { name: "Covers" })).toBeInTheDocument())
    await user.click(within(motion).getByRole("combobox", { name: "Covers" }))
    await user.click(await screen.findByRole("option", { name: "Body" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${MOTION_URL}`)).toEqual([{ motion: { "motion-prism": { masking: { mode: "always", target: "body" } } } }]))
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
