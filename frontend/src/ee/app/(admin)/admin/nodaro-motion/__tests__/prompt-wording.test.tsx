/**
 * Admin → Nodaro Motion → Engine prompt → the Flex prompt wording: per
 * engine, on the Motion tab while its prompt is Flexible, "Current" (the
 * default, never saved) or "New", with the line saying it reaches every
 * direct Flex run in every environment. "New" is greyed out, naming the
 * environments, until every environment's engine words it
 * (`castSwap.promptWordings`). The tab's preview follows the chosen wording;
 * Save sends the wording (only the engines on "new") before any override.
 * The Precise tab has no wording and its preview never sends one.
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
import { promptWordingToSave } from "../components/PromptPartsTabs"
import { DIRECT_WORDING_NOTE } from "../../trends/prompt-wording"

const PARTS = "/v1/admin/nodaro-motion/prompt-parts"
const WORDING = "/v1/admin/nodaro-motion/prompt-wording"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const wordsNew = (env: string, yes: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(yes ? { promptWordings: ["current", "new"] } : {}) } },
})
const BOTH = [wordsNew("production", true), wordsNew("staging", true)]
const view = (promptWording: unknown) => ({
  body: { data: { promptWording, updatedAt: promptWording ? "2026-11-03T12:00:00.000Z" : null, engines: ENGINES, supported: true } },
})

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/nodaro-motion/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/nodaro-motion/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  // The page's Advanced switch (advanced.test.tsx): never saved, hidden.
  routes["GET /v1/admin/nodaro-motion/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  routes[`GET ${PARTS}`] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes[`POST ${PARTS}/preview`] = (init) => {
    const body = JSON.parse(String(init?.body)) as { style: string; promptWording?: string }
    const parts = [{ id: "opener", default: `${body.style} opener`, defaultHash: "0123456789abcdef", placeholders: ["{video}"], required: [], applies: true }]
    if (body.promptWording === "new") {
      parts.push({ id: "motionLock", default: "Every person moves exactly as in {video}.", defaultHash: "0123456789abcdef", placeholders: ["{video}"], required: [], applies: true })
    }
    return { body: { data: { set: body.style === "motion" ? "flexible" : "precise", parts, assembled: `${body.style} ${body.promptWording ?? "saved"}`, length: 10, max: 8000, problems: [] } } }
  }
  routes["GET /v1/admin/nodaro-motion/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: BOTH } })
  routes[`GET ${WORDING}`] = () => view(null)
})
afterEach(() => vi.unstubAllGlobals())

const engineSection = async (name: string) =>
  (await screen.findByRole("heading", { name: new RegExp(`^Engine prompt: ${name}`) })).closest("section") as HTMLElement
const motionTab = async (name: string) => {
  const section = await engineSection(name)
  await userEvent.setup().click(within(section).getByRole("tab", { name: /^Motion/ }))
  return section
}

describe("Admin → Nodaro Motion → the Flex prompt wording", { timeout: 20_000 }, () => {
  it("promptWordingToSave keeps only the engines on the new wording", () => {
    expect(promptWordingToSave(null)).toEqual({})
    expect(promptWordingToSave({ "motion-prism": "current", "motion-pulse": "new" })).toEqual({ "motion-pulse": "new" })
  })

  it("is on the Motion tab only, Current until saved, with the line that it reaches every environment", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Motion Prism")
    // The Precise tab (the default tab) has none.
    expect(await within(prism).findByText("precise opener", { selector: "p" })).toBeInTheDocument()
    expect(within(prism).queryByRole("combobox", { name: "Wording" })).not.toBeInTheDocument()
    await motionTab("Nodaro Motion Prism")
    const select = await within(prism).findByRole("combobox", { name: "Wording" })
    expect(select).toHaveTextContent("Current (default)")
    expect(within(prism).getByText(DIRECT_WORDING_NOTE)).toBeInTheDocument()
    expect(DIRECT_WORDING_NOTE).toBe("Applies to every direct Flex run on this engine, in every environment.")
    // The Motion tab asks with the wording shown (Current); the Precise tab never names one.
    const previews = sentTo(`POST ${PARTS}/preview`) as Array<{ style: string; promptWording?: string }>
    await waitFor(() => expect(sentTo(`POST ${PARTS}/preview`)).toContainEqual({ engine: "motion-prism", style: "motion", overrides: {}, promptWording: "current" }))
    expect(previews.filter((b) => b.style === "precise").length).toBeGreaterThan(0)
    expect(previews.filter((b) => b.style === "precise").every((b) => !("promptWording" in b))).toBe(true)
  })

  it("previews the chosen wording, then saves it before anything else", async () => {
    const user = userEvent.setup()
    routes[`PUT ${WORDING}`] = (init) => view(JSON.parse(String(init?.body)).promptWording)
    renderWith(<AdminNodaroMotionPage />)
    const prism = await motionTab("Nodaro Motion Prism")
    await user.click(await within(prism).findByRole("combobox", { name: "Wording" }))
    await user.click(await screen.findByRole("option", { name: "New" }))
    await waitFor(() => expect(sentTo(`POST ${PARTS}/preview`)).toContainEqual({ engine: "motion-prism", style: "motion", overrides: {}, promptWording: "new" }))
    // The new wording's parts are shown, labelled.
    expect(await within(prism).findByText("Movement lock (new wording)")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save engine prompts" }))
    await waitFor(() => expect(sentTo(`PUT ${WORDING}`)).toEqual([{ promptWording: { "motion-prism": "new" } }]))
    // No override changed: the overrides are not sent.
    expect(sentTo(`PUT ${PARTS}`)).toEqual([])
    // Precise never asks with a wording.
    expect(sentTo(`POST ${PARTS}/preview`).filter((b) => (b as { style: string }).style === "precise").every((b) => !("promptWording" in (b as object)))).toBe(true)
  })

  it("greys out New, naming the environments, while one's engine cannot word it; a saved New can be taken back", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [wordsNew("production", true), wordsNew("staging", false)] } })
    routes[`GET ${WORDING}`] = () => view({ "motion-pulse": "new" })
    routes[`PUT ${WORDING}`] = (init) => view(JSON.parse(String(init?.body)).promptWording)
    renderWith(<AdminNodaroMotionPage />)
    const prism = await motionTab("Nodaro Motion Prism")
    await user.click(await within(prism).findByRole("combobox", { name: "Wording" }))
    expect(await screen.findByRole("option", { name: "New (not supported yet: staging)" })).toHaveAttribute("aria-disabled", "true")
    await user.keyboard("{Escape}")

    const pulse = await motionTab("Nodaro Motion Pulse")
    const select = await within(pulse).findByRole("combobox", { name: "Wording" })
    expect(select).toHaveTextContent("New")
    await user.click(select)
    await user.click(await screen.findByRole("option", { name: "Current (default)" }))
    await user.click(screen.getByRole("button", { name: "Save engine prompts" }))
    await waitFor(() => expect(sentTo(`PUT ${WORDING}`)).toEqual([{ promptWording: {} }]))
  })

  it("is not shown while the Motion setting words that engine's prompt Precise", async () => {
    routes["GET /v1/admin/nodaro-motion/motion"] = () => ({
      body: { data: { motion: { "motion-pulse": { promptStyle: "precise" } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await motionTab("Nodaro Motion Pulse")
    expect(await within(pulse).findByText("motion saved")).toBeInTheDocument()
    expect(within(pulse).queryByRole("combobox", { name: "Wording" })).not.toBeInTheDocument()
  })
})
