import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/ee/hooks/queries/use-admin-queries", () => ({
  useAdminJobDetail: vi.fn(),
  useAdminJobs: vi.fn(),
  useAdminJobsInfinite: vi.fn(),
  useAdminJobSources: vi.fn(),
  useAllAdminUsersLite: vi.fn(),
}))

import {
  useAdminJobDetail,
  useAdminJobs,
  useAdminJobsInfinite,
  useAdminJobSources,
  useAllAdminUsersLite,
} from "@/ee/hooks/queries/use-admin-queries"
import AdminJobsPage from "../page"

const USERS = [
  { id: "u1", email: "Dana@x.test", fullName: null, role: "user" as const },
  { id: "a1", email: "admin@x.test", fullName: null, role: "admin" as const },
]

function usersLoaded(loaded: boolean) {
  vi.mocked(useAllAdminUsersLite).mockReturnValue(
    (loaded
      ? { data: USERS, isSuccess: true, isError: false }
      : { data: undefined, isSuccess: false, isError: false }) as unknown as ReturnType<typeof useAllAdminUsersLite>,
  )
}

function renderAt(url: string) {
  const router = createMemoryRouter([{ path: "/admin/jobs", element: <AdminJobsPage /> }], { initialEntries: [url] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const lastJobsCall = () => vi.mocked(useAdminJobs).mock.calls.at(-1)!

beforeEach(() => {
  vi.mocked(useAdminJobs).mockReturnValue({
    data: { jobs: [], userNotFound: true, filtersUnavailable: false },
    isLoading: false,
  } as unknown as ReturnType<typeof useAdminJobs>)
  vi.mocked(useAdminJobSources).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useAdminJobSources>)
  vi.mocked(useAdminJobDetail).mockReturnValue({ data: undefined, isError: false } as unknown as ReturnType<typeof useAdminJobDetail>)
  usersLoaded(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("AdminJobsPage", () => {
  it("opens with the URL's filters applied, and says when the address matches no account", () => {
    renderAt("/admin/jobs?user=dana@x.test&kind=video&minCredits=100")
    const [page, size, filters, , options] = lastJobsCall()
    expect([page, size]).toEqual([0, 50])
    expect(filters).toMatchObject({ userEmail: "dana@x.test", kind: "video", minCredits: 100, view: "table" })
    expect(options).toEqual({ enabled: true })
    expect(screen.getByRole("button", { name: "Clear Credits ≥ 100" })).toBeTruthy()
    expect(screen.getByText("No user with that email")).toBeTruthy()
  })

  it("a pick writes the URL as a new step; a typed search replaces the current one", async () => {
    const router = renderAt("/admin/jobs?kind=video")
    await userEvent.click(screen.getByRole("button", { name: "pending_review" }))
    expect(router.state.location.search).toBe("?status=pending_review&kind=video")
    expect(router.state.historyAction).toBe("PUSH")
    expect(lastJobsCall()[2]).toMatchObject({ status: "pending_review", kind: "video" })

    vi.useFakeTimers()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "cats" } })
    act(() => vi.advanceTimersByTime(300))
    expect(router.state.location.search).toBe("?status=pending_review&kind=video&q=cats")
    expect(router.state.historyAction).toBe("REPLACE")
  })

  it("says the list failed to load instead of finding no jobs", () => {
    vi.mocked(useAdminJobs).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAdminJobs>)
    renderAt("/admin/jobs")
    expect(screen.getByText("Couldn't load jobs. Try again.")).toBeTruthy()
    expect(screen.queryByText("No jobs found.")).toBeNull()
  })

  it("a link that hides the admins waits for the admin list before asking for jobs", () => {
    usersLoaded(false)
    renderAt("/admin/jobs?user=admins-hidden")
    expect(lastJobsCall()[4]).toEqual({ enabled: false })
    expect(screen.queryByText("No jobs found.")).toBeNull()
    cleanup()
    usersLoaded(true)
    renderAt("/admin/jobs?user=admins-hidden")
    const [, , filters, excluded, options] = lastJobsCall()
    expect(filters).toMatchObject({ excludeAdmins: true })
    expect(excluded).toEqual(["a1"])
    expect(options).toEqual({ enabled: true })
  })

  const NOTICE = "These filters arrive with the next release — showing jobs by status and user only."

  it("the table says when the server could not apply the newer filters", () => {
    vi.mocked(useAdminJobs).mockReturnValue({
      data: { jobs: [], userNotFound: false, filtersUnavailable: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminJobs>)
    renderAt("/admin/jobs?kind=video")
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  it("the table shows no notice when every filter applied", () => {
    renderAt("/admin/jobs?kind=video")
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it("the gallery says when the server could not apply the newer filters", () => {
    vi.mocked(useAdminJobsInfinite).mockReturnValue({
      data: { pages: [{ jobs: [], userNotFound: false, filtersUnavailable: true }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useAdminJobsInfinite>)
    renderAt("/admin/jobs?view=gallery&kind=video")
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  describe("the detail view", () => {
    // A list row: its input and output are previews (the type; the output's addresses).
    const ROW = {
      id: "0b1c2d3e-0000-4000-8000-000000000001", status: "completed", job_type: null, credits: 30, credit: null,
      provider: "kie", provider_cost: null, display_cost: null, error_message: null,
      input_data: { type: "generate-image" }, output_data: { imageUrl: "https://cdn.test/fox.png" },
      created_at: "2026-11-01T12:00:00Z", started_at: null, completed_at: null, user_id: "u1", user_email: "dana@x.test",
      workflow_id: null, workflow_name: "Unknown", workflow_execution_id: null, source: null, source_detail: null,
      source_app_name: null, workflow_project_id: null, provider_kind: null, provider_task_id: null,
      reconcile_attempts: 0, reconcile_last_error: null, provider_call_started_at: null,
    }

    function openDetail() {
      vi.mocked(useAdminJobs).mockReturnValue({
        data: { jobs: [ROW], userNotFound: false, filtersUnavailable: false },
        isLoading: false,
      } as unknown as ReturnType<typeof useAdminJobs>)
      renderAt("/admin/jobs")
      const row = screen.getByText(ROW.id.slice(0, 8)).closest("tr")!
      fireEvent.click(within(row).getAllByRole("button").at(-1)!)
      return screen.getByRole("dialog")
    }

    it("reads the whole job when it opens, and shows a loader — never the list's preview — until it is in", () => {
      const dialog = openDetail()
      expect(vi.mocked(useAdminJobDetail).mock.lastCall?.[0]).toMatchObject({ id: ROW.id, status: ROW.status, completed_at: ROW.completed_at })
      expect(within(dialog).getByLabelText("Loading the job's input and output")).toBeTruthy()
    })

    it("shows the whole input once it is read", () => {
      vi.mocked(useAdminJobDetail).mockReturnValue({
        data: { input_data: { type: "generate-image", prompt: "a red fox in the snow" }, output_data: { imageUrl: "https://cdn.test/fox.png", seed: 7 } },
        isError: false,
      } as unknown as ReturnType<typeof useAdminJobDetail>)
      const dialog = openDetail()
      expect(within(dialog).getByText("a red fox in the snow")).toBeTruthy()
    })

    it("says when the whole job could not be read", () => {
      vi.mocked(useAdminJobDetail).mockReturnValue({ data: undefined, isError: true } as unknown as ReturnType<typeof useAdminJobDetail>)
      const dialog = openDetail()
      expect(within(dialog).getByText("Couldn't load the job's input and output.")).toBeTruthy()
    })
  })
})
