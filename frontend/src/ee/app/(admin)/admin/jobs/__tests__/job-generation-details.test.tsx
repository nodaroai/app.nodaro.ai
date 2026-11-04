import { cleanup, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  fetchJobCastSwapSteps: vi.fn(),
}))
import type { ReactElement } from "react"
import { fetchJobCastSwapSteps } from "@/lib/api"
import { CastSwapStepsBody, JobGenerationDetails, JobSkippedSteps, JobStepOutputs } from "../job-generation-details"
afterEach(cleanup)
beforeEach(() => vi.mocked(fetchJobCastSwapSteps).mockReset())
it("shows recorded model and generation parameters above the JSON", () => {
  render(<JobGenerationDetails input={{provider:"seedance-2-5",resolution:"480p",duration:30,aspectRatio:"9:16",generateAudio:false,seed:0}} />)
  expect(screen.getByText("seedance-2-5")).toBeTruthy()
  expect(screen.getByText("480p")).toBeTruthy()
  expect(screen.getByText("30 sec")).toBeTruthy()
  expect(screen.getByText("9:16")).toBeTruthy()
  expect(screen.getByText("No")).toBeTruthy()
  expect(screen.getByText("0")).toBeTruthy()
})
it("keeps unknown model identifiers visible and does not fabricate defaults", () => {
  render(<JobGenerationDetails input={{model:"custom-model",provider:"kie",duration:"5s",prompt:"not a parameter card",resolution:null}} />)
  expect(screen.getByText("custom-model")).toBeTruthy()
  expect(screen.getByText("5s")).toBeTruthy()
  expect(screen.queryByText("Resolution")).toBeNull()
  expect(screen.queryByText("not a parameter card")).toBeNull()
})
it("handles missing and malformed settings", () => {
  const {rerender,container}=render(<JobGenerationDetails input={null} />)
  expect(container.textContent).toBe("")
  rerender(<JobGenerationDetails input={{duration:NaN,model:{id:"bad"},quality:[]}} />)
  expect(container.textContent).toBe("")
})
it("names the steps a run went on without, with why", () => {
  render(<JobSkippedSteps output={{ videoUrl: "https://x/v.mp4", skippedSteps: [{ step: "face-mesh", reason: "the face mesh failed" }, { bad: true }] }} />)
  expect(screen.getByTestId("job-skipped-steps").textContent).toContain("face-mesh: the face mesh failed")
  expect(screen.getByText("Finished without a step")).toBeTruthy()
})
it("says nothing when no step was skipped", () => {
  const { container, rerender } = render(<JobSkippedSteps output={null} />)
  expect(container.textContent).toBe("")
  rerender(<JobSkippedSteps output={{ skippedSteps: "nope" }} />)
  expect(container.textContent).toBe("")
})
it("JobSkippedSteps names the new steps and roles", () => {
  render(<JobSkippedSteps output={{ skippedSteps: [
    { step: "face-mesh", reason: "frame_count_mismatch" },
    { step: "photo-labels", reason: "timed_out", role: 0 },
    { step: "head-crop", reason: "no_face", role: 2 },
    { step: "reference-sheet", reason: "failed", role: 1 },
    { step: "engine-prompt", reason: "too_long" },
    { step: "scene-description", reason: "unavailable", role: -1 },
    { step: "some-new-step", reason: "failed" },
  ] }} />)
  const items = within(screen.getByTestId("job-skipped-steps")).getAllByRole("listitem").map((li) => li.textContent)
  expect(items).toEqual([
    "Face mesh: frame count mismatch",
    "Photo labels — role 1: timed out",
    "Head crop — role 3: no face",
    "Reference sheet — role 2: failed",
    "Engine prompt: too long",
    "Scene description: unavailable",
    "some-new-step: failed",
  ])
  expect(screen.getByText("Finished without 7 steps")).toBeTruthy()
})
it("JobSkippedSteps names Body from the clip, its role and a role with no usable frame", () => {
  render(<JobSkippedSteps output={{ skippedSteps: [
    { step: "clip-body", reason: "no_frame", role: 0 },
    { step: "clip-body", reason: "failed", role: 1 },
  ] }} />)
  const items = within(screen.getByTestId("job-skipped-steps")).getAllByRole("listitem").map((li) => li.textContent)
  expect(items).toEqual(["Body from the clip — role 1: no usable frame", "Body from the clip — role 2: failed"])
})
function withQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
it("JobStepOutputs shows a Cast Swap job's steps, and reads nothing for any other job", async () => {
  vi.mocked(fetchJobCastSwapSteps).mockResolvedValue({
    stepOutputs: { v: 1, roles: [{ role: 0, kind: "product", condition: "head-only", layout: "turnaround" }], enginePrompt: { mode: "llm", text: "test prompt body" } },
    sceneText: null,
    skippedSteps: [{ step: "reference-sheet", reason: "failed", role: 0 }],
    styleOnly: null,
  })
  const { container, unmount } = withQuery(<JobStepOutputs job={{ id: "job-1", job_type: "video", input_data: { type: "generate-video" } }} />)
  expect(container.textContent).toBe("")
  expect(fetchJobCastSwapSteps).not.toHaveBeenCalled()
  unmount()

  withQuery(<JobStepOutputs job={{ id: "job-2", job_type: null, input_data: { type: "cast-swap" } }} />)
  const box = screen.getByTestId("job-step-outputs")
  expect(await within(box).findByRole("region", { name: "Role 1" })).toBeTruthy()
  expect(within(box).getByText("Head only")).toBeTruthy()
  expect(within(box).getByText("turnaround")).toBeTruthy()
  expect(within(box).getByTestId("llm-prompt-body").textContent).toBe("test prompt body")
  // The skipped steps are the dialog's own block above it, never twice.
  expect(within(box).queryByTestId("job-skipped-steps")).toBeNull()
  expect(fetchJobCastSwapSteps).toHaveBeenCalledWith("job-2")
})
it("JobStepOutputs reads a Full Quality version (its own job type) too", async () => {
  vi.mocked(fetchJobCastSwapSteps).mockResolvedValue({ stepOutputs: null, sceneText: null, skippedSteps: [], styleOnly: null })
  withQuery(<JobStepOutputs job={{ id: "job-3", job_type: "cast-swap-full-quality", input_data: null }} />)
  expect(await screen.findByText("This run used today's steps.")).toBeTruthy()
  expect(screen.queryByTestId("style-only-path")).toBeNull()
})
it("CastSwapStepsBody says a style-only run's path above its engine prompt, and when the video was made black and white", () => {
  const { rerender } = render(<CastSwapStepsBody showSkipped={false} data={{
    stepOutputs: { v: 1, roles: [], enginePrompt: { mode: "template" }, styleOnly: { path: "original", grayscale: true } },
    sceneText: null,
    skippedSteps: [],
    styleOnly: "original",
  }} />)
  const line = screen.getByTestId("style-only-path")
  expect(line.textContent).toContain("Style only: original clip")
  expect(line.textContent).toContain("The video was turned black and white.")
  const heading = screen.getByRole("heading", { name: /Engine prompt/ })
  expect(line.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  rerender(<CastSwapStepsBody showSkipped={false} data={{
    stepOutputs: { v: 1, roles: [], styleOnly: { path: "flex" } },
    sceneText: null,
    skippedSteps: [],
    styleOnly: "flex",
  }} />)
  expect(screen.getByTestId("style-only-path").textContent).toBe("Style only: like other styles")
})
it("CastSwapStepsBody says a Full Quality version's style-only path though it recorded no steps", () => {
  render(<CastSwapStepsBody showSkipped={false} data={{ stepOutputs: null, sceneText: null, skippedSteps: [], styleOnly: "original" }} />)
  expect(screen.getByTestId("style-only-path").textContent).toBe("Style only: original clip")
})
it("CastSwapStepsBody says nothing of style-only for any other run", () => {
  render(<CastSwapStepsBody showSkipped={false} data={{ stepOutputs: { v: 1, roles: [], enginePrompt: { mode: "template" } }, sceneText: null, skippedSteps: [], styleOnly: null }} />)
  expect(screen.queryByTestId("style-only-path")).toBeNull()
})
