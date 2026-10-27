/**
 * Admin → Trends → one trend: the prompt style (4. Prompts) and Full depth's
 * scene source (6. Face masking).
 *
 * - The pure rules (prompt-style.ts, `cleanMasking`, `withClipPreparation`,
 *   `fromForm`): the style left out is the clip preparation's default; the
 *   scene is Full depth's alone; the original with a clip over 27.5 s is
 *   said, never held at Save.
 * - The editor: a Prompt style select ("(default)" for the preparation's),
 *   saved only when it is not the default; Full depth's "Scene from" select,
 *   saved as `faceMasking.scene` (a description = no key).
 * - The new publish refusals read as sentences.
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
import { withClipPreparation } from "../clip-preparation"
import { cleanMasking, describeBlocker, fromForm, toForm } from "../model"
import {
  ORIGINAL_SCENE_MAX_SEC,
  defaultPromptStyleOf,
  environmentsLackingScene,
  environmentsLackingStyle,
  originalSceneTooLong,
  promptStyleOfForm,
} from "../prompt-style"

const BASE = `/v1/admin/trends/${TREND_ID}`
const FULL = { mode: "always" as const, source: "full-depth" as const }

const STYLE_ENVS: TrendEngineEnvironment[] = ENVIRONMENTS.map((e) => ({
  ...e,
  supports: {
    castSwap: {
      ...e.supports.castSwap,
      sourceModes: ["faces", "full-depth", "keep-people"],
      promptStyles: ["precise", "flexible"],
      fullDepthScenes: ["description", "original", "none"],
    },
  },
}))

describe("the rules", () => {
  it("the prompt style left out is the clip preparation's: Flexible for Full depth, Precise otherwise", () => {
    expect(defaultPromptStyleOf(undefined)).toBe("precise")
    expect(defaultPromptStyleOf({ mode: "always" })).toBe("precise")
    expect(defaultPromptStyleOf({ mode: "always", source: "keep-people" })).toBe("precise")
    expect(defaultPromptStyleOf(FULL)).toBe("flexible")
    expect(promptStyleOfForm({ faceMasking: FULL, promptStyle: "precise" })).toBe("precise")
  })

  it("the original with a clip over the limit is too long; the other scenes and preparations never are", () => {
    expect(ORIGINAL_SCENE_MAX_SEC).toBe(27.5)
    expect(originalSceneTooLong({ ...FULL, scene: "original" }, 27.5)).toBe(false)
    expect(originalSceneTooLong({ ...FULL, scene: "original" }, 27.9)).toBe(true)
    expect(originalSceneTooLong(FULL, 60)).toBe(false)
    expect(originalSceneTooLong({ mode: "always" }, 60)).toBe(false)
  })

  it("names the environments that lack a style other than the default, or a scene (an engine before scenes: the original only)", () => {
    expect(environmentsLackingStyle("precise", undefined, ENVIRONMENTS)).toEqual([])
    expect(environmentsLackingStyle("flexible", undefined, ENVIRONMENTS)).toEqual(ENVIRONMENTS.map((e) => e.env))
    expect(environmentsLackingStyle("flexible", FULL, ENVIRONMENTS)).toEqual([])
    expect(environmentsLackingStyle("flexible", undefined, STYLE_ENVS)).toEqual([])
    expect(environmentsLackingScene("original", ENVIRONMENTS)).toEqual([])
    expect(environmentsLackingScene("description", ENVIRONMENTS)).toEqual(ENVIRONMENTS.map((e) => e.env))
    expect(environmentsLackingScene("none", STYLE_ENVS)).toEqual([])
  })

  it("the scene is saved with Full depth only, and dropped on leaving it", () => {
    expect(cleanMasking({ ...FULL, scene: "none" })).toEqual({ ...FULL, scene: "none" })
    expect(cleanMasking({ mode: "always", scene: "none" })).toEqual({ mode: "always" })
    expect(withClipPreparation({ ...FULL, scene: "original" }, "faces").masking).toEqual({ mode: "always" })
    expect(withClipPreparation({ ...FULL, scene: "original" }, "keep-people").masking).toEqual({ mode: "always", source: "keep-people" })
  })

  it("the prompt style round-trips through the form, and a draft without one stays without", () => {
    const form = toForm(detail({}, { promptStyle: "flexible" }).draft)
    expect(fromForm(form).promptStyle).toBe("flexible")
    expect(fromForm(toForm(detail().draft))).not.toHaveProperty("promptStyle")
  })

  it("the new publish refusals read as sentences", () => {
    expect(describeBlocker({ code: "prompt_style_unsupported", env: "production", need: "promptStyle:flexible" })).toMatch(/^production: the Flexible prompt style not supported yet/)
    expect(describeBlocker({ code: "full_depth_scene_unsupported", env: "staging", need: "scene:description" })).toMatch(/^staging: the Full depth scene "Description \(automatic\)" not supported yet/)
    expect(describeBlocker({ code: "full_depth_clip_too_long", message: "The source clip is 29.5 s." })).toBe("The source clip is 29.5 s.")
  })
})

describe("the editor", { timeout: 20_000 }, () => {
  beforeEach(() => {
    resetRoutes()
    vi.stubGlobal("fetch", fetchMock)
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: STYLE_ENVS } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  const renderEditor = () => renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
  const savedDraft = async () => {
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    return (sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>)[0]!.data
  }

  it("the prompt style shows the preparation's default and saves another choice", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail() } })
    renderEditor()
    const select = await screen.findByRole("combobox", { name: "Prompt style" })
    expect(select).toHaveTextContent("Precise (default)")
    await user.click(select)
    await user.click(screen.getByRole("option", { name: "Flexible" }))
    expect(screen.getByText(/takes the rest from the pictures and the text/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    expect((await savedDraft()).promptStyle).toBe("flexible")
  })

  it("names the environments whose engine lacks the chosen style", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
    routes[`GET ${BASE}`] = () => ({ body: { data: detail() } })
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Prompt style" }))
    await user.click(screen.getByRole("option", { name: "Flexible" }))
    expect(await screen.findByText(/Not supported yet by the Cast Swap engine of/)).toBeInTheDocument()
  })

  it("Full depth: the scene comes from a description by default, and another choice is saved", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: FULL }) } })
    renderEditor()
    expect(await screen.findByRole("combobox", { name: "Prompt style" })).toHaveTextContent("Flexible (default)")
    const scene = await screen.findByRole("combobox", { name: "Scene from" })
    expect(scene).toHaveTextContent("Description (automatic)")
    await user.click(scene)
    await user.click(screen.getByRole("option", { name: "Original video (up to 27.5 s)" }))
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    expect((await savedDraft()).faceMasking).toEqual({ ...FULL, scene: "original" })
  })

  it("Full depth with the original and a long clip says so, without holding Save", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "none", reasons: [] } },
          { faceMasking: { ...FULL, scene: "original" }, source: { videoUrl: "https://cdn.test/trends/a1/src.mp4", durationSec: 29.5, width: 720, height: 1280 } },
        ),
      },
    })
    renderEditor()
    expect(await screen.findByText(/The clip is 29\.5 s: the original takes clips up to 27\.5 s/)).toBeInTheDocument()
  })

  it("a face mask has no scene", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    renderEditor()
    await screen.findByRole("combobox", { name: "Clip preparation" })
    expect(screen.queryByRole("combobox", { name: "Scene from" })).not.toBeInTheDocument()
  })
})
