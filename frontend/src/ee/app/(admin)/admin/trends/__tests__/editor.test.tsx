/**
 * Admin → Trends → one trend: what an admin relies on.
 *
 * - Save sends the edited draft (never its examples, which only the example
 *   routes write) with the revision the screen read.
 * - A stale revision (409 `draft_conflict`) reloads the trend and says so.
 * - Publish refused (409 `publish_blocked`) lists every reason readably.
 * - "Use as example" promotes exactly that run; "Show prompt" shows the
 *   engine prompt and the trend's prompt parts, Full or 4 s preview.
 * - Each prompt part has its 4 s preview version, shown while the trend
 *   offers a preview (the fallback as placeholder) and kept when it does not.
 * - The image counter shows N / 30 and, above 30, an error and no Save.
 * - The 4 s preview's input clip (server-made on save) is shown under the
 *   window and played from its own file; it is never in a save's body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { toast } from "sonner"
import type { AdminTrendPreviewClip, AdminTrendSlot } from "@/lib/api"
import {
  detail,
  ENVIRONMENTS,
  fetchMock,
  renderWith,
  resetRoutes,
  routes,
  run,
  RUN_ID,
  sentTo,
  slot,
  TREND_ID,
} from "./harness"
import AdminTrendEditorPage from "../detail/page"

const BASE = `/v1/admin/trends/${TREND_ID}`
/** The slot's role name field (its label holds its help line too), not its 4 s preview one. */
const ROLE_NAME = /^role name(?! in the 4 s preview)/i

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.warning).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}`] = () => ({ body: { data: detail() } })
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
})
afterEach(() => vi.unstubAllGlobals())

// Every test renders the whole editor page (slots, references, test runs,
// examples, publish bar) in jsdom and queries it by role; on a loaded CI shard
// these tests took 1–4s each and the 11-slot cap test 5.2s against the 5s
// default. The room is for the machine, not a hang.
describe("the trend editor", { timeout: 20_000 }, () => {
  it("saves the draft with the slots edited and the revision it read", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    const roleName = await screen.findByLabelText(ROLE_NAME)
    await user.clear(roleName)
    await user.type(roleName, "the man in the hat")
    await user.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown>; revision: string }>
    expect(body.revision).toBe("rev-1")
    expect(body.data.slots).toEqual([{ ...slot(), roleName: "the man in the hat" }])
    expect(body.data).not.toHaveProperty("examples")
    expect(body.data.name).toEqual({ en: "Office dance" })
    expect(body.data.source).toEqual(detail().draft.source)
  })

  it("hides a chip from people with its switch and saves the chips still shown", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    const hair = await screen.findByRole("switch", { name: "Slot 1 Hair shown to people" })
    expect(hair).toBeChecked()
    await user.click(hair)
    expect(hair).not.toBeChecked()
    expect(screen.getByText("Hidden: fixed at New")).toBeInTheDocument()
    await user.click(screen.getByRole("switch", { name: "Slot 1 Body shown to people" }))
    expect(screen.getAllByText("Hidden: fixed at New")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: { slots: AdminTrendSlot[] } }>
    expect(body.data.slots).toEqual([{ ...slot(), chips: ["outfit"] }])
  })

  it("shows a stored hidden chip as hidden, fixed at its value", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots: [slot({ defaults: { hair: "original" }, chips: ["body", "outfit"] })] }) } })
    renderEditor()
    expect(await screen.findByRole("switch", { name: "Slot 1 Hair shown to people" })).not.toBeChecked()
    expect(screen.getByRole("switch", { name: "Slot 1 Body shown to people" })).toBeChecked()
    expect(screen.getByText("Hidden: fixed at Keep original")).toBeInTheDocument()
  })

  it("a test run can set every chip, marks the hidden ones, and sends the chips set", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots: [slot({ chips: ["outfit"] })] }) } })
    routes[`POST ${BASE}/test-runs`] = () => ({ status: 202, body: { data: { jobId: RUN_ID } } })
    renderEditor()

    const hair = await screen.findByRole("combobox", { name: "Test dancer Hair" })
    expect(hair).toHaveTextContent("Slot's value (New)")
    expect(screen.getByRole("combobox", { name: "Test dancer Outfit" })).toBeInTheDocument()
    const hiddenCells = ["body", "hair"].map((c) => document.querySelector(`[data-test-chip="dancer.${c}"]`) as HTMLElement)
    for (const cell of hiddenCells) expect(within(cell).getByText("Hidden from people")).toBeInTheDocument()
    const outfitCell = document.querySelector('[data-test-chip="dancer.outfit"]') as HTMLElement
    expect(within(outfitCell).queryByText("Hidden from people")).not.toBeInTheDocument()

    await user.click(hair)
    await user.click(screen.getByRole("option", { name: "Keep original" }))
    await user.type(screen.getByLabelText("Pictures for dancer (0 / 3): URL"), "https://u.example/me.png{Enter}")
    await user.click(screen.getByRole("button", { name: /run test/i }))

    await waitFor(() => expect(sentTo(`POST ${BASE}/test-runs`)).toHaveLength(1))
    const [body] = sentTo(`POST ${BASE}/test-runs`) as Array<{ slots: Record<string, Record<string, unknown>> }>
    expect(body.slots).toEqual({ dancer: { images: ["https://u.example/me.png"], hair: "original" } })
  })

  it("saves the pre prompt and the face masking setting as edited, and nothing more", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "auto", fill: "depth" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()

    await user.type(await screen.findByLabelText("Pre prompt"), "Open on the stage.")
    const threshold = screen.getByLabelText("Detection threshold")
    expect(threshold).toHaveAttribute("placeholder", "0.5")
    await user.type(threshold, "0.4")
    await user.type(screen.getByLabelText("Top"), "5")
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveTextContent("Auto")
    await user.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.prePrompt).toBe("Open on the stage.")
    // Typing a margin into the default zone keeps the default's other margins.
    expect(body.data.faceMasking).toEqual({
      mode: "auto",
      fill: "depth",
      zone: { leftPct: 10, rightPct: 10, topPct: 5, bottomPct: 0 },
      threshold: 0.4,
    })
  })

  it("shows Seedance 2.5 for a draft that names no model, unchanged until a model is chosen", async () => {
    renderEditor()
    const model = await screen.findByRole("combobox", { name: "Model" })
    expect(model).toHaveTextContent("Seedance 2.5")
    expect(screen.getByText("Model", { selector: "label" })).toHaveAttribute("for", model.id)
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
  })

  it("saves Kling 4 as the model when chosen", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Model" }))
    await user.click(screen.getByRole("option", { name: "Nodaro Motion Pulse (Kling 4)" }))
    expect(screen.getByText(/720p or 1080p, with no draft/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.engine).toBe("kling-4")
  })

  it("shows Length only for Kling 4, and saves the one chosen", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    await screen.findByRole("combobox", { name: "Model" })
    expect(screen.queryByRole("combobox", { name: "Length" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(screen.getByRole("option", { name: "Nodaro Motion Pulse (Kling 4)" }))
    const length = screen.getByRole("combobox", { name: "Length" })
    expect(length).toHaveTextContent("Cut the end to whole seconds")
    await user.click(length)
    await user.click(screen.getByRole("option", { name: "Cut the start to whole seconds" }))
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).toMatchObject({ engine: "kling-4", klingLength: "cut-start" })
  })

  it("shows Pulse audio only for Kling 4 (Original audio by default), and saves the one chosen", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    await screen.findByRole("combobox", { name: "Model" })
    expect(screen.queryByRole("combobox", { name: "Pulse audio" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(screen.getByRole("option", { name: "Nodaro Motion Pulse (Kling 4)" }))
    const audio = screen.getByRole("combobox", { name: "Pulse audio" })
    expect(audio).toHaveTextContent("Original audio (default)")
    expect(screen.getByText("The original audio goes back on the result, exactly")).toBeInTheDocument()
    await user.click(audio)
    await user.click(screen.getByRole("option", { name: "Kling's audio" }))
    expect(screen.getByText("Kling keeps the clip's sound and its own track is delivered as is")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).toMatchObject({ engine: "kling-4", pulseAudio: "generated" })
    // Back on Seedance 2.5 the select goes away.
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(screen.getByRole("option", { name: /Prism/ }))
    expect(screen.queryByRole("combobox", { name: "Pulse audio" })).not.toBeInTheDocument()
  })

  it("shows Prism reference audio only for Prism (Full audio by default), and saves the one chosen", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    await screen.findByRole("combobox", { name: "Model" })
    // A draft naming no engine is Prism: the select is there from the start.
    const audio = screen.getByRole("combobox", { name: "Prism reference audio" })
    expect(audio).toHaveTextContent("Full audio (default)")
    expect(screen.getByText("What the engine hears in the reference video. The original audio always goes back on the result.")).toBeInTheDocument()
    await user.click(audio)
    await user.click(screen.getByRole("option", { name: "No audio" }))
    expect(audio).toHaveTextContent("No audio")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).toMatchObject({ prismReferenceAudio: "none" })
    // On Pulse the select goes away.
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(screen.getByRole("option", { name: "Nodaro Motion Pulse (Kling 4)" }))
    expect(screen.queryByRole("combobox", { name: "Prism reference audio" })).not.toBeInTheDocument()
  })

  it("a saved Kling 4 draft tests at 720p or 1080p with no draft switch, and sends no draft", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { engine: "kling-4" }) } })
    routes[`POST ${BASE}/test-runs`] = () => ({ status: 202, body: { data: { jobId: RUN_ID } } })
    renderEditor()
    const group = await screen.findByRole("group", { name: "Resolution" })
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["720p", "1080p"])
    expect(within(group).getByRole("button", { name: "720p" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("switch", { name: "Draft" })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText("Pictures for dancer (0 / 3): URL"), "https://u.example/me.png{Enter}")
    await user.click(screen.getByRole("button", { name: /run test/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/test-runs`)).toHaveLength(1))
    const [body] = sentTo(`POST ${BASE}/test-runs`) as Array<Record<string, unknown>>
    expect(body.resolution).toBe("720p")
    expect(body).not.toHaveProperty("draft")
  })

  it("holds Save while a face masking value is out of range", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    renderEditor()
    await user.type(await screen.findByLabelText("Detection threshold"), "2")
    expect(await screen.findByText(/the detection threshold is 0.05–0.95/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
  })

  it("shows masking off, with no settings, for a draft without one", async () => {
    renderEditor()
    expect(await screen.findByRole("combobox", { name: "Mode" })).toHaveTextContent("Off")
    expect(screen.queryByLabelText("Detection threshold")).not.toBeInTheDocument()
  })

  it("labels each prompt with its visible label and describes it with its help line", async () => {
    renderEditor()
    const pre = await screen.findByRole("textbox", { name: "Pre prompt" })
    expect(pre).toHaveAccessibleDescription("Placed at the start of the prompt, before the slots.")
    // The trend prompt is described by its help line, then by the room left for it.
    expect(screen.getByRole("textbox", { name: "Trend prompt" })).toHaveAccessibleDescription(
      "Placed at the end of the prompt, before the user's own details. " +
        "2976 characters left for the trend prompt, keeping room for the user's details (up to 1000).",
    )
  })

  it("shows the room left for the trend prompt after the user's details, and updates it while typing", async () => {
    const user = userEvent.setup()
    renderEditor()
    // The harness draft's trend prompt is "Keep the camera moves." (22 characters): 2998 − 22.
    expect(await screen.findByText("2976 characters left for the trend prompt, keeping room for the user's details (up to 1000).")).toBeInTheDocument()
    const trend = screen.getByRole("textbox", { name: "Trend prompt" })
    await user.type(trend, "abc")
    expect(screen.getByText(/2973 characters left for the trend prompt/)).toBeInTheDocument()
    expect(trend).toHaveAccessibleDescription(/2973 characters left for the trend prompt/)
    // The trend prompt's counter counts to the limit that leaves the details their room.
    expect(screen.getByText("25 / 2998")).toBeInTheDocument()
  })

  it("names the face masking selects by their visible labels", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    renderEditor()
    const mode = await screen.findByRole("combobox", { name: "Mode" })
    expect(screen.getByText("Mode", { selector: "label" })).toHaveAttribute("for", mode.id)
    const fill = screen.getByRole("combobox", { name: "Fill" })
    expect(screen.getByText("Fill", { selector: "label" })).toHaveAttribute("for", fill.id)
  })

  it("a blur strength hidden by switching away from blur never holds Save, and is not saved", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always", fill: "blur" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    await user.type(await screen.findByLabelText("Blur strength (%)"), "9")
    expect(await screen.findByText(/the blur strength is 0.1–5/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()

    await user.click(screen.getByRole("combobox", { name: "Fill" }))
    await user.click(screen.getByRole("option", { name: "Depth colors" }))
    expect(screen.queryByLabelText("Blur strength (%)")).not.toBeInTheDocument()
    expect(screen.queryByText(/the blur strength is/)).not.toBeInTheDocument()
    const save = screen.getByRole("button", { name: /save draft/i })
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.faceMasking).toEqual({ mode: "always", fill: "depth" })
  })

  it("shows blur as the fill when the setting leaves it out (the engine's default), with its strength, and saves no fill", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    expect(await screen.findByRole("combobox", { name: "Fill" })).toHaveTextContent("Blur (default)")
    expect(screen.getByLabelText("Blur strength (%)")).toHaveAttribute("placeholder", "2")
    await user.type(screen.getByLabelText("Pre prompt"), "x")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.faceMasking).toEqual({ mode: "always" })
  })

  it("shows Head as what the masks cover when the setting leaves it out, says what it does, and saves no target", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    const covers = await screen.findByRole("combobox", { name: "Covers" })
    expect(screen.getByText("Covers", { selector: "label" })).toHaveAttribute("for", covers.id)
    expect(covers).toHaveTextContent("Head (default)")
    expect(covers).toHaveAccessibleDescription(/also hides the hair and people seen from behind/)
    await user.type(screen.getByLabelText("Pre prompt"), "x")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.faceMasking).toEqual({ mode: "always" })
  })

  it("saves Face when chosen, and says the hair stays visible", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "auto" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Covers" }))
    await user.click(screen.getByRole("option", { name: "Face" }))
    const covers = screen.getByRole("combobox", { name: "Covers" })
    expect(covers).toHaveTextContent("Face")
    expect(covers).toHaveAccessibleDescription(/the hair stays visible/)
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.faceMasking).toEqual({ mode: "auto", target: "face" })
  })

  it("hides what the masks cover while masking is off", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "off" } }) } })
    renderEditor()
    await screen.findByRole("combobox", { name: "Mode" })
    expect(screen.queryByRole("combobox", { name: "Covers" })).not.toBeInTheDocument()
  })

  it("shows the blur strength only for the blur fill", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always", fill: "depth" } }) } })
    renderEditor()
    expect(await screen.findByRole("combobox", { name: "Fill" })).toHaveTextContent("Depth colors")
    // The blur strength belongs to the blur fill only.
    expect(screen.queryByLabelText("Blur strength (%)")).not.toBeInTheDocument()
  })

  it("shows the default margins (10 % left and right) when the zone is left out, and saves no zone", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    expect(await screen.findByLabelText("Left")).toHaveAttribute("placeholder", "10")
    expect(screen.getByLabelText("Right")).toHaveAttribute("placeholder", "10")
    expect(screen.getByLabelText("Top")).toHaveAttribute("placeholder", "0")
    expect(screen.getByLabelText("Bottom")).toHaveAttribute("placeholder", "0")
    expect(screen.getByRole("checkbox", { name: /no margins/i })).not.toBeChecked()
    await user.type(screen.getByLabelText("Pre prompt"), "x")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.faceMasking).toEqual({ mode: "always" })
  })

  it("the first margin typed keeps the default's other margins, so the saved zone is what the fields show", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    await user.type(await screen.findByLabelText("Top"), "5")
    expect(screen.getByLabelText("Left")).toHaveValue(10)
    expect(screen.getByLabelText("Right")).toHaveValue(10)
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.faceMasking).toEqual({ mode: "always", zone: { leftPct: 10, rightPct: 10, topPct: 5, bottomPct: 0 } })
  })

  it("lets the creator turn the margins off (zone: null), and back to the default", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always" } }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    await user.click(await screen.findByRole("checkbox", { name: /no margins/i }))
    expect(screen.getByRole("checkbox", { name: /no margins/i })).toBeChecked()
    expect(screen.queryByLabelText("Left")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [off] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(off.data.faceMasking).toEqual({ mode: "always", zone: null })

    await user.click(screen.getByRole("checkbox", { name: /no margins/i }))
    expect(screen.getByLabelText("Left")).toHaveAttribute("placeholder", "10")
  })

  it("Off after ticking and unticking No margins saves no masking setting at all", async () => {
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    const noMargins = await screen.findByRole("checkbox", { name: /no margins/i })
    await user.click(noMargins)
    await user.click(screen.getByRole("checkbox", { name: /no margins/i }))
    await user.click(screen.getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Off" }))
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveTextContent("Off")
    await user.type(screen.getByLabelText("Pre prompt"), "x")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.prePrompt).toBe("x")
    expect(body.data).not.toHaveProperty("faceMasking")
  })

  it("Off after typing a margin and emptying them all saves no masking setting at all", async () => {
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    const user = userEvent.setup()
    renderEditor()
    await user.click(await screen.findByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Always" }))
    await user.type(await screen.findByLabelText("Top"), "5")
    for (const side of ["Left", "Right", "Top", "Bottom"]) await user.clear(screen.getByLabelText(side))
    expect(screen.getByLabelText("Left")).toHaveAttribute("placeholder", "10")
    await user.click(screen.getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Off" }))
    await user.type(screen.getByLabelText("Pre prompt"), "x")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).not.toHaveProperty("faceMasking")
  })

  it("shows a stored null zone as no margins", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { faceMasking: { mode: "always", zone: null } }) } })
    renderEditor()
    expect(await screen.findByRole("checkbox", { name: /no margins/i })).toBeChecked()
    expect(screen.queryByLabelText("Left")).not.toBeInTheDocument()
  })

  it("reloads the trend and says so when the draft changed elsewhere", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({
      status: 409,
      body: { error: { code: "draft_conflict", message: "The draft changed since it was loaded." } },
    })
    renderEditor()
    const roleName = await screen.findByLabelText(ROLE_NAME)
    await user.clear(roleName)
    await user.type(roleName, "mine")
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ revision: "rev-9" }, { slots: [slot({ roleName: "theirs" })] }) },
    })
    await user.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("This trend changed elsewhere — reloaded."))
    await waitFor(() => expect(screen.getByLabelText(ROLE_NAME)).toHaveValue("theirs"))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("lists every reason a publish was refused", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/publish`] = () => ({
      status: 409,
      body: {
        error: {
          code: "publish_blocked",
          message: "This trend cannot be published yet.",
          reasons: [
            { code: "engine_unsupported", env: "production", need: "pet" },
            { code: "engine_unknown", env: "staging" },
            { code: "example_slots_incomplete", example: 2, slots: ["dog"] },
          ],
        },
      },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /^publish$/i }))

    const reasons = await screen.findByRole("list", { name: /why it can't be published/i })
    expect(within(reasons).getByText(/production: pet slots not supported/i)).toBeInTheDocument()
    expect(within(reasons).getByText(/staging: engine not reported yet/i)).toBeInTheDocument()
    expect(within(reasons).getByText(/example 2 has no pictures for: dog/i)).toBeInTheDocument()
    expect(sentTo(`POST ${BASE}/publish`)).toEqual([{ revision: "rev-1" }])
  })

  it("promotes a run with \"Use as example\"", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/examples`] = () => ({
      status: 201,
      body: { data: { version: 1, revision: "rev-3", index: 0, example: {} } },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /use as example/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/examples`)).toEqual([{ jobId: RUN_ID }]))
  })

  it("plays a run in a tall frame, with Fullscreen and Copy link", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    HTMLVideoElement.prototype.requestFullscreen = requestFullscreen
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /copy link/i }))
    expect(writeText).toHaveBeenCalledWith("https://cdn.test/out.mp4")
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link copied"))
    await user.click(screen.getByRole("button", { name: /fullscreen/i }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    const video = document.querySelector(`video[src="https://cdn.test/out.mp4"]`)
    expect(video).toHaveClass("h-52", "object-contain")
  })

  it("shows a refused promotion's message", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/examples`] = () => ({
      status: 409,
      body: { error: { code: "not_admin_run", message: "Only a run made by an admin account can be an example." } },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /use as example/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only a run made by an admin account can be an example."))
    // Once: the app-wide mutation toast does not repeat it.
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it("marks a Full Quality version as such, with the draft it came from", async () => {
    routes[`GET ${BASE}/test-runs`] = () => ({
      body: { data: [run({ jobId: "fq-1", resolution: "1080p", draft: false, fullQualityOf: RUN_ID }), run()] },
    })
    renderEditor()
    const badge = await screen.findByTitle(`Full Quality version of run ${RUN_ID}`)
    expect(badge).toHaveTextContent("Full Quality")
    // Only the Full Quality run carries it, not its draft.
    expect(screen.getAllByTitle(/^Full Quality version of run/)).toHaveLength(1)
  })

  it("Copy inputs fills the test form with a run's pictures, chips and details, and Run test sends them", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots: [slot({ chips: ["outfit"] })] }) } })
    routes[`GET ${BASE}/test-runs`] = () => ({
      body: {
        data: [
          run({
            details: "slower, please",
            slots: [
              { key: "dancer", label: "Dancer", kind: "person", images: ["https://cdn.test/me.png"], fromExample: false, hair: "original" },
              { key: "gone", label: "Removed slot", kind: "person", images: ["https://cdn.test/x.png"], fromExample: false },
            ],
          }),
        ],
      },
    })
    routes[`POST ${BASE}/test-runs`] = () => ({ status: 202, body: { data: { jobId: RUN_ID } } })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /copy inputs/i }))
    expect(screen.getByRole("combobox", { name: "Test dancer Hair" })).toHaveTextContent("Keep original")
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Removed slot"))
    await user.click(screen.getByRole("button", { name: /run test/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/test-runs`)).toHaveLength(1))
    expect(sentTo(`POST ${BASE}/test-runs`)[0]).toMatchObject({
      slots: { dancer: { images: ["https://cdn.test/me.png"], hair: "original" } },
      details: "slower, please",
      resolution: "480p",
    })
  })

  it("Copy inputs leaves a slot the run filled from an example empty", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}/test-runs`] = () => ({
      body: { data: [run({ slots: [{ key: "dancer", label: "Dancer", kind: "person", images: ["https://cdn.test/ex.png"], fromExample: true }] })] },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /copy inputs/i }))
    expect(screen.queryByAltText("dancer picture 1")).not.toBeInTheDocument()
  })

  it("deletes a run after confirming, and not while it runs", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run(), run({ jobId: "running-1", status: "processing", progress: 10 })] } })
    routes[`DELETE ${BASE}/test-runs/${RUN_ID}`] = () => ({ body: { data: { deleted: true, libraryRows: 1, filesDeleted: 2, filesKept: 0 } } })
    renderEditor()
    const deletes = await screen.findAllByRole("button", { name: /^delete$/i })
    expect(deletes).toHaveLength(2)
    expect(deletes[1]).toBeDisabled()
    await user.click(deletes[0]!)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/examples are copies/i)).toBeInTheDocument()
    expect(sentTo(`DELETE ${BASE}/test-runs/${RUN_ID}`)).toHaveLength(0)
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }))
    await waitFor(() => expect(sentTo(`DELETE ${BASE}/test-runs/${RUN_ID}`)).toHaveLength(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Run deleted"))
  })

  it("archives a trend from the publish bar", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/archive`] = () => ({ body: { data: { ...detail().trend, status: "archived" } } })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /^archive$/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/archive`)).toHaveLength(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archived"))
  })

  it("an archived trend can't be published until restored", async () => {
    const user = userEvent.setup()
    const archived = detail()
    archived.trend = { ...archived.trend, status: "archived", publishedVersion: 1 }
    routes[`GET ${BASE}`] = () => ({ body: { data: archived } })
    routes[`POST ${BASE}/restore`] = () => ({ body: { data: { ...archived.trend, status: "unpublished" } } })
    renderEditor()
    expect(await screen.findByRole("button", { name: /^publish$/i })).toBeDisabled()
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^restore$/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/restore`)).toHaveLength(1))
  })

  it("shows a run's engine prompt and the trend's prompt parts, switching between Full and the 4 s preview", async () => {
    const user = userEvent.setup()
    const PROMPT = `/v1/admin/trends/test-runs/${RUN_ID}/prompt`
    const role = (text: string, fromFullRun: boolean) => ({ key: "dancer", label: "Dancer", kind: "person", roleName: { text, fromFullRun } })
    routes[`GET ${PROMPT}?mode=full`] = () => ({
      body: {
        data: {
          mode: "full", runMode: "full", prompt: "Replace {role:1} with…", previewOffered: true,
          parts: { mode: "full", prePrompt: null, roles: [role("the woman on the left", false)], references: [], trendPrompt: { text: "Keep the camera moves.", fromFullRun: false } },
        },
      },
    })
    routes[`GET ${PROMPT}?mode=preview`] = () => ({
      body: {
        data: {
          mode: "preview", runMode: "full", prompt: null, previewOffered: true,
          parts: { mode: "preview", prePrompt: null, roles: [role("the woman", false)], references: [], trendPrompt: { text: "Keep the camera moves.", fromFullRun: true } },
        },
      },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /show prompt/i }))
    const dialog = await screen.findByRole("dialog")
    // A full run opens on Full: its engine prompt, and the full run's parts.
    expect(await within(dialog).findByText("Replace {role:1} with…")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true")
    expect(within(dialog).getByText("the woman on the left")).toBeInTheDocument()
    expect(within(dialog).queryByText("Same as the full run")).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "4 s preview" }))
    expect(await within(dialog).findByText("the woman")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "4 s preview" })).toHaveAttribute("aria-pressed", "true")
    expect(within(dialog).getByText(/the engine was never sent a 4 s preview prompt/)).toBeInTheDocument()
    // The trend prompt the preview takes from the full run is marked so.
    expect(within(dialog).getByText("Same as the full run")).toBeInTheDocument()
    expect(within(dialog).queryByText("Replace {role:1} with…")).not.toBeInTheDocument()
  })

  it("Show prompt reads the trend's parts again after a draft save", async () => {
    const user = userEvent.setup()
    const PROMPT = `GET /v1/admin/trends/test-runs/${RUN_ID}/prompt?mode=full`
    routes[PROMPT] = () => ({ body: { data: { mode: "full", runMode: "full", prompt: "P", previewOffered: true, parts: null } } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /show prompt/i }))
    expect(await within(await screen.findByRole("dialog")).findByText("P")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(sentTo(PROMPT)).toHaveLength(1)

    await user.type(screen.getByLabelText("Trend prompt in the 4 s preview"), "Short.")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    await user.click(screen.getByRole("button", { name: /show prompt/i }))
    await waitFor(() => expect(sentTo(PROMPT)).toHaveLength(2))
  })

  it("a preview run's prompt opens on the 4 s preview", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run({ preview: true })] } })
    routes[`GET /v1/admin/trends/test-runs/${RUN_ID}/prompt?mode=preview`] = () => ({
      body: { data: { mode: "preview", runMode: "preview", prompt: "PREVIEW ENGINE PROMPT", previewOffered: true, parts: null } },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /show prompt/i }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("PREVIEW ENGINE PROMPT")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "4 s preview" })).toHaveAttribute("aria-pressed", "true")
  })

  it("counts a Kling 4 trend's images as sent, a prepared picture as one, against its 10", async () => {
    const slots = ["a", "b", "c", "d", "e"].map((k) => slot({ key: k }))
    const references = [1, 2].map((r) => ({ images: [1, 2, 3].map((i) => `https://cdn.test/r${r}-${i}.png`), line: "the sign" }))
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots, references, engine: "kling-4" }) } })
    renderEditor()
    // 5 people prepared + 6 reference pictures.
    expect(await screen.findByText("11 / 10")).toHaveAttribute("data-state", "over")
    expect(screen.getByText("prepared pictures count as one")).toBeInTheDocument()
  })

  it("a 5-person Kling 4 trend is within its 10", async () => {
    const slots = ["a", "b", "c", "d", "e"].map((k) => slot({ key: k }))
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots, engine: "kling-4" }) } })
    renderEditor()
    expect(await screen.findByText("5 / 10")).toHaveAttribute("data-state", "ok")
  })

  it("shows the Kling 4 prompt room when the model is Kling 4", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { prePrompt: "p".repeat(3000), trendPrompt: "t".repeat(2998), references: [1, 2].map((i) => ({ images: [`https://cdn.test/r${i}.png`], line: "l".repeat(500) })) }) } })
    renderEditor()
    await screen.findByRole("combobox", { name: "Model" })
    expect(screen.queryByText(/on Nodaro Motion Pulse \(Kling 4\), to leave room/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(screen.getByRole("option", { name: "Nodaro Motion Pulse (Kling 4)" }))
    expect(await screen.findByText(/at most \d+ characters together on Nodaro Motion Pulse \(Kling 4\)/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
  })

  it("counts images against the cap: 33 / 30 is an error and Save is off", async () => {
    const kinds: AdminTrendSlot["kind"][] = ["person", "person", "person", "person", "person", "person", "product", "product", "product", "pet", "pet"]
    const slots = kinds.map((kind, i) =>
      slot({ key: `s${i}`, kind, defaults: kind === "person" ? { body: "new" } : undefined }),
    )
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots }) } })
    const user = userEvent.setup()
    renderEditor()
    const counter = await screen.findByText("33 / 30")
    expect(counter).toHaveAttribute("data-state", "over")
    // A real edit, so only the cap can be what keeps Save off (an unedited form is never savable).
    // Found by its value, not its label: a label query over 11 slot editors takes seconds in
    // jsdom (it timed this test out on a loaded CI shard). One keystroke is edit enough.
    const [roleName] = screen.getAllByDisplayValue(slot().roleName)
    await user.type(roleName!, "!")
    expect(screen.getByText(/^33 images: at most 30/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
  })

  it("counts reference images too", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({}, { references: [{ images: ["https://cdn.test/r1.png", "https://cdn.test/r2.png"], line: "The logo on the mug" }] }) },
    })
    renderEditor()
    expect(await screen.findByText("5 / 30")).toHaveAttribute("data-state", "ok")
  })

  describe("examples: an optional slot without pictures", () => {
    const PLACE = slot({ key: "place", label: { en: "Place" }, kind: "location", required: false, roleName: "the street", defaults: undefined })
    const ex = (slots: Record<string, string[]>) => ({ videoUrl: "https://cdn.test/ex.mp4", width: 720, height: 1280, durationSec: 12, slots, sourceJobId: "job-x" })

    it("shows an optional slot an example has no pictures for as kept from the original, never as a problem", async () => {
      routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots: [slot(), PLACE], examples: [ex({ dancer: ["https://cdn.test/d.png"] })] }) } })
      renderEditor()
      expect(await screen.findByText("As in the original: Place (no pictures).")).toBeInTheDocument()
      expect(screen.queryByText(/^No pictures for:/)).toBeNull()
      expect(screen.getByAltText("Dancer picture 1")).toBeInTheDocument()
    })

    it("still flags a required slot an example has no pictures for", async () => {
      routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { slots: [slot(), PLACE], examples: [ex({ place: ["https://cdn.test/p.png"] })] }) } })
      renderEditor()
      expect(await screen.findByText(/^No pictures for: dancer/)).toBeInTheDocument()
    })
  })

  describe("examples: a fresh revision is never paired with a stale list", () => {
    const ex = (job: string) => ({
      videoUrl: `https://cdn.test/${job}.mp4`,
      width: 720,
      height: 1280,
      durationSec: 12,
      slots: { dancer: [`https://cdn.test/${job}.png`] },
      sourceJobId: job,
    })
    const A = ex("job-a"), B = ex("job-b"), C = ex("job-c")

    /** GET answers `first` at once, then waits for `release` with the server's next state. */
    function serveThenHold(first: ReturnType<typeof detail>) {
      let reads = 0
      let release!: (d: ReturnType<typeof detail>) => void
      const next = new Promise<ReturnType<typeof detail>>((r) => (release = r))
      routes[`GET ${BASE}`] = async () => ({ body: { data: reads++ === 0 ? first : await next } })
      return { release }
    }

    const moveButtons = () => screen.getAllByRole("button", { name: /^move example \d+ (up|down)$/i })

    it("keeps the example buttons off until the reordered list has landed, then reorders that list", async () => {
      const user = userEvent.setup()
      const held = serveThenHold(detail({}, { examples: [A, B, C] }))
      routes[`PUT ${BASE}/examples/order`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
      renderEditor()
      await user.click(await screen.findByRole("button", { name: "Move example 1 down" }))
      await waitFor(() => expect(sentTo(`PUT ${BASE}/examples/order`)).toEqual([{ order: [1, 0, 2], revision: "rev-1" }]))

      // The server has rev-2 = [B, A, C], but the screen still shows [A, B, C]: no move may be built from it.
      for (const b of moveButtons()) expect(b).toBeDisabled()
      expect(screen.getByRole("button", { name: /remove example 1/i })).toBeDisabled()

      held.release(detail({ revision: "rev-2" }, { examples: [B, A, C] }))
      await waitFor(() => expect(screen.getByRole("button", { name: "Move example 2 down" })).toBeEnabled())
      expect(screen.getAllByText(/^From run /).map((e) => e.textContent)).toEqual(["From run job-b", "From run job-a", "From run job-c"])

      routes[`PUT ${BASE}/examples/order`] = () => ({ body: { data: { version: 1, revision: "rev-3" } } })
      await user.click(screen.getByRole("button", { name: "Move example 2 down" }))
      // Built from [B, A, C] with the revision that names it: A moves after C.
      await waitFor(() => expect(sentTo(`PUT ${BASE}/examples/order`)).toHaveLength(2))
      expect(sentTo(`PUT ${BASE}/examples/order`)[1]).toEqual({ order: [0, 2, 1], revision: "rev-2" })
    })

    it("removes the example on screen when one removal follows another", async () => {
      const user = userEvent.setup()
      const held = serveThenHold(detail({}, { examples: [A, B, C] }))
      routes[`DELETE ${BASE}/examples/1?revision=rev-1`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
      renderEditor()
      await user.click(await screen.findByRole("button", { name: "Remove example 2" }))
      await user.click(await screen.findByRole("button", { name: /^remove$/i }))
      await waitFor(() => expect(sentTo(`DELETE ${BASE}/examples/1?revision=rev-1`)).toHaveLength(1))

      // Still showing [A, B, C] while the server has [A, C]: removing "example 2" now would delete C.
      expect(screen.getByRole("button", { name: "Remove example 2" })).toBeDisabled()

      held.release(detail({ revision: "rev-2" }, { examples: [A, C] }))
      await waitFor(() => expect(screen.getByRole("button", { name: "Remove example 2" })).toBeEnabled())
      expect(screen.getAllByText(/^From run /).map((e) => e.textContent)).toEqual(["From run job-a", "From run job-c"])

      routes[`DELETE ${BASE}/examples/1?revision=rev-2`] = () => ({ body: { data: { version: 1, revision: "rev-3" } } })
      await user.click(screen.getByRole("button", { name: "Remove example 2" }))
      await user.click(await screen.findByRole("button", { name: /^remove$/i }))
      // Example 2 on screen is C, at the revision that lists [A, C].
      await waitFor(() => expect(sentTo(`DELETE ${BASE}/examples/1?revision=rev-2`)).toHaveLength(1))
    })
  })
})

