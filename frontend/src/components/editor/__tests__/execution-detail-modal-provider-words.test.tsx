/**
 * The run details window shows a failed job's sentence and, under it, the
 * provider's own words about that failure (`error_detail`), which the job
 * read hands only to the job's owner.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAdmin: false }) }))
vi.mock("@/lib/api", () => ({ deleteJob: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: () => null }))
vi.mock("@/components/audio-player", () => ({ WaveformAudioPlayer: () => null }))

import { ExecutionDetailModal } from "../execution-detail-modal"

afterEach(cleanup)

const SENTENCE = "The model declined one of your pictures."
const WORDS = "Request blocked: The uploaded image may contain protected or restricted IP content."

const failedJob = (over: Record<string, unknown> = {}) => ({
  id: "job-1", status: "failed", progress: 0, input_data: {}, output_data: null,
  error_message: SENTENCE,
  created_at: "2026-11-10T10:00:00Z", started_at: "2026-11-10T10:00:01Z", completed_at: "2026-11-10T10:00:09Z",
  user_id: "u", credits: 0, job_type: "generate-image", ...over,
}) as never

describe("ExecutionDetailModal — a failed job's words", () => {
  it("shows the provider's words under the sentence", () => {
    render(<ExecutionDetailModal job={failedJob({ error_detail: WORDS })} open onClose={() => {}} showDollars={false} />)
    const sentence = screen.getByText(SENTENCE)
    const words = screen.getByTestId("job-provider-words")
    expect(words.textContent).toBe(WORDS)
    // Under it: the words follow the sentence in the document.
    expect(sentence.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ["no words", {}],
    ["a null", { error_detail: null }],
    ["an empty string", { error_detail: "" }],
  ])("a failed job with %s shows the sentence alone", (_name, over) => {
    render(<ExecutionDetailModal job={failedJob(over)} open onClose={() => {}} showDollars={false} />)
    expect(screen.getByText(SENTENCE)).toBeTruthy()
    expect(screen.queryByTestId("job-provider-words")).toBeNull()
  })

  it("a failed node with no job of its own (a sub-workflow) shows its words under its sentence", () => {
    render(
      <ExecutionDetailModal
        job={null}
        open
        onClose={() => {}}
        showDollars={false}
        nodeInfo={{ nodeId: "sw", state: { status: "failed", nodeType: "sub-workflow", error: SENTENCE, errorDetail: WORDS } }}
      />,
    )
    const sentence = screen.getByText(SENTENCE)
    const words = screen.getByTestId("node-state-provider-words")
    expect(words.textContent).toBe(WORDS)
    expect(sentence.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("a failed node with no words shows its sentence alone", () => {
    render(
      <ExecutionDetailModal
        job={null}
        open
        onClose={() => {}}
        showDollars={false}
        nodeInfo={{ nodeId: "sw", state: { status: "failed", nodeType: "sub-workflow", error: SENTENCE, errorDetail: null } }}
      />,
    )
    expect(screen.getByText(SENTENCE)).toBeTruthy()
    expect(screen.queryByTestId("node-state-provider-words")).toBeNull()
  })
})
