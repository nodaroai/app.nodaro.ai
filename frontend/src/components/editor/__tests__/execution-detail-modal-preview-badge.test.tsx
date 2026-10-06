/**
 * The Executions tab's job and node views label a Preview (decided
 * 2026-10-05). Read from what the job IS: an Apply EDL job whose output carries
 * `quality: "proxy"` — the job read fills it from the order for an old render
 * (backend render-label-fill.ts), so the modal never reads `input_data`.
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

afterEach(cleanup)
// The badge is found by its hint (title): the modal's own output tab is also
// named "Preview", so its text cannot tell the two apart.
const HINT = translate("en", "node.renderPreviewBadgeHint")

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1", status: "completed", progress: 100, input_data: { quality: "proxy" },
  output_data: { videoUrl: "https://m/cut.mp4", quality: "proxy" }, error_message: null,
  created_at: "2026-10-05T10:00:00Z", started_at: "2026-10-05T10:00:01Z", completed_at: "2026-10-05T10:00:09Z",
  user_id: "u", credits: 0, job_type: "apply-edl", ...over,
}) as never

describe("ExecutionDetailModal — the Preview label", () => {
  it("labels an Apply EDL job whose output is a Preview", () => {
    render(<ExecutionDetailModal job={job()} open onClose={() => {}} />)
    expect(screen.getAllByTitle(HINT).length).toBeGreaterThan(0)
  })

  it("does not label a final render", () => {
    render(<ExecutionDetailModal job={job({ output_data: { videoUrl: "https://m/cut.mp4", quality: "final" } })} open onClose={() => {}} />)
    expect(screen.queryByTitle(HINT)).toBeNull()
  })

  it("does not label another node type's `quality`", () => {
    render(<ExecutionDetailModal job={job({ job_type: "generate-video" })} open onClose={() => {}} />)
    expect(screen.queryByTitle(HINT)).toBeNull()
  })

  it("does not label an output with no stamp", () => {
    render(<ExecutionDetailModal job={job({ output_data: { videoUrl: "https://m/cut.mp4" } })} open onClose={() => {}} />)
    expect(screen.queryByTitle(HINT)).toBeNull()
  })

  it("labels the node-only view of a render's Preview output", () => {
    render(
      <ExecutionDetailModal
        job={null}
        open
        onClose={() => {}}
        nodeInfo={{ nodeId: "n1", state: { status: "completed", nodeType: "apply-edl", output: { videoUrl: "https://m/cut.mp4", quality: "proxy" } } } as never}
      />,
    )
    expect(screen.getAllByTitle(HINT).length).toBeGreaterThan(0)
  })

  it("does not label the node-only view of a final", () => {
    render(
      <ExecutionDetailModal
        job={null}
        open
        onClose={() => {}}
        nodeInfo={{ nodeId: "n1", state: { status: "completed", nodeType: "apply-edl", output: { videoUrl: "https://m/cut.mp4", quality: "final" } } } as never}
      />,
    )
    expect(screen.queryByTitle(HINT)).toBeNull()
  })
})
