/**
 * Admin → Trends → a test run's "Steps": what its preparation steps made.
 *
 * - Per role (1-based): the photos' labels as chips (a low-quality photo
 *   marked), what they cover, the layout, the sheet (and "kept" on a cache hit).
 * - The LLM-written prompt body, the scene text and the skipped steps.
 * - A run with no step outputs used today's steps; loading and error states.
 * - Each run card's "Steps" opens it for that run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  fetchJobCastSwapSteps: vi.fn(),
}))

import { fetchJobCastSwapSteps, type JobCastSwapSteps } from "@/lib/api"
import { fetchMock, renderWith, resetRoutes, routes, run, RUN_ID, slot, TREND_ID } from "./harness"
import { StepsDialog } from "../components/StepsDialog"
import { TestPanel } from "../components/TestPanel"

const STEPS: JobCastSwapSteps = {
  stepOutputs: {
    v: 1,
    roles: [
      {
        role: 0,
        kind: "person",
        labels: [
          { index: 0, subject: "person", framing: "head", angle: "front", quality: "ok" },
          { index: 1, subject: "person", framing: "body", angle: "three-quarter", quality: "low" },
        ],
        condition: "head-body",
        layout: "collage",
        sheetUrl: "https://cdn.test/sheets/role-1.png",
        kept: true,
      },
      { role: 1, kind: "pet", condition: "unclear", layout: "head-body-side" },
    ],
    enginePrompt: { mode: "llm", text: "test prompt body" },
    scene: { mode: "template" },
  },
  sceneText: "test scene text",
  skippedSteps: [{ step: "reference-sheet", reason: "failed", role: 1 }],
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  vi.mocked(fetchJobCastSwapSteps).mockReset()
})
afterEach(cleanup)

describe("StepsDialog", () => {
  it("StepsDialog renders labels, layout, sheet and prompt", async () => {
    vi.mocked(fetchJobCastSwapSteps).mockResolvedValue(STEPS)
    renderWith(<StepsDialog jobId={RUN_ID} onClose={() => {}} />)
    const dialog = await screen.findByRole("dialog")
    const role1 = await within(dialog).findByRole("region", { name: "Role 1" })
    expect(fetchJobCastSwapSteps).toHaveBeenCalledWith(RUN_ID)

    // Labels as chips, the low-quality photo marked.
    const photo1 = role1.querySelector('[data-photo-label="0"]') as HTMLElement
    const photo2 = role1.querySelector('[data-photo-label="1"]') as HTMLElement
    expect(photo1.textContent).toContain("Photo 1")
    expect(within(photo1).getByText("head")).toBeInTheDocument()
    expect(within(photo1).getByText("front")).toBeInTheDocument()
    expect(within(photo1).queryByText("Low quality")).not.toBeInTheDocument()
    expect(within(photo2).getByText("body")).toBeInTheDocument()
    expect(within(photo2).getByText("3/4")).toBeInTheDocument()
    expect(within(photo2).getByText("Low quality")).toBeInTheDocument()

    // The condition, the layout and the sheet, kept.
    expect(within(role1).getByText("Head + body")).toBeInTheDocument()
    expect(within(role1).getByText("collage")).toBeInTheDocument()
    expect(within(role1).getByRole("img", { name: "Role 1 reference sheet" })).toHaveAttribute("src", "https://cdn.test/sheets/role-1.png")
    expect(within(role1).getByText(/^Kept/)).toBeInTheDocument()

    // The second role, 1-based, with no sheet.
    const role2 = within(dialog).getByRole("region", { name: "Role 2" })
    expect(within(role2).getByText("Unclear")).toBeInTheDocument()
    expect(within(role2).getByText("head-body-side")).toBeInTheDocument()
    expect(within(role2).queryByRole("img")).not.toBeInTheDocument()

    // The LLM-written prompt body, the scene text and the skipped step.
    expect(within(dialog).getByTestId("llm-prompt-body").textContent).toBe("test prompt body")
    expect(within(dialog).getByTestId("scene-text").textContent).toBe("test scene text")
    expect(within(dialog).getByTestId("job-skipped-steps").textContent).toContain("Reference sheet — role 2: failed")
  })

  it("shows a role's Body from the clip: the frame, the redrawn sheet and its prompt", async () => {
    vi.mocked(fetchJobCastSwapSteps).mockResolvedValue({
      stepOutputs: {
        v: 1,
        roles: [
          {
            role: 0,
            kind: "person",
            clipBody: {
              frameUrl: "https://cdn.test/frames/role-1.jpg",
              frameSec: 2.25,
              sheetUrl: "https://cdn.test/sheets/role-1-redrawn.png",
              prompt: "test image prompt",
            },
          },
          { role: 1, kind: "person", clipBody: { frameUrl: "javascript:alert(1)", prompt: "test other prompt" } },
        ],
      },
      sceneText: null,
      skippedSteps: [{ step: "clip-body", reason: "no_frame", role: 1 }],
    })
    renderWith(<StepsDialog jobId={RUN_ID} onClose={() => {}} />)
    const dialog = await screen.findByRole("dialog")
    const role1 = await within(dialog).findByRole("region", { name: "Role 1" })
    const clip = within(role1).getByRole("group", { name: "Role 1 body from the clip" })
    expect(within(clip).getByRole("img", { name: "Role 1 frame from the clip" })).toHaveAttribute("src", "https://cdn.test/frames/role-1.jpg")
    expect(within(clip).getByText("At 2.25 s")).toBeInTheDocument()
    expect(within(clip).getByRole("img", { name: "Role 1 sheet redrawn from the clip" })).toHaveAttribute("src", "https://cdn.test/sheets/role-1-redrawn.png")
    expect(within(clip).getByTestId("clip-body-prompt").textContent).toBe("test image prompt")
    // No sheet rules on this run: no empty "Covers" / "Layout" rows.
    expect(within(role1).queryByText("Covers")).not.toBeInTheDocument()
    // An address that is not http(s) is never shown as a picture.
    const role2 = within(dialog).getByRole("region", { name: "Role 2" })
    expect(within(role2).queryByRole("img")).not.toBeInTheDocument()
    expect(within(role2).getByTestId("clip-body-prompt").textContent).toBe("test other prompt")
    expect(within(dialog).getByTestId("job-skipped-steps").textContent).toContain("Body from the clip — role 2: no usable frame")
  })

  it("shows Style the role pictures: each role's styled picture, what it sent, and the roles skipped", async () => {
    vi.mocked(fetchJobCastSwapSteps).mockResolvedValue({
      stepOutputs: {
        v: 1,
        roles: [],
        styleRefs: {
          roles: [
            { role: 0, styledUrl: "https://cdn.test/styled/role-1.png", sent: "styled-and-original" },
            { role: 1, styledUrl: "https://cdn.test/styled/role-2.png", sent: "styled" },
          ],
          skipped: [{ role: 2, reason: "failed" }],
        },
      },
      sceneText: null,
      skippedSteps: [{ step: "style-refs", reason: "failed", role: 2 }],
    })
    renderWith(<StepsDialog jobId={RUN_ID} onClose={() => {}} />)
    const dialog = await screen.findByRole("dialog")
    const out = await within(dialog).findByTestId("style-refs-outputs")
    expect(within(out).getByRole("img", { name: "Role 1 styled picture" })).toHaveAttribute("src", "https://cdn.test/styled/role-1.png")
    expect(within(out).getByText("Role 1 · Sent: styled picture + original")).toBeInTheDocument()
    expect(within(out).getByText("Role 2 · Sent: styled picture only")).toBeInTheDocument()
    expect(within(out).getByText("Style the role pictures — role 3: failed")).toBeInTheDocument()
    expect(within(dialog).getByTestId("job-skipped-steps").textContent).toContain("Style the role pictures — role 3: failed")
  })

  it("a template engine prompt shows no body", async () => {
    vi.mocked(fetchJobCastSwapSteps).mockResolvedValue({
      ...STEPS,
      stepOutputs: { v: 1, roles: [], enginePrompt: { mode: "template" } },
      sceneText: null,
      skippedSteps: [],
    })
    renderWith(<StepsDialog jobId={RUN_ID} onClose={() => {}} />)
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("· Template")).toBeInTheDocument()
    expect(within(dialog).queryByTestId("llm-prompt-body")).not.toBeInTheDocument()
    expect(within(dialog).queryByTestId("scene-text")).not.toBeInTheDocument()
    expect(within(dialog).queryByTestId("job-skipped-steps")).not.toBeInTheDocument()
  })

  it("a run with no step outputs used today's steps; its scene text still shows", async () => {
    vi.mocked(fetchJobCastSwapSteps).mockResolvedValue({ stepOutputs: null, sceneText: "test scene text", skippedSteps: [] })
    renderWith(<StepsDialog jobId={RUN_ID} onClose={() => {}} />)
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("This run used today's steps.")).toBeInTheDocument()
    expect(within(dialog).getByTestId("scene-text").textContent).toBe("test scene text")
  })

  it("says it is loading, then the error", async () => {
    let fail: (e: Error) => void = () => {}
    vi.mocked(fetchJobCastSwapSteps).mockReturnValue(new Promise((_, reject) => (fail = reject)))
    renderWith(<StepsDialog jobId={RUN_ID} onClose={() => {}} />)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Loading…")).toBeInTheDocument()
    fail(new Error("test error"))
    expect(await within(dialog).findByText("test error")).toBeInTheDocument()
  })

  it("closed, it reads nothing", () => {
    renderWith(<StepsDialog jobId={null} onClose={() => {}} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(fetchJobCastSwapSteps).not.toHaveBeenCalled()
  })
})

describe("TestPanel", () => {
  it("each run card's Steps opens that run's steps", async () => {
    const user = userEvent.setup()
    routes[`GET /v1/admin/trends/${TREND_ID}/test-runs`] = () => ({ body: { data: [run()] } })
    vi.mocked(fetchJobCastSwapSteps).mockResolvedValue(STEPS)
    renderWith(
      <TestPanel
        trendId={TREND_ID}
        slots={[slot()]}
        hasPreview
        engine="seedance-2-5"
        dirty={false}
        promotingId={null}
        onPromote={() => {}}
      />,
    )
    expect(fetchJobCastSwapSteps).not.toHaveBeenCalled()
    await user.click(await screen.findByRole("button", { name: /^steps$/i }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "Steps" })).toBeInTheDocument()
    expect(await within(dialog).findByTestId("llm-prompt-body")).toBeInTheDocument()
    expect(fetchJobCastSwapSteps).toHaveBeenCalledWith(RUN_ID)
  })
})