describe("the original's display copy and a slot's hint picture", { timeout: 20_000 }, () => {
  const DISPLAY = {
    videoUrl: "https://cdn.test/trends/a1/display.mp4",
    posterUrl: "https://cdn.test/trends/a1/poster.png",
    width: 720,
    height: 1280,
    durationSec: 12.04,
  }
  const HINT = "https://cdn.test/trends/a1/hint.png"
  const saved = () => sentTo(`PUT ${BASE}/draft`) as Array<{ data: { source: Record<string, unknown>; slots: AdminTrendSlot[] } }>

  it("keeps the source's display copy and a slot's hint picture through a save, and loads them as no change", async () => {
    const user = userEvent.setup()
    const source = { ...detail().draft.source!, display: DISPLAY }
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { source, slots: [slot({ hintImageUrl: HINT })] }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()

    const roleName = await screen.findByLabelText(ROLE_NAME)
    expect(screen.queryByText("Unsaved changes.")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
    expect(screen.getByRole("img", { name: "Slot 1 hint picture" })).toHaveAttribute("src", HINT)
    expect(screen.getByRole("img", { name: "The original as users see it" })).toHaveAttribute("src", DISPLAY.posterUrl)

    await user.type(roleName, "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]!.data.source).toEqual(source)
    expect(saved()[0]!.data.slots).toEqual([{ ...slot({ hintImageUrl: HINT }), roleName: "the woman on the left!" }])
  })

  it("adds a hint picture to a slot (copied into trend storage as a hint), saves it, and ✕ removes it", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/media`] = () => ({ body: { data: { url: HINT } } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()

    const group = await screen.findByRole("group", { name: "Slot 1 hint picture" })
    await user.type(within(group).getByLabelText("Add hint picture: URL"), "https://u.example/actor.png{Enter}")
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: "https://u.example/actor.png", kind: "hint" }]))
    expect(await screen.findByRole("img", { name: "Slot 1 hint picture" })).toHaveAttribute("src", HINT)
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]!.data.slots[0]!.hintImageUrl).toBe(HINT)

    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 2, revision: "rev-3" } } })
    await user.click(screen.getByRole("button", { name: "Remove slot 1 hint picture" }))
    expect(screen.queryByRole("img", { name: "Slot 1 hint picture" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(2))
    expect(saved()[1]!.data.slots[0]).not.toHaveProperty("hintImageUrl")
  })

  it("keeps an edit made to the slot while its hint picture is being stored", async () => {
    const user = userEvent.setup()
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    routes[`POST ${BASE}/media`] = async () => {
      await held
      return { body: { data: { url: HINT } } }
    }
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()

    const group = await screen.findByRole("group", { name: "Slot 1 hint picture" })
    await user.type(within(group).getByLabelText("Add hint picture: URL"), "https://u.example/actor.png{Enter}")
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toHaveLength(1))
    await user.type(screen.getByLabelText(ROLE_NAME), "!")
    release()
    expect(await screen.findByRole("img", { name: "Slot 1 hint picture" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]!.data.slots[0]).toMatchObject({ roleName: "the woman on the left!", hintImageUrl: HINT })
  })

  it("a source clip stored with its display copy shows the copy's poster and saves it", async () => {
    const user = userEvent.setup()
    const NEW = "https://cdn.test/trends/a1/new-src.mov"
    routes[`POST ${BASE}/media`] = () => ({ body: { data: { url: NEW, durationSec: 10, width: 1080, height: 1920, display: DISPLAY } } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()

    expect(await screen.findByText(/no display copy yet/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText("Replace clip: URL"), "https://u.example/clip.mov{Enter}")
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: "https://u.example/clip.mov", kind: "source" }]))
    expect(await screen.findByRole("img", { name: "The original as users see it" })).toHaveAttribute("src", DISPLAY.posterUrl)
    expect(screen.getByText(/this copy is what users see/i)).toBeInTheDocument()
    expect(screen.queryByText(/no display copy yet/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]!.data.source).toEqual({ videoUrl: NEW, durationSec: 10, width: 1080, height: 1920, display: DISPLAY })
  })

  it("says the source section is shown to users", async () => {
    renderEditor()
    expect(await screen.findByText("The clip the trend recasts. Shown to users beside the examples.")).toBeInTheDocument()
    expect(screen.queryByText(/never shown to users/i)).not.toBeInTheDocument()
  })

  it("says examples are optional (with none, the trend shows only its original) and what the cover is", async () => {
    renderEditor()
    expect(
      await screen.findByText(/^No examples yet\. Optional: with none, the trend shows only its original\./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/needs one to be published/i)).not.toBeInTheDocument()
    expect(screen.getByText("Example 1 is the cover; with none, the original's display copy is.")).toBeInTheDocument()
  })

  it("a publish refused for a missing display copy says to upload the clip again", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/publish`] = () => ({
      status: 409,
      body: { error: { code: "publish_blocked", message: "This trend cannot be published yet.", reasons: [{ code: "source_display_missing" }] } },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /^publish$/i }))
    const reasons = await screen.findByRole("list", { name: /why it can't be published/i })
    expect(within(reasons).getByText(/upload the clip again/i)).toBeInTheDocument()
  })
})

describe("the 4 s preview's own prompt parts", { timeout: 20_000 }, () => {
  const PREVIEW_ROLE = /^role name in the 4 s preview/i
  const PREVIEW_LINE = /^prompt line in the 4 s preview/i
  const REFERENCE = { images: ["https://cdn.test/r.png"], line: "the neon sign" }

  it("shows each one under its full one with the fallback as placeholder, and saves what is typed", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { references: [REFERENCE] }) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    const role = await screen.findByLabelText(PREVIEW_ROLE)
    const pre = screen.getByLabelText("Pre prompt in the 4 s preview")
    const trend = screen.getByLabelText("Trend prompt in the 4 s preview")
    const line = screen.getByLabelText(PREVIEW_LINE)
    for (const field of [role, pre, trend, line]) {
      expect(field).toHaveValue("")
      expect(field).toHaveAttribute("placeholder", "Same as the full run")
    }
    // Loading a draft with none is no change.
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()

    await user.type(role, "the woman")
    await user.type(pre, "Open close.")
    await user.type(trend, "Keep it short.")
    await user.type(line, "the sign")
    expect(screen.getByText(/characters left for the 4 s preview's trend prompt/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).toMatchObject({
      previewPrePrompt: "Open close.",
      previewTrendPrompt: "Keep it short.",
      slots: [{ ...slot(), previewRoleName: "the woman" }],
      references: [{ ...REFERENCE, previewLine: "the sign" }],
    })
    // The full run's own texts are untouched.
    expect(body.data.trendPrompt).toBe("Keep the camera moves.")
    expect(body.data).not.toHaveProperty("prePrompt")
  })

  it("hides them while the trend offers no preview, and keeps their stored values through a save", async () => {
    const user = userEvent.setup()
    const stored = {
      previewStart: null,
      previewPrePrompt: "Open close.",
      previewTrendPrompt: "Keep it short.",
      slots: [slot({ previewRoleName: "the woman" })],
      references: [{ ...REFERENCE, previewLine: "the sign" }],
    }
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, stored) } })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
    renderEditor()
    const roleName = await screen.findByLabelText(ROLE_NAME)
    for (const label of [PREVIEW_ROLE, PREVIEW_LINE, "Pre prompt in the 4 s preview", "Trend prompt in the 4 s preview"]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/4 s preview's trend prompt/)).not.toBeInTheDocument()
    await user.type(roleName, "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).toMatchObject({
      previewStart: null,
      previewPrePrompt: "Open close.",
      previewTrendPrompt: "Keep it short.",
      slots: [{ roleName: "the woman on the left!", previewRoleName: "the woman" }],
      references: [{ previewLine: "the sign" }],
    })
  })

  it("holds Save on a preview trend prompt that leaves the details no room", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { previewTrendPrompt: "t".repeat(2990) }) } })
    renderEditor()
    await user.type(await screen.findByLabelText("Trend prompt in the 4 s preview"), "123456789")
    expect(await screen.findByText(/^Trend prompt in the 4 s preview: at most 2998 characters/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
  })

  it("a test run's 4 s preview says it sends the preview's own parts", async () => {
    renderEditor()
    expect(await screen.findByRole("switch", { name: "4 s preview" })).toBeChecked()
    expect(screen.getByText(/A preview run sends the preview's own role names, reference lines and prompts/)).toBeInTheDocument()
  })
})

