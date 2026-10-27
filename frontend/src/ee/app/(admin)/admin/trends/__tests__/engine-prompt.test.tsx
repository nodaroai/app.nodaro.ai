/**
 * Admin → Trends → one trend → 4. Prompts → Engine prompt.
 *
 * - Collapsed until opened: only then is the engine asked.
 * - One row per part the mode uses (its default greyed, the override, Reset),
 *   plus any part with a stored override; the assembled prompt with its
 *   length and limit.
 * - "Default changed" when a stored override's hash is not the engine's.
 * - Save sends the overrides with the held revision and adopts the next; a
 *   422 shows the engine's problems by their part, saving nothing.
 * - An engine without the route (503) reads as out of date.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { PromptPart, PromptPartsAnswer } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"

const BASE = `/v1/admin/trends/${TREND_ID}`
const HASH = "0123456789abcdef"

const part = (over: Partial<PromptPart> & Pick<PromptPart, "id">): PromptPart => ({
  default: `The ${over.id} line.`,
  defaultHash: HASH,
  placeholders: [],
  required: [],
  applies: true,
  ...over,
})

const ANSWER: PromptPartsAnswer = {
  set: "precise",
  parts: [
    part({ id: "opener", default: "edit {video:1} as follows:", placeholders: ["{video}"] }),
    part({ id: "face", default: "Keep the faces." }),
    part({ id: "person", default: "{name} from {image}.", placeholders: ["{name}", "{image}"], required: ["{image}"] }),
    part({ id: "avoid", applies: false }),
  ],
  assembled: "edit {video:1} as follows:\nKeep the faces.",
  length: 42,
  max: 8000,
  problems: [],
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

const section = () => screen.getByLabelText("Engine prompt")
const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole("button", { name: "Engine prompt" }))
const row = (name: string) => screen.getByRole("group", { name })

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}`] = () => ({ body: { data: detail() } })
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes[`GET ${BASE}/prompt-parts`] = () => ({ body: { data: { ...ANSWER, overrides: {}, revision: "rev-1" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("the trend's engine prompt", { timeout: 20_000 }, () => {
  it("asks the engine only once opened, and shows the parts the mode uses with their defaults and the assembled prompt", async () => {
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole("button", { name: "Engine prompt" })
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/prompt-parts"))).toBe(false)
    await open(user)
    expect(await screen.findByRole("group", { name: "Opening line" })).toBeInTheDocument()
    expect(within(row("Identity")).getByLabelText("Identity: the default")).toHaveTextContent("Keep the faces.")
    expect(within(row("Each person")).getByText(/Must keep: \{image\}/)).toBeInTheDocument()
    // A part the mode does not use, with no override, is not offered.
    expect(screen.queryByRole("group", { name: "Avoid list" })).not.toBeInTheDocument()
    expect(within(section()).getByLabelText("The assembled prompt")).toHaveTextContent("Keep the faces.")
    expect(within(section()).getByTestId("assembled-length")).toHaveTextContent("42 / 8000")
    expect(screen.getByRole("button", { name: "Save engine prompt" })).toBeDisabled()
  })

  it("flags a stored override written against another default, and keeps a part the mode no longer uses resettable", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}/prompt-parts`] = () => ({
      body: {
        data: {
          ...ANSWER,
          overrides: { face: { text: "Faces stay.", defaultHash: "fedcba9876543210" }, avoid: { text: "Avoid: text.", defaultHash: HASH } },
          problems: [{ part: "avoid", code: "part_not_used", message: "The avoid part is not used in this mode." }],
          revision: "rev-1",
        },
      },
    })
    renderEditor()
    await open(user)
    const face = await screen.findByRole("group", { name: "Identity" })
    expect(within(face).getByText("Default changed")).toBeInTheDocument()
    expect(within(face).getByLabelText("Identity: your text")).toHaveValue("Faces stay.")
    const avoid = row("Avoid list")
    expect(within(avoid).getByText("Not used in this mode")).toBeInTheDocument()
    expect(within(avoid).getByText("The avoid part is not used in this mode.")).toBeInTheDocument()
    expect(within(row("Opening line")).queryByText("Default changed")).not.toBeInTheDocument()
  })

  it("saves the overrides with the held revision, and adopts the next one", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/prompt-parts`] = () => ({
      body: { data: { version: 1, revision: "rev-2", ...ANSWER, assembled: "edit {video:1} as follows:\nFaces stay.", overrides: { face: { text: "Faces stay.", defaultHash: HASH } } } },
    })
    renderEditor()
    await open(user)
    await user.type(await screen.findByLabelText("Identity: your text"), "Faces stay.")
    await user.click(screen.getByRole("button", { name: "Save engine prompt" }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/prompt-parts`)).toEqual([{ parts: { face: "Faces stay." }, revision: "rev-1" }]))
    expect(await within(section()).findByText(/Faces stay\./, { selector: "pre" })).toBeInTheDocument()
    // The next save carries the revision this one moved the draft to.
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-3" } } })
    await user.type(screen.getByRole("textbox", { name: "Trend prompt" }), " More.")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect((sentTo(`PUT ${BASE}/draft`)[0] as { revision: string }).revision).toBe("rev-2"))
  })

  it("shows the engine's problems by their part, and saves nothing", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/prompt-parts`] = () => ({
      status: 422,
      body: {
        error: {
          code: "prompt_parts_invalid",
          message: "The person line needs {image}.",
          problems: [
            { part: "person", code: "missing_placeholder", message: "The person line needs {image}." },
            { part: "opener", code: "part_required", message: "opener is required" },
            { code: "prompt_too_long", message: "The prompt is too long for this engine." },
          ],
        },
      },
    })
    renderEditor()
    await open(user)
    const person = within(await screen.findByRole("group", { name: "Each person" })).getByLabelText("Each person: your text")
    await user.type(person, "{{name} dances")
    await user.type(screen.getByLabelText("Opening line: your text"), "-")
    await user.click(screen.getByRole("button", { name: "Save engine prompt" }))
    expect(await within(row("Each person")).findByText("The person line needs {image}.")).toBeInTheDocument()
    expect(within(row("Opening line")).getByText("This part is required in this mode.")).toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "Prompt problems" })).getByText("The prompt is too long for this engine.")).toBeInTheDocument()
    expect(screen.getByLabelText("Each person: your text")).toHaveValue("{name} dances")
  })

  it("says the engine is out of date when it cannot show its prompt parts", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}/prompt-parts`] = () => ({
      status: 503,
      body: { error: { code: "engine_unsupported", message: "This environment's Cast Swap engine is out of date: it cannot show or check prompt parts yet." } },
    })
    renderEditor()
    await open(user)
    expect(await screen.findByText(/Cast Swap engine is out of date: it can't show or check the engine prompt yet/)).toBeInTheDocument()
  })

  it("waits while the form has unsaved edits", async () => {
    const user = userEvent.setup()
    renderEditor()
    await open(user)
    await user.type(await screen.findByLabelText("Identity: your text"), "Faces stay.")
    await user.type(screen.getByRole("textbox", { name: "Trend prompt" }), " More.")
    expect(screen.getByRole("button", { name: "Save engine prompt" })).toBeDisabled()
    expect(screen.getByText(/Save the draft first: the engine reads the saved draft/)).toBeInTheDocument()
  })
})
