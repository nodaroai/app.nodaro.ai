import { describe, it, expect, vi } from "vitest"
import { render, fireEvent, screen, waitFor } from "@testing-library/react"
import { PlatformCard } from "../platform-card"
import type { SocialProviderInfo } from "@/lib/api"

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

const connectSocialCustom = vi.fn(async (_platform: string, _fields: Record<string, string>) => ({
  success: true,
  platform: "bluesky",
  username: "@me",
}))
vi.mock("@/lib/api", () => ({
  getSocialAuthUrl: vi.fn(),
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
