/**
 * The Executions modal shows what a job was CHARGED once it settled, with the
 * hold beside it when the job settled below it (a re-render ceiling, a
 * measured length). `credits` is the hold and never changes.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAdmin: false }) }))
vi.mock("@/lib/api", () => ({ deleteJob: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: () => null }))
vi.mock("@/components/audio-player", () => ({ WaveformAudioPlayer: () => null }))

import { ExecutionDetailModal } from "../execution-detail-modal"
import { translate } from "@/lib/i18n"
import { creditUnits, formatCreditUnits } from "@/lib/credit-units"

afterEach(cleanup)

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1", status: "completed", progress: 100, input_data: {},
  output_data: { videoUrl: "https://m/clip.mp4" }, error_message: null,
  created_at: "2026-10-13T10:00:00Z", started_at: "2026-10-13T10:00:01Z", completed_at: "2026-10-13T10:00:09Z",
  user_id: "u", credits: 888, job_type: "ugc-clip", ...over,
}) as never

describe("ExecutionDetailModal — the charge, not the hold", () => {
  it("a job settled below its hold shows the charge with the hold beside it", () => {
    render(<ExecutionDetailModal job={job({ credits_charged: 444 })} open onClose={() => {}} showDollars={false} />)
    const text = translate("en", "exec.chargedOfHeld", { charged: formatCreditUnits(444), held: creditUnits(888) })
    expect(screen.getByText(text)).toBeTruthy()
  })

  it("a running job shows its hold", () => {
    render(<ExecutionDetailModal job={job({ status: "processing", credits_charged: null })} open onClose={() => {}} showDollars={false} />)
    expect(screen.getByText(formatCreditUnits(888))).toBeTruthy()
  })

  it("a job charged its whole hold shows one figure", () => {
    render(<ExecutionDetailModal job={job({ credits_charged: 888 })} open onClose={() => {}} showDollars={false} />)
    expect(screen.getByText(formatCreditUnits(888))).toBeTruthy()
  })
})
