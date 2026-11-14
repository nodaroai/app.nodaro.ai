import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { toast } from "sonner"
import { PlatformCard } from "../platform-card"
import { disconnectSocial, type SocialProviderInfo } from "@/lib/api"
import { runtimeCallbackOrigin } from "@/lib/runtime-config"
import type { SocialConnection } from "@/types/nodes"

// `asChild` must be honoured, not dropped: the real Button renders a Radix
// Slot that MERGES into its child, and AlertDialogAction/Cancel use that form.
// A mock that wraps regardless produces <button><button>, which doubles every
// dialog button and makes an accessible-name query ambiguous — a DOM shape the
// app never has.
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) =>
    asChild ? children : <button {...props}>{children}</button>,
}))
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}))
// Radix DropdownMenu → plain DOM (jsdom lacks the pointer machinery), same
// shells as gvp-continue-control.test.tsx. The account row uses `onSelect`,
// which is the Radix spelling, so the shell maps that too.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  DropdownMenuContent: ({ children }: any) => <div data-testid="menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect, onClick }: any) => (
    <button type="button" onClick={onSelect ?? onClick}>{children}</button>
  ),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The origin the connect pop-up's callback page answers on. In this test window
// (no runtime config, an http origin) the real helper gives this page's own
// origin; one test puts the page on the app's own host instead.
vi.mock("@/lib/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-config")>()),
  runtimeCallbackOrigin: vi.fn(() => window.location.origin),
}))

// Deferred read (call-time, not factory-time) so each describe can flip the
// edition without re-importing the component.
let cloudEdition = false
vi.mock("@/lib/edition", () => ({
  isCloud: () => cloudEdition,
}))

const connectSocialCustom = vi.fn(async (_platform: string, _fields: Record<string, string>) => ({
  success: true,
  platform: "bluesky",
  username: "@me",
}))
const getSocialAuthUrl = vi.fn(async (_platform: string) => ({ url: "https://example.test/oauth" }))
vi.mock("@/lib/api", () => ({
  getSocialAuthUrl: (platform: string) => getSocialAuthUrl(platform),
  disconnectSocial: vi.fn(),
  connectTelegram: vi.fn(),
  connectSocialCustom: (platform: string, fields: Record<string, string>) => connectSocialCustom(platform, fields),
  setDefaultSocialConnection: vi.fn(),
  // The real predicate, verbatim: a 404 `not_found` is "already gone".
  isNotFoundError: (err: unknown) => err instanceof Error && (err as { code?: unknown }).code === "not_found",
}))

function provider(overrides: Partial<SocialProviderInfo> = {}): SocialProviderInfo {
  return {
    id: "bluesky",
    label: "Bluesky",
    connectKind: "custom_fields",
    editor: "normal",
    category: "social",
    capabilities: { schedule: true, comment: false, media: ["image", "text"], refresh: "none" },
    available: true,
    customFields: [
      { key: "service", label: "Service", type: "text", defaultValue: "https://bsky.social", validation: "^https?://.+" },
      { key: "identifier", label: "Handle or email", type: "text", validation: "^.{3,}$" },
      { key: "password", label: "App password", type: "password", validation: "^.{8,}$" },
    ],
    ...overrides,
  }
}

