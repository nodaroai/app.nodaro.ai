import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

let mockSettings: Record<string, unknown> = {}
vi.mock("@/hooks/use-result-generation-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-result-generation-settings")>()),
  useResultGenerationSettings: () => ({ data: mockSettings, isLoading: false }),
}))

import { SeedanceHdAudioWarning } from "../seedance-draft-result-badge"
import { selectSettings } from "@/hooks/use-result-generation-settings"

const result = { url: "https://r2/hd.mp4", jobId: "11111111-2222-4333-8444-555555555555" } as never

beforeEach(() => { mockSettings = {} })

describe("Seedance 2.5 HD audio warning", () => {
  it("shows on a finalize whose draft audio could not be re-applied", () => {
    mockSettings = { warningCode: "draft_audio_not_reapplied" }
    render(<SeedanceHdAudioWarning result={result} />)
    expect(screen.getByRole("status").textContent).toMatch(/Merge Video & Audio/)
  })

  it("shows nothing on a plain result", () => {
    const { container } = render(<SeedanceHdAudioWarning result={result} />)
    expect(container.textContent).toBe("")
  })

  it("reads the code from the job's output_data", () => {
    expect(selectSettings({ input_data: {}, output_data: { warningCode: "draft_audio_not_reapplied" } } as never).warningCode).toBe("draft_audio_not_reapplied")
    expect(selectSettings({ input_data: {}, output_data: {} } as never).warningCode).toBeUndefined()
  })
})
