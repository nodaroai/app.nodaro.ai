/**
 * Admin → Trends → one trend: what an admin relies on.
 *
 * - Save sends the edited draft (never its examples, which only the example
 *   routes write) with the revision the screen read.
 * - A stale revision (409 `draft_conflict`) reloads the trend and says so.
 * - Publish refused (409 `publish_blocked`) lists every reason readably.
 * - "Use as example" promotes exactly that run; "Show prompt" shows the
 *   engine prompt.
 * - The image counter shows N / 30 and, above 30, an error and no Save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { toast } from "sonner"
import type { AdminTrendSlot } from "@/lib/api"
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
    const roleName = await screen.findByLabelText(/role name/i)
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
    expect(body.data.faceMasking).toEqual({ mode: "auto", fill: "depth", zone: { topPct: 5 }, threshold: 0.4 })
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

  it("reloads the trend and says so when the draft changed elsewhere", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/draft`] = () => ({
      status: 409,
      body: { error: { code: "draft_conflict", message: "The draft changed since it was loaded." } },
    })
    renderEditor()
    const roleName = await screen.findByLabelText(/role name/i)
    await user.clear(roleName)
    await user.type(roleName, "mine")
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ revision: "rev-9" }, { slots: [slot({ roleName: "theirs" })] }) },
    })
    await user.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("This trend changed elsewhere — reloaded."))
    await waitFor(() => expect(screen.getByLabelText(/role name/i)).toHaveValue("theirs"))
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

  it("shows a run's engine prompt", async () => {
    const user = userEvent.setup()
    routes[`GET /v1/admin/trends/test-runs/${RUN_ID}/prompt`] = () => ({ body: { data: { prompt: "Replace {role:1} with…" } } })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /show prompt/i }))
    expect(await screen.findByText("Replace {role:1} with…")).toBeInTheDocument()
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
