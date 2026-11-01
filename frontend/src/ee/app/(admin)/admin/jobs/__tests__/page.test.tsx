import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/ee/hooks/queries/use-admin-queries", () => ({
  useAdminJobs: vi.fn(),
  useAdminJobsInfinite: vi.fn(),
  useAdminJobSources: vi.fn(),
  useAllAdminUsersLite: vi.fn(),
}))

import {
  useAdminJobs,
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
    data: { jobs: [], userNotFound: true },
    isLoading: false,
  } as unknown as ReturnType<typeof useAdminJobs>)
  vi.mocked(useAdminJobSources).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useAdminJobSources>)
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
})
