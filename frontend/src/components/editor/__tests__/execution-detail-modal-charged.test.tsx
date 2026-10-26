/**
 * The Executions modal shows what a job was CHARGED once it settled, with the
 * hold beside it when the job settled below it (a re-render ceiling, a
 * measured length), and "Held N" until then. A job's figures are its run's:
 * its steps (child jobs) included. `credits` is the job's own hold.
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

  it("a running job shows its hold, as a hold", () => {
    render(<ExecutionDetailModal job={job({ status: "processing", credits_charged: null, credit_status: "reserved" })} open onClose={() => {}} showDollars={false} />)
    expect(screen.getByText(translate("en", "exec.heldOnly", { held: formatCreditUnits(888) }))).toBeTruthy()
  })

  it("a finished job with no charge recorded (a free run) shows its figure, never \"held\"", () => {
    render(<ExecutionDetailModal job={job({ credits: 0, credits_charged: null, credit_status: null })} open onClose={() => {}} showDollars={false} />)
    expect(screen.getByText(formatCreditUnits(0))).toBeTruthy()
    expect(screen.queryByText(translate("en", "exec.heldOnly", { held: formatCreditUnits(0) }))).toBeNull()
  })

  it("a run with steps shows the run's charge, its hold and what went back (never the job's own hold alone)", () => {
    // The production Nodaro Motion preview: the job's own hold 44; the run
    // (its reference preps, mask and video included) held 3,773 and charged 1,063.
    render(
      <ExecutionDetailModal
        job={job({ credits: 44, credits_charged: 1063, credits_held: 3773, credits_released: 2710 })}
        open
        onClose={() => {}}
        showDollars={false}
      />,
    )
    const text = translate("en", "exec.chargedHeldReleased", {
      charged: formatCreditUnits(1063),
      held: creditUnits(3773),
      released: creditUnits(2710),
    })
    expect(screen.getByText(text)).toBeTruthy()
  })

  it("a run whose steps are still held shows the run's hold", () => {
    render(
      <ExecutionDetailModal
        job={job({ status: "processing", credit_status: "reserved", credits: 44, credits_charged: null, credits_held: 3773, credits_released: null })}
        open
        onClose={() => {}}
        showDollars={false}
      />,
    )
    expect(screen.getByText(translate("en", "exec.heldOnly", { held: formatCreditUnits(3773) }))).toBeTruthy()
  })

  it("a job charged its whole hold shows one figure", () => {
    render(<ExecutionDetailModal job={job({ credits_charged: 888 })} open onClose={() => {}} showDollars={false} />)
    expect(screen.getByText(formatCreditUnits(888))).toBeTruthy()
  })
})