describe("PlatformCard (provider-driven)", () => {
  beforeEach(() => {
    cloudEdition = false
  })

  // An unavailable network is no longer this component's job — it renders as
  // ComingSoonCard, and the edition-specific assertions moved with it to
  // coming-soon-card.test.tsx rather than being dropped.

  it("opens the FieldSpec-driven form and submits trimmed values", async () => {
    render(<PlatformCard provider={provider()} connections={[]} onConnectionChange={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }))
    expect(screen.getByTestId("dialog")).toBeTruthy()

    // Default value pre-filled from the spec.
    const service = screen.getByLabelText("Service") as HTMLInputElement
    expect(service.value).toBe("https://bsky.social")

    fireEvent.change(screen.getByLabelText("Handle or email"), { target: { value: "  me.bsky.social  " } })
    fireEvent.change(screen.getByLabelText("App password"), { target: { value: "app-pass-123" } })

    const submit = screen.getAllByRole("button", { name: /^Connect$/ }).at(-1)!
    fireEvent.click(submit)

    await waitFor(() => expect(connectSocialCustom).toHaveBeenCalled())
    expect(connectSocialCustom).toHaveBeenCalledWith("bluesky", {
      service: "https://bsky.social",
      identifier: "me.bsky.social",
      password: "app-pass-123",
    })
  })

  it("keeps submit disabled while a field fails its regex", () => {
    render(<PlatformCard provider={provider()} connections={[]} onConnectionChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }))

    // identifier/password empty -> validation error -> submit disabled
    const submit = screen.getAllByRole("button", { name: /^Connect$/ }).at(-1)!
    expect((submit as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("PlatformCard (cloud edition)", () => {
  beforeEach(() => {
    cloudEdition = true
  })

  it("leaves available networks untouched on cloud", () => {
    render(<PlatformCard provider={provider()} connections={[]} onConnectionChange={() => {}} />)
    expect(screen.queryByText(/Coming soon/i)).toBeNull()
    expect(screen.getByRole("button", { name: /^Connect$/ })).toBeTruthy()
  })
})

function connection(overrides: Partial<SocialConnection> = {}): SocialConnection {
  return {
    id: "conn-1",
    platform: "facebook",
    platform_user_id: "p1",
    platform_username: "pageone",
    platform_avatar_url: null,
    display_name: "Page One",
    ...overrides,
  }
}

/**
 * #722 — since #712 an owner-scoped DELETE answers 404 when it matched nothing
 * (a row another tab already removed, a list rendered before a refetch). For a
 * disconnect that IS the requested end state, so the card must refresh and
 * report success, never "Failed to disconnect" for a row that is genuinely gone.
 */
describe("PlatformCard (disconnecting an already-removed account)", () => {
  const meta = (): SocialProviderInfo =>
    provider({
      id: "facebook",
      label: "Facebook",
      connectKind: "oauth2",
      customFields: undefined,
      capabilities: { schedule: true, comment: false, media: ["image", "video"], refresh: "reconnect" },
    })
  /**
   * Disconnect now sits in the row's menu and asks before it severs. The menu
   * item and the confirming button deliberately carry the SAME word, so each
   * click is scoped to its own container rather than matched by name alone.
   */
  const openDisconnect = () =>
    fireEvent.click(within(screen.getByTestId("menu")).getByRole("button", { name: /^Disconnect$/i }))

  const disconnect = async () => {
    openDisconnect()
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: /^Disconnect$/i }))
  }

  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    vi.mocked(disconnectSocial).mockReset()
  })

  it("asks before severing an account, and does nothing until confirmed", async () => {
    vi.mocked(disconnectSocial).mockResolvedValueOnce(undefined as never)
    render(<PlatformCard provider={meta()} connections={[connection()]} onConnectionChange={vi.fn()} />)

    openDisconnect()
    expect(await screen.findByRole("alertdialog")).toBeTruthy()
    // The menu item alone must not have called anything.
    expect(disconnectSocial).not.toHaveBeenCalled()
  })

  it("treats a 404 as already gone: success toast + list refresh, no error", async () => {
    vi.mocked(disconnectSocial).mockRejectedValueOnce(Object.assign(new Error("Connection not found"), { code: "not_found" }))
    const onConnectionChange = vi.fn()
    render(<PlatformCard provider={meta()} connections={[connection()]} onConnectionChange={onConnectionChange} />)
    await disconnect()
    await waitFor(() => expect(onConnectionChange).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("still reports a real failure", async () => {
    vi.mocked(disconnectSocial).mockRejectedValueOnce(new Error("boom"))
    const onConnectionChange = vi.fn()
    render(<PlatformCard provider={meta()} connections={[connection()]} onConnectionChange={onConnectionChange} />)
    await disconnect()
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
  })
})

describe("PlatformCard (reconnect surfacing)", () => {
  const meta = (): SocialProviderInfo =>
    provider({
      id: "facebook",
      label: "Facebook",
      connectKind: "oauth2",
      customFields: undefined,
      capabilities: { schedule: true, comment: false, media: ["image", "video"], refresh: "reconnect" },
    })

  beforeEach(() => {
    getSocialAuthUrl.mockClear()
    // jsdom has no real popup; handleConnect only needs a truthy handle.
    vi.stubGlobal("open", vi.fn(() => ({ closed: false })))
  })

  // The redesign replaces the inline "session expired" sentence with a health
  // dot, so the words now live in the dot's accessible name — still announced,
  // and still never colour alone.
  const expiredDots = () => screen.queryAllByRole("img", { name: /Session expired/i })

  it("warns and offers Reconnect for an account the worker flagged", () => {
    render(
      <PlatformCard
        provider={meta()}
        connections={[connection({ reconnect_needed: true })]}
        onConnectionChange={() => {}}
      />,
    )
    expect(expiredDots()).toHaveLength(1)
    expect(screen.getByRole("button", { name: /Reconnect/i })).toBeTruthy()
  })

  it("stays quiet for a healthy account", () => {
    render(<PlatformCard provider={meta()} connections={[connection()]} onConnectionChange={() => {}} />)
    expect(expiredDots()).toHaveLength(0)
    expect(screen.queryByRole("button", { name: /Reconnect/i })).toBeNull()
  })

  it("flags only the account that actually expired", () => {
    render(
      <PlatformCard
        provider={meta()}
        connections={[
          connection({ id: "a", display_name: "Live Page" }),
          connection({ id: "b", display_name: "Dead Page", reconnect_needed: true }),
        ]}
        onConnectionChange={() => {}}
      />,
    )
    expect(expiredDots()).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: /Reconnect/i })).toHaveLength(1)
  })

  it("re-runs the OAuth flow when Reconnect is clicked", async () => {
    render(
      <PlatformCard
        provider={meta()}
        connections={[connection({ reconnect_needed: true })]}
        onConnectionChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Reconnect/i }))
    await waitFor(() => expect(getSocialAuthUrl).toHaveBeenCalledWith("facebook"))
  })
})

