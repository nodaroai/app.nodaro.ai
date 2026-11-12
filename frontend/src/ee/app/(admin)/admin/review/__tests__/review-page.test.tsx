import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => {
  class FakeReviewApiError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 400) {
      super(message)
      this.code = code
      this.status = status
    }
  }
  return {
    FakeReviewApiError,
    listHeldJobs: vi.fn(),
    getHeldJob: vi.fn(),
    fetchHeldOutputBlob: vi.fn(),
    approveHeldJob: vi.fn(),
    rejectHeldJob: vi.fn(),
    listReviewDecisions: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
  }
})

vi.mock("@/ee/lib/review-api", () => ({
  ReviewApiError: h.FakeReviewApiError,
  listHeldJobs: h.listHeldJobs,
  getHeldJob: h.getHeldJob,
  fetchHeldOutputBlob: h.fetchHeldOutputBlob,
  approveHeldJob: h.approveHeldJob,
  rejectHeldJob: h.rejectHeldJob,
  listReviewDecisions: h.listReviewDecisions,
}))

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: h.toastInfo },
}))

import AdminReviewPage from "../page"

const JOB_ID = "00000000-0000-4000-8000-0000000000aa"

const HELD_JOB = {
  jobId: JOB_ID,
  userId: "00000000-0000-4000-8000-000000000001",
  jobType: "image-to-video",
  mediaKind: "video" as const,
  outputCount: 1,
  credits: 40,
  createdAt: "2026-09-03T10:00:00.000Z",
  heldAt: "2026-09-03T10:05:00.000Z",
  heldForMinutes: 73,
  policyId: "sai-moderation",
  reason: "nudity: 0.94",
  source: "app",
  sourceDetail: null,
}

const DECISION = {
  id: "d1",
  jobId: JOB_ID,
  hookPoint: "review",
  policyId: "review",
  verdict: "reject",
  reason: "rejected by ops: shows a real person",
  resolverEmail: "ops@nodaro.example",
  createdAt: "2026-09-03T11:00:00.000Z",
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  createObjectURL = vi.fn(() => "blob:held-preview")
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, writable: true, configurable: true })
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, writable: true, configurable: true })
  h.listHeldJobs.mockResolvedValue({ data: [HELD_JOB], total: 1, page: 0, pageSize: 25 })
  h.listReviewDecisions.mockResolvedValue({ data: [DECISION], total: 1, page: 0, pageSize: 50 })
  h.getHeldJob.mockResolvedValue({ ...HELD_JOB, inputData: { prompt: "a cat" }, outputs: [] })
  h.fetchHeldOutputBlob.mockResolvedValue(new Blob(["bytes"]))
  h.approveHeldJob.mockResolvedValue(undefined)
  h.rejectHeldJob.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Admin review — queue", () => {
  it("renders one card per held job, with the policy that held it and its reason", async () => {
    renderPage()
    expect(await screen.findByText("nudity: 0.94")).toBeInTheDocument()
    expect(screen.getByText("sai-moderation")).toBeInTheDocument()
    expect(screen.getByText("Held 73m")).toBeInTheDocument()
    expect(screen.getByText("40 credits held")).toBeInTheDocument()
  })

  it("renders the empty state rather than a spinner when nothing is held", async () => {
    h.listHeldJobs.mockResolvedValue({ data: [], total: 0, page: 0, pageSize: 25 })
    renderPage()
    expect(await screen.findByText("Nothing is waiting for review.")).toBeInTheDocument()
  })

  it("shows the load error instead of an empty queue when the fetch fails", async () => {
    h.listHeldJobs.mockRejectedValue(new h.FakeReviewApiError("internal_error", "boom", 500))
    renderPage()
    expect(await screen.findByText("Could not load the review queue.")).toBeInTheDocument()
    expect(screen.queryByText("Nothing is waiting for review.")).not.toBeInTheDocument()
  })
})

