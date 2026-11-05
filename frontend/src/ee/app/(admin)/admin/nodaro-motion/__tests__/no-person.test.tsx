/**
 * Admin → Nodaro Motion → runs with no person, on BOTH engines:
 *
 * - The switch (GET/PUT /v1/admin/nodaro-motion/no-person) sits under each
 *   engine's Precise column, on until an admin turns it off. Save sends only
 *   what differs from the default; going back sends `{}`.
 * - Turning it off is offered once ANY environment's engine reads the setting
 *   (`castSwap.noPersonSourceClip`), naming the ones that do not; with none, it
 *   stays on, unless it is already off, so a saved change can always be taken
 *   back. The server's 409 is said in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"
import type { TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage, { SAVED_PAGE_ONLY_TOAST, SAVED_TOAST } from "../page"
import { ADVANCED_SWITCH_LABEL } from "../components/AdvancedSwitch"
import { NO_ENVIRONMENT_READS_NO_PERSON, NO_PERSON_UNSUPPORTED_HERE, noPersonMissingNote, noPersonToSaved } from "../components/NoPersonColumn"
import { environmentsThatCannotSendSourceClip } from "../../trends/clip-preparation"

const URL_ = "/v1/admin/nodaro-motion/no-person"
const LEGEND = "Runs with no person: send the clip as it is"
const HINT =
  "A Precise run with no person role with pictures sends the clip unprepared. If the model refuses the clip or what it would make, the clip is prepared and retried once, charged only then. A run with an art style may run as Flex instead."
const NOTE = "This setting is shared by every environment."
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const reads = (env: string, yes: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(yes ? { noPersonSourceClip: true } : {}) } },
})
const BOTH = [reads("production", true), reads("staging", true)]
const NEITHER = [reads("production", false), reads("staging", false)]
const view = (noPerson: unknown, supported = true) => ({
  body: { data: { noPerson, updatedAt: noPerson ? "2026-11-05T12:00:00.000Z" : null, engines: ENGINES, supported } },
})

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.success).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/nodaro-motion/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/nodaro-motion/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  routes["GET /v1/admin/nodaro-motion/prompt-wording"] = () => ({ body: { data: { promptWording: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes["POST /v1/admin/nodaro-motion/prompt-parts/preview"] = () => ({ body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } } })
  routes["GET /v1/admin/nodaro-motion/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/nodaro-motion/style-only"] = () => ({ body: { data: { styleOnly: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/precise-art-style"] = () => ({ body: { data: { preciseArtStyle: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: BOTH } })
  routes[`GET ${URL_}`] = () => view(null)
  routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).noPerson)
})
afterEach(() => vi.unstubAllGlobals())

const preciseGroup = (name: string) => screen.findByRole("group", { name: `Nodaro Motion ${name} Precise` })
const switchOf = async (name: string) => within(await preciseGroup(name)).findByRole("switch", { name: LEGEND })
const columnOf = async (name: string) => (await switchOf(name)).closest("[data-testid='no-person-column']") as HTMLElement
const saveButton = () => screen.getByRole("button", { name: "Save" })

describe("Admin → Nodaro Motion → runs with no person", { timeout: 20_000 }, () => {
  it("noPersonToSaved keeps only an engine switched off, in the engines' order, as new objects", () => {
    expect(noPersonToSaved(null)).toEqual({})
    expect(noPersonToSaved(undefined)).toEqual({})
    expect(noPersonToSaved({ "motion-prism": {}, "motion-pulse": {} })).toEqual({})
    const entry = { sourceClip: false } as const
    const saved = noPersonToSaved({ "motion-pulse": entry })
    expect(saved).toEqual({ "motion-pulse": { sourceClip: false } })
    expect(saved["motion-pulse"]).not.toBe(entry)
    // Compared as JSON with what the server answers, so the order an admin clicked in is never a change.
    expect(JSON.stringify(noPersonToSaved({ "motion-pulse": entry, "motion-prism": entry }))).toBe(
      JSON.stringify({ "motion-prism": { sourceClip: false }, "motion-pulse": { sourceClip: false } }),
    )
  })

  it("environmentsThatCannotSendSourceClip names the shared environments without the flag", () => {
    expect(environmentsThatCannotSendSourceClip(undefined)).toBeUndefined()
    expect(environmentsThatCannotSendSourceClip(BOTH)).toEqual([])
    expect(environmentsThatCannotSendSourceClip([reads("production", true)])).toEqual(["staging"])
    expect(environmentsThatCannotSendSourceClip(NEITHER)).toEqual(["staging", "production"])
  })

  it("is on until saved, under BOTH engines' Precise columns, with its hint and the shared note, and Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    for (const name of ["Prism", "Pulse"]) {
      const toggle = await switchOf(name)
      await waitFor(() => expect(toggle).toBeEnabled())
      expect(toggle).toBeChecked()
      expect(toggle).toHaveAccessibleDescription(HINT)
      expect(within(await columnOf(name)).getByText(NOTE)).toBeInTheDocument()
    }
    expect(saveButton()).toBeDisabled()
  })

  it("turning it off on Pulse saves that alone, keyed by Pulse's public id; turning it back on saves {}", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await switchOf("Pulse")
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(await switchOf("Prism")).toBeChecked()
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ noPerson: { "motion-pulse": { sourceClip: false } } }]))
    expect(sentTo("PUT /v1/admin/nodaro-motion/masking")).toEqual([])
    expect(sentTo("PUT /v1/admin/nodaro-motion/precise-art-style")).toEqual([])
    await waitFor(() => expect(saveButton()).toBeDisabled())
    await user.click(await switchOf("Pulse"))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)[1]).toEqual({ noPerson: {} }))
  })

  it("turning it off and on again when never saved is no change", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await switchOf("Prism")
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    expect(saveButton()).toBeEnabled()
    await user.click(toggle)
    expect(toggle).toBeChecked()
    expect(saveButton()).toBeDisabled()
    expect(sentTo(`PUT ${URL_}`)).toEqual([])
  })

  it("shows a saved off on that engine alone", async () => {
    routes[`GET ${URL_}`] = () => view({ "motion-pulse": { sourceClip: false } })
    renderWith(<AdminNodaroMotionPage />)
    await waitFor(async () => expect(await switchOf("Pulse")).not.toBeChecked())
    expect(await switchOf("Prism")).toBeChecked()
    expect(saveButton()).toBeDisabled()
  })

  it("cannot be turned off while no environment's engine reads it, and says so", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: NEITHER } })
    renderWith(<AdminNodaroMotionPage />)
    for (const name of ["Prism", "Pulse"]) {
      const column = await columnOf(name)
      await waitFor(() => expect(within(column).getByText(NO_ENVIRONMENT_READS_NO_PERSON)).toBeInTheDocument())
      expect(within(column).getByText(NOTE)).toBeInTheDocument()
      expect(await switchOf(name)).toBeDisabled()
      expect(await switchOf(name)).toBeChecked()
    }
  })

  it("is disabled while the environments are not known yet", async () => {
    let answer: (reply: { body: unknown }) => void = () => undefined
    routes["GET /v1/admin/trends/engine-environments"] = () => new Promise((resolve) => (answer = resolve))
    renderWith(<AdminNodaroMotionPage />)
    expect(await switchOf("Pulse")).toBeDisabled()
    answer({ body: { data: BOTH } })
    await waitFor(async () => expect(await switchOf("Pulse")).toBeEnabled())
  })

  it("a saved off can be taken back while no environment's engine reads it", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: NEITHER } })
    routes[`GET ${URL_}`] = () => view({ "motion-pulse": { sourceClip: false } })
    renderWith(<AdminNodaroMotionPage />)
    await waitFor(async () => expect(await switchOf("Pulse")).not.toBeChecked())
    const toggle = await switchOf("Pulse")
    expect(toggle).toBeEnabled()
    expect(await switchOf("Prism")).toBeDisabled()
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ noPerson: {} }]))
  })

  it("offers a change once one environment's engine reads it, naming the one that does not", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [reads("production", true), reads("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await switchOf("Pulse")
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(within(await columnOf("Pulse")).getByText(noPersonMissingNote(["staging"]))).toBeInTheDocument()
  })

  it("says when this environment's engine does not read it", async () => {
    routes[`GET ${URL_}`] = () => view(null, false)
    renderWith(<AdminNodaroMotionPage />)
    expect(await within(await columnOf("Pulse")).findByText(NO_PERSON_UNSUPPORTED_HERE)).toBeInTheDocument()
  })

  it("the query's error shows in each engine's Precise column, and the rest of the column stays", async () => {
    const message = "The no-person setting could not be read"
    routes[`GET ${URL_}`] = () => ({ status: 500, body: { error: { message } } })
    renderWith(<AdminNodaroMotionPage />)
    for (const name of ["Prism", "Pulse"]) {
      const group = await preciseGroup(name)
      expect(await within(group).findByText(message)).toBeInTheDocument()
      expect(within(group).queryByRole("switch", { name: LEGEND })).not.toBeInTheDocument()
    }
    expect(saveButton()).toBeDisabled()
  })

  it("says the server's 409 in place; a new choice clears it", async () => {
    const user = userEvent.setup()
    const message = "No Cast Swap engine reads this setting yet: keep the default (on), or wait for the engine."
    routes[`PUT ${URL_}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message, envs: [] } } })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await switchOf("Pulse")
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    await user.click(saveButton())
    expect(await within(await columnOf("Pulse")).findByRole("alert")).toHaveTextContent(message)
    await user.click(await switchOf("Pulse"))
    await waitFor(async () => expect(within(await columnOf("Pulse")).queryByRole("alert")).not.toBeInTheDocument())
  })

  it("Advanced saved with it keeps the runs' toast: a run reads this setting", async () => {
    const user = userEvent.setup()
    routes["PUT /v1/admin/nodaro-motion/advanced"] = (init) => ({ body: { data: { show: JSON.parse(String(init?.body)).show, updatedAt: "2026-11-05T12:00:00.000Z" } } })
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await screen.findByRole("switch", { name: ADVANCED_SWITCH_LABEL }))
    const toggle = await switchOf("Pulse")
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SAVED_TOAST))
    expect(toast.success).not.toHaveBeenCalledWith(SAVED_PAGE_ONLY_TOAST)
    expect(sentTo(`PUT ${URL_}`)).toEqual([{ noPerson: { "motion-pulse": { sourceClip: false } } }])
    expect(sentTo("PUT /v1/admin/nodaro-motion/advanced")).toEqual([{ show: true }])
  })
})
