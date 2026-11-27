/**
 * Admin → Trends → one trend → Test: the sizes a test run may ask for.
 *
 * - Without the server's `runSizes` (an environment whose engine reads trend runs by the size it makes), the sizes
 *   the saved draft's engine makes, a draft only at Prism's 480p, exactly as before.
 * - With them, those sizes (4K among them), the first by default; Draft is the engine's 480p take whatever size is
 *   picked, sent without a size; a Flash draft has no Draft switch.
 * - The Model section says how the sizes are made when they are sizes delivered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { scaledTimeout } from "../../../../../../../../tools/vitest/ci-limits.mjs"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, RUN_ID, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"

const BASE = `/v1/admin/trends/${TREND_ID}`
const DELIVERED = { resolutions: ["720p", "1080p", "4k"] as Array<"720p" | "1080p" | "4k">, delivered: true as const }

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

async function runTest(user: ReturnType<typeof userEvent.setup>): Promise<Record<string, unknown>> {
  await user.type(screen.getByLabelText("Pictures for dancer (0 / 3): URL"), "https://u.example/me.png{Enter}")
  await user.click(screen.getByRole("button", { name: /run test/i }))
  await waitFor(() => expect(sentTo(`POST ${BASE}/test-runs`)).toHaveLength(1))
  return (sentTo(`POST ${BASE}/test-runs`) as Array<Record<string, unknown>>)[0]!
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes[`POST ${BASE}/test-runs`] = () => ({ status: 202, body: { data: { jobId: RUN_ID } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("a test run's sizes", { timeout: scaledTimeout(20_000) }, () => {
  it("without runSizes: the saved Prism draft's own sizes, a draft only at 480p, as before", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { engine: "seedance-2-5" }) } })
    renderEditor()
    const group = await screen.findByRole("group", { name: "Resolution" })
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["480p", "720p", "1080p"])
    expect(screen.getByText(/Runs at 480p, 720p or 1080p/)).toBeInTheDocument()
    expect(document.querySelector("[data-run-sizes]")).toBeNull()
  })

  it("with runSizes: those sizes, the first by default, sent by the size delivered", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ runSizes: DELIVERED }, { engine: "seedance-2-5" }) } })
    renderEditor()
    const group = await screen.findByRole("group", { name: "Resolution" })
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["720p", "1080p", "4K"])
    expect(within(group).getByRole("button", { name: "720p" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText(/Delivered at 720p, 1080p or 4K/)).toBeInTheDocument()
    await user.click(within(group).getByRole("button", { name: "4K" }))
    const body = await runTest(user)
    expect(body.resolution).toBe("4k")
    expect(body.draft).toBe(false)
  })

  it("with runSizes: Draft is the 480p take whatever size is picked, sent with no size", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ runSizes: DELIVERED }, { engine: "seedance-2-5" }) } })
    renderEditor()
    const group = await screen.findByRole("group", { name: "Resolution" })
    const draft = screen.getByRole("switch", { name: "Draft" })
    expect(draft).toBeEnabled()
    await user.click(draft)
    expect(within(group).getByRole("button", { name: "720p" })).toBeDisabled()
    expect(screen.getByText(/A draft is the engine's own 480p take/)).toBeInTheDocument()
    const body = await runTest(user)
    expect(body.draft).toBe(true)
    expect(body).not.toHaveProperty("resolution")
  })

  it("a Flash draft has no Draft switch", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({ runSizes: { resolutions: ["720p", "1080p"], delivered: true } }, { engine: "seedance-2-5", flash: true }) } })
    renderEditor()
    const group = await screen.findByRole("group", { name: "Resolution" })
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["720p", "1080p"])
    expect(screen.queryByRole("switch", { name: "Draft" })).not.toBeInTheDocument()
  })
})