describe("the 4 s preview's input clip", { timeout: 20_000 }, () => {
  const CLIP: AdminTrendPreviewClip = {
    videoUrl: "https://cdn.test/trends/a1/preview.mp4",
    durationSec: 5,
    width: 720,
    height: 1280,
    frames: 150,
    sha256: "0123456789abcdef".repeat(4),
    sourceVideoUrl: detail().draft.source!.videoUrl,
    startSec: detail().draft.previewStart!,
    // Three minutes before the FILE was collected; the test asserts the shape, not the number (a slow
    // shard can run the test minutes later).
    madeAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  }
  /** The current clip's row (the heading "Preview input" without a colon), or null while a note shows instead. */
  const row = (): HTMLElement | null => screen.queryByText("Preview input")?.closest<HTMLElement>("[data-preview-input]") ?? null

  it("shows the stored clip (length, frames, size, short hash, when made) and plays that file, not the source", async () => {
    const user = userEvent.setup()
    const play = vi.fn().mockResolvedValue(undefined)
    HTMLMediaElement.prototype.play = play
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { previewClip: CLIP }) } })
    renderEditor()

    await screen.findByText("Preview input")
    const current = row()!
    expect(current).toHaveAttribute("data-preview-input", "current")
    expect(within(current).getByText("5.0 s")).toBeInTheDocument()
    expect(within(current).getByText("150 frames")).toBeInTheDocument()
    expect(within(current).getByText("720×1280")).toBeInTheDocument()
    expect(within(current).getByText("0123456789ab")).toHaveAttribute("title", CLIP.sha256)
    expect(within(current).getByText(/^made \d+[mh] ago$/)).toBeInTheDocument()
    expect(within(current).getByRole("link", { name: "open" })).toHaveAttribute("href", CLIP.videoUrl)
    // Loading the clip is no change: it is the server's, never saved by the form.
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()

    await user.click(within(current).getByRole("button", { name: /play the prepared clip/i }))
    expect(play).toHaveBeenCalledTimes(1)
    const played = play.mock.instances[0] as HTMLVideoElement
    expect(played).toHaveAttribute("src", CLIP.videoUrl)
    expect(played).toHaveAccessibleName("Prepared preview clip")
    // The source player was not touched.
    expect(document.querySelector(`video[src="${detail().draft.source!.videoUrl}"]`)).not.toBe(played)
  })

  it("says the clip is prepared on save while none is stored, and after the save shows what the server made", async () => {
    const user = userEvent.setup()
    let stored: AdminTrendPreviewClip | undefined
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, stored ? { previewClip: stored } : {}) } })
    routes[`PUT ${BASE}/draft`] = () => {
      stored = CLIP
      return { body: { data: { version: 1, revision: "rev-2" } } }
    }
    renderEditor()

    await screen.findByText("Preview input:")
    expect(row()).toBeNull()
    expect(screen.getByText(/prepared on save\. The preview window is cut from the source/)).toBeInTheDocument()
    // The Test panel says a preview run cuts the window itself until then.
    expect(screen.getByText(/No prepared preview input is stored for the saved draft: the run cuts the window from the source/)).toBeInTheDocument()

    await user.type(screen.getByLabelText(ROLE_NAME), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).not.toHaveProperty("previewClip")

    await screen.findByText("Preview input")
    expect(row()).toHaveAttribute("data-preview-input", "current")
    expect(screen.getByText(/It edits the prepared preview input/)).toBeInTheDocument()
  })

  it("a moved preview start makes the stored clip stale: prepared again on save", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { previewClip: CLIP }) } })
    renderEditor()
    await screen.findByText("Preview input")
    fireEvent.change(screen.getByLabelText("Preview start"), { target: { value: "3" } })
    expect(await screen.findByText(/the prepared clip was cut from another source clip or start\. Prepared again on save/)).toBeInTheDocument()
    expect(row()).toBeNull()
  })

  it("a stale clip against the saved draft is said in the Test panel, and the window off shows nothing", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { previewClip: { ...CLIP, startSec: 9 } }) } })
    renderEditor()
    expect(await screen.findByText(/No prepared preview input is stored for the saved draft/)).toBeInTheDocument()
    expect(screen.getByText(/the prepared clip was cut from another source clip or start/)).toBeInTheDocument()
  })

  it("a publish refused for the preview input clip says to save or publish again", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/publish`] = () => ({
      status: 409,
      body: {
        error: {
          code: "publish_blocked",
          message: "This trend cannot be published yet.",
          reasons: [{ code: "preview_clip_missing" }, { code: "preview_clip_out_of_date", why: "source" }],
        },
      },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /^publish$/i }))
    const reasons = await screen.findByRole("list", { name: /why it can't be published/i })
    expect(within(reasons).getByText(/input clip is not prepared yet\. Save the draft, or publish again/i)).toBeInTheDocument()
    expect(within(reasons).getByText(/input clip is out of date: the source clip changed since it was cut/i)).toBeInTheDocument()
  })
})
