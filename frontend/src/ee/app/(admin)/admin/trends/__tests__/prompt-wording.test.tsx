/**
 * Admin → Trends → one trend → 4. Prompts → the Flex prompt wording.
 *
 * - The pure rules (prompt-wording.ts, `fromForm`): "New" is offered to a
 *   trend once SOME environment's engine words it, to the shared setting
 *   once EVERY one does; the wording round-trips through the form, and a
 *   draft without one stays without.
 * - The editor: a Wording select beside the prompt style, "Current
 *   (default)" until chosen, saved with the draft only when it is "new"; a
 *   trend on "new" names the environments it can't be published to, and a
 *   Precise trend says the wording is not used.
 * - The new publish refusal reads as a sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { TrendEngineEnvironment } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { describeBlocker, fromForm, toForm } from "../model"
import { environmentsLackingNewWording, environmentsThatCannotUseNewWording, someEnvironmentTakesNewWording } from "../prompt-wording"

const BASE = `/v1/admin/trends/${TREND_ID}`
const withWording = (env: string, yes: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: {
    castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, promptStyles: ["precise", "flexible"], ...(yes ? { promptWordings: ["current", "new"] } : {}) },
  },
})
const ALL_NEW = [withWording("production", true), withWording("staging", true)]
const SOME_NEW = [withWording("production", true), withWording("staging", false)]
const NONE_NEW = [withWording("production", false), withWording("staging", false)]

describe("the rules", () => {
  it("a trend is offered New once some environment's engine words it; the shared setting once every one does", () => {
    expect(someEnvironmentTakesNewWording(undefined)).toBe(false)
    expect(someEnvironmentTakesNewWording(NONE_NEW)).toBe(false)
    expect(someEnvironmentTakesNewWording(SOME_NEW)).toBe(true)
    expect(environmentsLackingNewWording(SOME_NEW)).toEqual(["staging"])
    expect(environmentsThatCannotUseNewWording(undefined)).toBeUndefined()
    expect(environmentsThatCannotUseNewWording(ALL_NEW)).toEqual([])
    expect(environmentsThatCannotUseNewWording(SOME_NEW)).toEqual(["staging"])
    // An environment with no recorded engine cannot.
    expect(environmentsThatCannotUseNewWording([ALL_NEW[0]!])).toEqual(["staging"])
  })

  it("the wording round-trips through the form, and a draft without one stays without", () => {
    expect(fromForm(toForm(detail({}, { promptStyle: "flexible", promptWording: "new" }).draft)).promptWording).toBe("new")
    expect(fromForm(toForm(detail({}, { promptWording: "current" }).draft)).promptWording).toBe("current")
    expect(fromForm(toForm(detail().draft))).not.toHaveProperty("promptWording")
  })

  it("the new publish refusal reads as a sentence", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "promptWording:new" })).toBe("production: the new Flex prompt wording not supported yet")
  })
})

describe("the editor", { timeout: 20_000 }, () => {
  beforeEach(() => {
    resetRoutes()
    vi.stubGlobal("fetch", fetchMock)
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: SOME_NEW } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  const renderEditor = () => renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
  const savedDraft = async () => {
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    return (sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>)[0]!.data
  }

  it("shows Current until chosen, offers New once some environment's engine words it, and saves it with the draft", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { promptStyle: "flexible" }) } })
    renderEditor()
    const select = await screen.findByRole("combobox", { name: "Wording" })
    expect(select).toHaveTextContent("Current (default)")
    await user.click(select)
    await user.click(await screen.findByRole("option", { name: "New" }))
    // Some environment lacks it: the trend says where it can't be published.
    expect(await screen.findByText(/Not supported yet by the Cast Swap engine of: staging\./)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    const saved = await savedDraft()
    expect(saved).toMatchObject({ promptStyle: "flexible", promptWording: "new" })
  })

  it("greys out New while no environment's engine words it", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: NONE_NEW } })
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { promptStyle: "flexible" }) } })
    renderEditor()
    const select = await screen.findByRole("combobox", { name: "Wording" })
    await waitFor(async () => {
      await user.click(select)
      expect(await screen.findByRole("option", { name: "New (no environment's engine words it yet)" })).toHaveAttribute("aria-disabled", "true")
    })
  })

  it("choosing Current again stores no key", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { promptStyle: "flexible", promptWording: "new" }) } })
    renderEditor()
    const select = await screen.findByRole("combobox", { name: "Wording" })
    expect(select).toHaveTextContent("New")
    await user.click(select)
    await user.click(await screen.findByRole("option", { name: "Current (default)" }))
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    expect(await savedDraft()).not.toHaveProperty("promptWording")
  })

  it("a Precise trend on New says the wording is not used", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { promptStyle: "precise", promptWording: "new" }) } })
    renderEditor()
    expect(await screen.findByText("This trend's prompt style is Precise: the wording is not used.")).toBeInTheDocument()
  })
})