/**
 * The OAuth pop-up reports its result with a `message` event. Any window able
 * to post to this page can send one: a frame embedded in it, or another tab
 * holding a reference to it. Only the pop-up the card opened, from the origin
 * its callback page answers on (this page's own, or the kept origin when this
 * page is on the app's own host), may finish the connect. Anything else is
 * ignored silently and changes nothing, so the real result is still taken
 * when it arrives.
 */
describe("PlatformCard (the connect pop-up's result)", () => {
  const meta = (): SocialProviderInfo =>
    provider({
      id: "facebook",
      label: "Facebook",
      connectKind: "oauth2",
      customFields: undefined,
      capabilities: { schedule: true, comment: false, media: ["image", "video"], refresh: "reconnect" },
    })

  /** What the stubbed `window.open` returned: the real pop-up. A fresh one per test. */
  let popup: { closed: boolean }

  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    popup = { closed: false }
    vi.stubGlobal("open", vi.fn(() => popup))
    vi.mocked(runtimeCallbackOrigin).mockImplementation(() => window.location.origin)
  })

  /** Deliver a `message` event the way the browser does: `source` is the window that sent it. */
  function deliver(data: unknown, { origin = window.location.origin, source = popup as unknown } = {}) {
    const event = new MessageEvent("message", { data, origin })
    // jsdom's constructor only takes a real window as `source`.
    Object.defineProperty(event, "source", { value: source })
    act(() => {
      window.dispatchEvent(event)
    })
  }

  async function startConnect() {
    const onConnectionChange = vi.fn()
    render(<PlatformCard provider={meta()} connections={[]} onConnectionChange={onConnectionChange} />)
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }))
    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1))
    return onConnectionChange
  }

  const connected = { type: "social-auth-success", platform: "facebook" }

  it("ignores a forged result from another origin, and still takes the pop-up's own", async () => {
    const onConnectionChange = await startConnect()

    deliver(connected, { origin: "https://attacker.example" })
    expect(toast.success).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()

    deliver(connected)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith("Connected to Facebook!")
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
  })

  it("ignores a result from this origin that another window sent", async () => {
    const onConnectionChange = await startConnect()
    const anotherWindow = { closed: false }

    deliver(connected, { source: anotherWindow })
    deliver({ type: "social-auth-error", message: "Your session expired. Sign in again." }, { source: anotherWindow })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()

    deliver(connected)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
  })

  it("does not let a forged error show its text or end the wait", async () => {
    const onConnectionChange = await startConnect()

    deliver({ type: "social-auth-error", message: "Your session expired. Sign in again." }, { origin: "https://attacker.example" })
    expect(toast.error).not.toHaveBeenCalled()

    // The listener is still there: the real result still lands.
    deliver(connected)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
  })

  it("shows the pop-up's own error, or the generic one when it carries no text", async () => {
    await startConnect()
    deliver({ type: "social-auth-error", message: "No Facebook pages found." })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("No Facebook pages found.")
  })

  it("falls back to the generic error when the pop-up's error carries no text", async () => {
    await startConnect()
    deliver({ type: "social-auth-error" })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Connection failed")
  })

  it("on the app's own host, takes the result from the kept origin its callback page answers on, and none from this page's own", async () => {
    const KEPT = "https://app.example.test"
    vi.mocked(runtimeCallbackOrigin).mockImplementation(() => KEPT)
    const onConnectionChange = await startConnect()

    deliver(connected) // this page's own origin: the callback page never answers here
    expect(toast.success).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()

    deliver(connected, { origin: KEPT })
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
  })

  it("takes only the expected shape, even from the pop-up", async () => {
    const onConnectionChange = await startConnect()

    deliver({ type: "social-auth-success", platform: "instagram" }) // another network's result
    deliver({ type: "social-auth-success" })
    deliver({ type: "something-else", platform: "facebook" })
    deliver("social-auth-success")
    deliver(null)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
  })
})