describe("Admin review — approve", () => {
  it("approves exactly once and refetches the queue", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: "Approve" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Publish this output?")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Approve" }))
    await waitFor(() => expect(h.approveHeldJob).toHaveBeenCalledTimes(1))
    expect(h.approveHeldJob).toHaveBeenCalledWith(JOB_ID)
    // Money action: the queue is re-read, so the resolved job leaves the list.
    await waitFor(() => expect(h.listHeldJobs.mock.calls.length).toBeGreaterThan(1))
    expect(h.toastSuccess).toHaveBeenCalledWith("Approved — the job is completing.")
  })

  it("treats a 409 as information and refetches, not as a failure", async () => {
    const user = userEvent.setup()
    h.approveHeldJob.mockRejectedValue(
      new h.FakeReviewApiError("review_already_resolved", "Another admin already resolved this job", 409),
    )
    renderPage()
    await user.click(await screen.findByRole("button", { name: "Approve" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Approve" }))
    await waitFor(() => expect(h.toastInfo).toHaveBeenCalledWith("Another admin already resolved this one."))
    expect(h.toastError).not.toHaveBeenCalled()
    await waitFor(() => expect(h.listHeldJobs.mock.calls.length).toBeGreaterThan(1))
  })
})

describe("Admin review — reject", () => {
  it("keeps the confirm disabled until a reason is typed, and says the reason is shown to the user", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: "Reject" }))
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("This text is shown to the person who made the request."),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole("button", { name: "Reject" })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByRole("textbox"), "shows a real person")
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(h.rejectHeldJob).toHaveBeenCalledWith(JOB_ID, "shows a real person"))
    expect(h.toastSuccess).toHaveBeenCalledWith("Rejected — credits refunded.")
  })

  it("does not submit a reason of only whitespace", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: "Reject" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByRole("textbox"), "    ")
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled()
    expect(h.rejectHeldJob).not.toHaveBeenCalled()
  })
})

describe("Admin review — the held media preview", () => {
  it("fetches the bytes through the API and revokes the object URL on unmount", async () => {
    const { unmount } = renderPage()
    const media = await screen.findByTestId("review-media")
    expect(media).toHaveAttribute("src", "blob:held-preview")
    expect(h.fetchHeldOutputBlob).toHaveBeenCalledWith(JOB_ID, 0)
    unmount()
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:held-preview"))
  })

  it("renders the failure line rather than a broken element when the preview cannot be read", async () => {
    h.fetchHeldOutputBlob.mockRejectedValue(new h.FakeReviewApiError("not_found", "gone", 404))
    renderPage()
    expect(await screen.findByText("Preview unavailable")).toBeInTheDocument()
    expect(screen.queryByTestId("review-media")).not.toBeInTheDocument()
  })
})

