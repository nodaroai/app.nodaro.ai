import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent, screen, waitFor } from "@testing-library/react"
import { PlatformCard } from "../platform-card"
import type { SocialProviderInfo } from "@/lib/api"
import type { SocialConnection } from "@/types/nodes"

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
}))

function provider(overrides: Partial<SocialProviderInfo> = {}): SocialProviderInfo {
  return {
    id: "bluesky",
    label: "Bluesky",
    connectKind: "custom_fields",
    editor: "normal",
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

  it("renders an unavailable provider disabled, with the missing env names", () => {
    render(
      <PlatformCard
        provider={provider({ id: "reddit", label: "Reddit", connectKind: "oauth2", available: false, missingEnv: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], customFields: undefined })}
        connections={[]}
        onConnectionChange={() => {}}
      />,
    )
    expect(screen.getAllByText(/Requires setup/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET/)).toBeTruthy()
    const btn = screen.getByRole("button", { name: /Requires setup/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

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

describe("PlatformCard (cloud edition — Coming soon)", () => {
  beforeEach(() => {
    cloudEdition = true
  })

  it("shows Coming soon and hides deployment internals for an unconfigured network", () => {
    render(
      <PlatformCard
        provider={provider({ id: "reddit", label: "Reddit", connectKind: "oauth2", available: false, missingEnv: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], customFields: undefined })}
        connections={[]}
        onConnectionChange={() => {}}
      />,
    )
    // Cloud customers can't set env vars — the setup internals are noise to
    // them and must not render: not the env names, not "Requires setup".
    expect(screen.getAllByText(/Coming soon/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/REDDIT_CLIENT_ID/)).toBeNull()
    expect(screen.queryByText(/Requires setup/i)).toBeNull()
    const btn = screen.getByRole("button", { name: /Coming soon/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
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

  it("warns and offers Reconnect for an account the worker flagged", () => {
    render(
      <PlatformCard
        provider={meta()}
        connections={[connection({ reconnect_needed: true })]}
        onConnectionChange={() => {}}
      />,
    )
    expect(screen.getByText(/Session expired/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Reconnect/i })).toBeTruthy()
  })

  it("stays quiet for a healthy account", () => {
    render(<PlatformCard provider={meta()} connections={[connection()]} onConnectionChange={() => {}} />)
    expect(screen.queryByText(/Session expired/i)).toBeNull()
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
    expect(screen.getAllByText(/Session expired/i)).toHaveLength(1)
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
