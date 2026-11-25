/**
 * Admin → Video Remake → Engine prompt: per engine, Precise and Motion tabs
 * with the trend editor's rows (no "default changed": the setting stores
 * text only). Each tab previews its edits with the engine; Save sends the
 * whole setting, keyed by public engine id and style, and a refusal shows
 * each problem in its own engine and style.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { scaledTimeout } from "../../../../../../../../tools/vitest/ci-limits.mjs"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import type { PromptPartsAnswer } from "@/lib/api"
import { fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { promptPartsToSave } from "../components/PromptPartsTabs"

const URL = "/v1/admin/video-remake/prompt-parts"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]

function answer(style: string, face = "Keep the faces."): PromptPartsAnswer {
  return {
    set: style === "motion" ? "flexible" : "precise",
    parts: [
      { id: "opener", default: `${style} opener`, defaultHash: "0123456789abcdef", placeholders: ["{video}"], required: [], applies: true },
      { id: "face", default: "Keep the faces.", defaultHash: "0123456789abcdef", placeholders: [], required: [], applies: true },
    ],
    assembled: `${style} opener\n${face}`,
    length: 30,
    max: 8000,
    problems: [],
  }
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/video-remake/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  // The Style choice (style.test.tsx): never saved, people choose on every engine.
  routes["GET /v1/admin/video-remake/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  // The page's Advanced switch (advanced.test.tsx): never saved, hidden.
  routes["GET /v1/admin/video-remake/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  // The custom style (custom-style.test.tsx): never saved, and an engine that takes none (nothing more is asked).
  routes["GET /v1/admin/video-remake/custom-style"] = () => ({ body: { data: { customStyle: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes["GET /v1/admin/video-remake/plan-roles"] = () => ({ body: { data: { planRoles: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  // The 3D previz clips and the shot lock (previz-shot-lock.test.tsx): never saved, and an engine that takes neither.
  routes["GET /v1/admin/video-remake/previz"] = () => ({ body: { data: { previz: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes["GET /v1/admin/video-remake/shot-lock"] = () => ({ body: { data: { shotLock: null, updatedAt: null, engines: ENGINES, supported: false } } })
  // The shot list's frame rate (shot-list-fps.test.tsx): never saved, and an engine that reads none.
  routes["GET /v1/admin/video-remake/shot-list-fps"] = () => ({ body: { data: { shotListFps: null, fps: 6, defaultFps: 6, options: [1, 2, 3, 4, 6, 8, 12], updatedAt: null, supported: false, rateCarried: true } } })
  // Offer Flash (flash-offer.test.tsx): never saved, on an engine that runs the Flash choices.
  routes["GET /v1/admin/video-remake/flash-offer"] = () => ({ body: { data: { flashOffer: null, updatedAt: null, engines: [{ id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5", flashName: "Nodaro Prism Flash" }, { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4", flashName: "Nodaro Pulse Flash" }], supported: true, environments: [] } } })
  // The Precise upscale (precise-upscale.test.tsx): never saved, every default.
  routes["GET /v1/admin/video-remake/precise-upscale"] = () => ({ body: { data: { value: { "480p": "1080p", "720p": "1080p", "1080p": "4k" }, stored: null, defaults: { "480p": "1080p", "720p": "1080p", "1080p": "4k" }, updatedAt: null, supported: true } } })
  routes[`GET ${URL}`] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes["GET /v1/admin/video-remake/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes[`POST ${URL}/preview`] = (init) => {
    const body = JSON.parse(String(init?.body)) as { style: string; overrides?: { face?: string } }
    return { body: { data: answer(body.style, body.overrides?.face) } }
  }
})
afterEach(() => vi.unstubAllGlobals())

const engineSection = async (name: string) =>
  (await screen.findByRole("heading", { name: new RegExp(`^Engine prompt: ${name}`) })).closest("section") as HTMLElement

describe("Admin → Video Remake → Engine prompt", { timeout: scaledTimeout(20_000) }, () => {
  it("promptPartsToSave drops empty texts, styles and engines", () => {
    expect(promptPartsToSave({ "nodaro-prism": { precise: { face: "" }, motion: { face: "x", avoid: " " } }, "nodaro-pulse": { precise: {} } })).toEqual({
      "nodaro-prism": { motion: { face: "x" } },
    })
  })

  it("shows each engine's Precise and Motion tabs with the engine's parts, previewing the edits, with no default-changed flag", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Prism")
    expect(within(prism).getByRole("tab", { name: "Precise" })).toHaveAttribute("aria-selected", "true")
    expect(await within(prism).findByText("precise opener", { selector: "p" })).toBeInTheDocument()
    // The Motion tab names the prompt style its parts are: Flexible, until the Motion setting says otherwise.
    await user.click(within(prism).getByRole("tab", { name: "Motion (Flexible prompt)" }))
    expect(await within(prism).findByText("motion opener", { selector: "p" })).toBeInTheDocument()
    const face = within(prism).getByLabelText("Identity: your text")
    await user.type(face, "Faces stay.")
    await waitFor(() => expect(within(prism).getByLabelText("The assembled prompt")).toHaveTextContent("Faces stay."), { timeout: 3000 })
    expect(sentTo(`POST ${URL}/preview`)).toContainEqual({ engine: "nodaro-prism", style: "motion", overrides: { face: "Faces stay." } })
    expect(within(prism).queryByText("Default changed")).not.toBeInTheDocument()
  })

  it("names the Motion tab after the saved Motion setting's prompt style, per engine", async () => {
    routes["GET /v1/admin/video-remake/motion"] = () => ({
      body: { data: { motion: { "nodaro-pulse": { promptStyle: "precise" } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await engineSection("Nodaro Pulse")
    expect(await within(pulse).findByRole("tab", { name: "Motion (Precise prompt)" })).toBeInTheDocument()
    const prism = await engineSection("Nodaro Prism")
    expect(within(prism).getByRole("tab", { name: "Motion (Flexible prompt)" })).toBeInTheDocument()
  })

  it("saves the whole setting, keyed by public engine id and style", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { promptParts: JSON.parse(String(init?.body)).promptParts, updatedAt: "2026-10-27T12:00:00.000Z", engines: ENGINES, styles: ["precise", "motion"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await engineSection("Nodaro Pulse")
    await user.type(await within(pulse).findByLabelText("Identity: your text"), "Faces stay.")
    await user.click(screen.getByRole("button", { name: "Save engine prompts" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ promptParts: { "nodaro-pulse": { precise: { face: "Faces stay." } } } }]))
    // Masking's own Save is untouched.
    expect(sentTo("PUT /v1/admin/video-remake/masking")).toEqual([])
  })

  it("shows a refusal's problems in their own engine and style", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL}`] = () => ({
      status: 422,
      body: {
        error: {
          code: "prompt_parts_invalid",
          message: "x",
          problems: [{ part: "opener", code: "part_required", message: "opener is required", engine: "nodaro-prism", style: "precise" }],
        },
      },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Prism")
    await user.type(await within(prism).findByLabelText("Opening line: your text"), "-")
    await user.click(screen.getByRole("button", { name: "Save engine prompts" }))
    expect(await within(prism).findByText("This part is required in this mode.")).toBeInTheDocument()
    expect(within(prism).getByRole("tab", { name: "Precise (1)" })).toBeInTheDocument()
    const pulse = await engineSection("Nodaro Pulse")
    expect(within(pulse).queryByText("This part is required in this mode.")).not.toBeInTheDocument()
  })

  it("says the engine is out of date when it cannot preview", async () => {
    routes[`POST ${URL}/preview`] = () => ({ status: 503, body: { error: { code: "engine_unsupported", message: "old" } } })
    renderWith(<AdminNodaroMotionPage />)
    expect((await screen.findAllByText(/Cast Swap engine is out of date/)).length).toBeGreaterThan(0)
  })
})