describe("choosing which account publishes by default", () => {
  // Which account a publish node uses when it names none — the normal case for
  // anything the Copilot builds, since it is forbidden to write a destination.
  const twoAccounts = [
    { id: "a", platform: "telegram", display_name: "Main", platform_username: "main", platform_avatar_url: null, is_default: true },
    { id: "b", platform: "telegram", display_name: "Side", platform_username: "side", platform_avatar_url: null },
  ] as never[]

  const renderCard = (connections: never[]) =>
    render(<PlatformCard provider={provider({ id: "telegram", label: "Telegram" })} connections={connections} onConnectionChange={() => {}} />)

  it("says nothing when there is nothing to choose between", () => {
    // One account is already where everything goes. A "Default" control beside
    // it would be a control that does nothing.
    renderCard([twoAccounts[0]!])

    expect(screen.queryByText(/make default/i)).toBeNull()
    expect(screen.queryByText(/^Default$/)).toBeNull()
  })

  it("marks the one that is, and offers the one that is not", () => {
    renderCard(twoAccounts)

    expect(screen.getByText(/^Default$/)).toBeTruthy()
    expect(screen.getByText(/make default/i)).toBeTruthy()
  })

  it("offers it for BOTH when neither has been chosen", () => {
    // Before anyone picks, the publisher falls back to oldest-first — which is
    // deterministic but not a decision, so both are still offerable.
    renderCard(twoAccounts.map((c) => ({ ...(c as object), is_default: false })) as never[])

    expect(screen.getAllByText(/make default/i)).toHaveLength(2)
  })
})