describe("Admin review — a job with several outputs", () => {
  /** Seventeen held files (the held list's cap), every one of them held. */
  const SEVENTEEN_JOB = {
    ...HELD_JOB,
    jobType: "split-into-layers",
    mediaKind: "image" as const,
    outputCount: 17,
    outputTotal: 17,
    outputKinds: Array(17).fill("image"),
  }
  /** A base picture and 30 layers: the server previews the first 17 (its held
   *  list's cap) and counts all 31. */
  const LAYERED_JOB = { ...SEVENTEEN_JOB, outputTotal: 31 }

  const fetchedIndices = () => h.fetchHeldOutputBlob.mock.calls.map(([, index]) => index as number)
  const range = (n: number) => Array.from({ length: n }, (_, i) => i)

  it("previews the first 4 files and offers the other 13 behind a control, fetching only the 4", async () => {
    h.listHeldJobs.mockResolvedValue({ data: [SEVENTEEN_JOB], total: 1, page: 0, pageSize: 25 })
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(4))
    for (const media of screen.getAllByTestId("review-media")) expect(media.tagName).toBe("IMG")
    expect(screen.getByRole("button", { name: "+13 more" })).toBeInTheDocument()
    // The hidden files are not mounted, so none of their bytes come down.
    expect(fetchedIndices()).toEqual(range(4))
    // Every file is held, so there is nothing past the held list to note.
    expect(screen.queryByTestId("review-outputs-not-shown")).not.toBeInTheDocument()
  })

  it("reveals the rest on click, fetching each of them once and the first 4 not again", async () => {
    const user = userEvent.setup()
    h.listHeldJobs.mockResolvedValue({ data: [SEVENTEEN_JOB], total: 1, page: 0, pageSize: 25 })
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(4))
    expect(fetchedIndices()).toEqual(range(4))
    await user.click(screen.getByRole("button", { name: "+13 more" }))
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(17))
    for (const media of screen.getAllByTestId("review-media")) expect(media.tagName).toBe("IMG")
    expect([...fetchedIndices()].sort((a, b) => a - b)).toEqual(range(17))
    expect(screen.queryByTestId("review-outputs-reveal")).not.toBeInTheDocument()
  })

  it("keeps the not-shown note true before and after the reveal", async () => {
    const user = userEvent.setup()
    h.listHeldJobs.mockResolvedValue({ data: [LAYERED_JOB], total: 1, page: 0, pageSize: 25 })
    renderPage()
    expect(
      await screen.findByText("Not shown: 27 more of this job's 31 outputs (showing the first 4)."),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(4))
    // The control offers only what a click can bring up: the held files.
    await user.click(screen.getByRole("button", { name: "+13 more" }))
    expect(
      await screen.findByText("Not shown: 14 more of this job's 31 outputs (showing the first 17)."),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(17))
    expect([...fetchedIndices()].sort((a, b) => a - b)).toEqual(range(17))
  })

  it("shows no control for a job of exactly 4 files", async () => {
    h.listHeldJobs.mockResolvedValue({
      data: [{ ...SEVENTEEN_JOB, outputCount: 4, outputTotal: 4, outputKinds: Array(4).fill("image") }],
      total: 1,
      page: 0,
      pageSize: 25,
    })
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(4))
    expect(fetchedIndices()).toEqual(range(4))
    expect(screen.queryByTestId("review-outputs-reveal")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /more/ })).not.toBeInTheDocument()
  })

  it("previews a video object as a video, by the object's own kind", async () => {
    // The JOB says image; the object says video. The object wins.
    h.listHeldJobs.mockResolvedValue({
      data: [{ ...HELD_JOB, mediaKind: "image" as const, outputCount: 1, outputTotal: 1, outputKinds: ["video"] }],
      total: 1,
      page: 0,
      pageSize: 25,
    })
    renderPage()
    const media = await screen.findByTestId("review-media")
    expect(media.tagName).toBe("VIDEO")
    expect(media).toHaveAttribute("src", "blob:held-preview")
  })

  it("offers an other object as a download, never as the job's player", async () => {
    // A VIDEO job whose file the gate could not place: no <video> guessed from the job.
    h.listHeldJobs.mockResolvedValue({
      data: [{ ...HELD_JOB, mediaKind: "video" as const, outputCount: 1, outputTotal: 1, outputKinds: ["other"] }],
      total: 1,
      page: 0,
      pageSize: 25,
    })
    renderPage()
    const media = await screen.findByTestId("review-media")
    expect(media.tagName).toBe("A")
    expect(media).toHaveAttribute("download")
    expect(media).toHaveAttribute("href", "blob:held-preview")
    expect(document.querySelector("video")).toBeNull()
    expect(document.querySelector("img")).toBeNull()
  })

  it("shows no note when every output is previewed", async () => {
    h.listHeldJobs.mockResolvedValue({
      data: [{ ...LAYERED_JOB, outputCount: 3, outputTotal: 3, outputKinds: ["image", "image", "image"] }],
      total: 1,
      page: 0,
      pageSize: 25,
    })
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(3))
    expect(screen.queryByTestId("review-outputs-not-shown")).not.toBeInTheDocument()
  })

  it("shows no note for a job from a server that sends no total (read as the previewable count)", async () => {
    renderPage()
    expect(await screen.findByTestId("review-media")).toBeInTheDocument()
    expect(screen.getAllByTestId("review-media")).toHaveLength(1)
    expect(screen.queryByTestId("review-outputs-not-shown")).not.toBeInTheDocument()
  })

  it("renders each output by its own kind", async () => {
    h.listHeldJobs.mockResolvedValue({
      data: [{ ...HELD_JOB, outputCount: 2, outputTotal: 2, outputKinds: ["video", "image"] }],
      total: 1,
      page: 0,
      pageSize: 25,
    })
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId("review-media")).toHaveLength(2))
    expect(screen.getAllByTestId("review-media").map((m) => m.tagName)).toEqual(["VIDEO", "IMG"])
  })
})

describe("Admin review — decisions log", () => {
  it("renders the log with the resolver and the human-readable verdict", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("tab", { name: /Decisions log/ }))
    expect(await screen.findByText("ops@nodaro.example")).toBeInTheDocument()
    // Scoped to the table: the filter row's own <option> labels carry the same
    // words, and a page-wide match would pass on those instead.
    const log = within(screen.getByRole("table"))
    expect(log.getByText("Rejected")).toBeInTheDocument()
    expect(log.getByText("Review")).toBeInTheDocument()
    expect(log.getByText("rejected by ops: shows a real person")).toBeInTheDocument()
  })

  it("renders the empty log state when nothing has been decided", async () => {
    const user = userEvent.setup()
    h.listReviewDecisions.mockResolvedValue({ data: [], total: 0, page: 0, pageSize: 50 })
    renderPage()
    await user.click(await screen.findByRole("tab", { name: /Decisions log/ }))
    expect(await screen.findByText("No decisions recorded yet.")).toBeInTheDocument()
  })
})
