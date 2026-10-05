import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u-1" }, access_token: "jwt-token" } } })),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: h.getSession } }),
}))
vi.mock("@/lib/workspace-context", () => ({
  getActiveWorkspaceId: () => null,
  clearActiveWorkspaceAfterRefusal: vi.fn(),
}))

import { getWorkflowAccess } from "@/lib/api"

const ANSWER = {
  data: { access: "edit", workspaceId: null, visibility: "private", canChangeVisibility: false, canShare: false, canRun: true },
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ANSWER }) as Response)
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

/** What the request was sent with: the URL, and the `init` handed to fetch. */
function sent(): { url: string; init: RequestInit } {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, init }
}

/**
 * The canvas bounds each ask of its access (T97, `ACCESS_ASK_TIMEOUT_MS` in
 * `workflow-access-mode.ts`) by aborting the signal it passes here. That only
 * cancels the request if `getWorkflowAccess` hands the signal on to fetch, so
 * this runs the real function down to the network boundary.
 */
describe("getWorkflowAccess", () => {
  it("hands the caller's AbortSignal to fetch, the same object", async () => {
    const controller = new AbortController()
    await expect(getWorkflowAccess("wf 1", { signal: controller.signal })).resolves.toEqual(ANSWER)

    const { url, init } = sent()
    expect(url).toBe("/v1/workflows/wf%201/access")
    expect(init.signal).toBe(controller.signal)
    expect(init.headers).toMatchObject({ Authorization: "Bearer jwt-token" })
  })

  it("so aborting that signal reaches the request in flight", async () => {
    // A fetch that hangs until its own signal aborts, as the browser's does.
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      }),
    )
    const controller = new AbortController()
    const asking = getWorkflowAccess("wf-1", { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sent().init.signal?.aborted).toBe(false)

    controller.abort()
    await expect(asking).rejects.toMatchObject({ name: "AbortError" })
    expect(sent().init.signal?.aborted).toBe(true)
  })

  it("sends no signal when none was given", async () => {
    await getWorkflowAccess("wf-1")
    expect("signal" in sent().init).toBe(false)
  })
})
