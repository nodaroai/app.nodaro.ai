/**
 * Take back / restore an account's free signup credits — the ONE component the
 * user panel and the free-grants table share.
 *
 * Money moves only after the admin confirms; the action offered follows the
 * grant state; the server's refusal is shown as it was written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"
import { FreeGrantActions } from "../free-grant-actions"

const USER_ID = "00000000-0000-4000-8000-0000000000b2"
const REVOKE = `POST /v1/admin/free-grants/${USER_ID}/revoke`
const ACTIVATE = `POST /v1/admin/free-grants/${USER_ID}/activate`

interface Reply {
  readonly status?: number
  readonly body: unknown
  /** The response body is not JSON (a proxy error page). */
  readonly notJson?: boolean
}
type Route = () => Reply | Promise<Reply>

let routes: Record<string, Route> = {}

const fetchMock = vi.fn(async (...call: [url: string, init?: RequestInit]) => {
  const [url, init] = call
  const key = `${init?.method ?? "GET"} ${url}`
  const route = routes[key]
  if (!route) throw new Error(`unexpected fetch: ${key}`)
  const reply = await route()
  const status = reply.status ?? 200
  const json = reply.notJson
    ? async () => {
        throw new SyntaxError("Unexpected token <")
      }
    : async () => reply.body
  return { ok: status < 400, status, json } as unknown as Response
})

const sentTo = (key: string) =>
  fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === key)

function renderActions(state: string | null | undefined) {
  const onChanged = vi.fn()
  const onRowClick = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(
    <QueryClientProvider client={qc}>
      {/* A row that toggles on click, as the admin tables' rows can. */}
      <div onClick={onRowClick}>
        <FreeGrantActions userId={USER_ID} state={state} onChanged={onChanged} />
      </div>
    </QueryClientProvider>,
  )
  return { ...view, onChanged, onRowClick }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  routes = {
    [REVOKE]: () => ({ body: { data: { userId: USER_ID, state: "revoked", credits: 1200 } } }),
    [ACTIVATE]: () => ({ body: { data: { userId: USER_ID, state: "granted", credits: 1200 } } }),
  }
})

describe("which action is offered", () => {
  it.each([["unclaimed"], [null], [undefined], ["something-new"]])("offers nothing for %s", (state) => {
    renderActions(state)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })

  it.each([["granted"], ["withheld"]])("offers Take back for %s credits", (state) => {
    renderActions(state)
    expect(screen.getByRole("button", { name: "Take back free credits" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Restore free credits" })).toBeNull()
  })

  it("offers Restore once the credits were taken back", () => {
    renderActions("revoked")
    expect(screen.getByRole("button", { name: "Restore free credits" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Take back free credits" })).toBeNull()
  })
})

describe("taking the credits back", () => {
  it("asks first, then takes them back and says how many", async () => {
    const user = userEvent.setup()
    const { onChanged } = renderActions("granted")

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Take back the free credits?")).toBeInTheDocument()
    expect(within(dialog).getByText(/Credits it bought are not touched/)).toBeInTheDocument()
    // Opening the dialog moves nothing.
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Take back" }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(REVOKE)).toHaveLength(1)
    expect(sentTo(ACTIVATE)).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith(`Took back ${(1200).toLocaleString()} free credits`)
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("says it plainly when the server reports no amount", async () => {
    const user = userEvent.setup()
    routes[REVOKE] = () => ({ body: { data: { userId: USER_ID, state: "revoked" } } })
    const { onChanged } = renderActions("withheld")

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Take back" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Free credits taken back"))
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("Cancel sends nothing", async () => {
    const user = userEvent.setup()
    const { onChanged } = renderActions("granted")

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the server's refusal word for word", async () => {
    const user = userEvent.setup()
    const message = "This is (or was) a paying account — use Adjust credits instead."
    routes[REVOKE] = () => ({ status: 409, body: { error: { code: "paid_account", message } } })
    const { onChanged } = renderActions("granted")

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Take back" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(toast.success).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it("still says what failed when the error response has no readable body", async () => {
    const user = userEvent.setup()
    routes[REVOKE] = () => ({ status: 502, body: null, notJson: true })
    renderActions("granted")

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Take back" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to take back the free credits"))
  })

  it("cannot be pressed again while the request is in flight", async () => {
    const user = userEvent.setup()
    let release: (() => void) | null = null
    routes[REVOKE] = () =>
      new Promise<Reply>((resolve) => {
        release = () => resolve({ body: { data: { userId: USER_ID, state: "revoked", credits: 1200 } } })
      })
    const { onChanged } = renderActions("granted")

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Take back" }))

    await waitFor(() => expect(release).not.toBeNull())
    expect(screen.getByRole("button", { name: "Take back free credits" })).toBeDisabled()

    release!()
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(REVOKE)).toHaveLength(1)
  })
})

describe("restoring the credits", () => {
  it("asks first, then restores and says how many came back", async () => {
    const user = userEvent.setup()
    const { onChanged } = renderActions("revoked")

    await user.click(screen.getByRole("button", { name: "Restore free credits" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Restore the free credits?")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Restore" }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(ACTIVATE)).toHaveLength(1)
    expect(sentTo(REVOKE)).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith(`Restored ${(1200).toLocaleString()} free credits`)
  })

  it("shows a restore refusal word for word", async () => {
    const user = userEvent.setup()
    const message = "This account's free credits were not taken back."
    routes[ACTIVATE] = () => ({ status: 409, body: { error: { code: "not_revoked", message } } })
    const { onChanged } = renderActions("revoked")

    await user.click(screen.getByRole("button", { name: "Restore free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restore" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(onChanged).not.toHaveBeenCalled()
  })
})

describe("inside a clickable row", () => {
  it("neither the button nor the dialog toggles the row it sits in", async () => {
    const user = userEvent.setup()
    const { onRowClick, onChanged } = renderActions("granted")

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    await user.click(screen.getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Take back" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))

    expect(onRowClick).not.toHaveBeenCalled()
  })
})
