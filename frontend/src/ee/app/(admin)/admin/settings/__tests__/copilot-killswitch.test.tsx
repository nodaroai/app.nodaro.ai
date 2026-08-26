/**
 * The copilot kill switch, end to end through the admin page — the RENDER and
 * WRITE-BACK half specifically, because that is where a runtime setting has
 * historically been "built" and still not settable: hydrated wrong, or a save
 * that never carries the key. tsc proves the shape; only this proves the flip
 * reaches the mutation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mutateAsync = vi.fn().mockResolvedValue({})
const settings = {
  ai_provider: "kie" as const,
  cost_markup_percent: 0,
  carousel_video_autoplay: true,
  apps_page_video_autoplay: true,
  copilot_enabled: true,
  featured_app_ids: [] as string[],
  featured_apps_limit: 20,
  apps_auto_scroll_seconds: 4,
}

vi.mock("@/ee/hooks/queries/use-admin-queries", () => ({
  useAdminSettings: () => ({ data: settings, isLoading: false, error: null }),
}))
vi.mock("@/hooks/queries/use-app-settings-queries", () => ({
  useUpdateSettingMutation: () => ({ mutateAsync }),
}))
vi.mock("@/lib/edition", () => ({
  isCloud: () => true,
  // Off, so the provider/markup rows do not render and cannot muddy the diff.
  isFeatureEnabled: () => false,
}))

const AdminSettingsPage = (await import("../page")).default

beforeEach(() => {
  mutateAsync.mockClear()
  settings.copilot_enabled = true
})

const toggle = () => screen.getByLabelText("Copilot enabled")
const save = () => screen.getByRole("button", { name: /Save Changes/i })

describe("the copilot kill switch on the admin page", () => {
  it("shows the saved state, not a default", () => {
    settings.copilot_enabled = false
    render(<AdminSettingsPage />)
    // If hydration is broken the switch shows its useState(true) default while
    // the copilot is actually off — an operator flipping a lie.
    expect(toggle().getAttribute("aria-checked")).toBe("false")
  })

  it("keeps Save disabled until something actually changes", () => {
    render(<AdminSettingsPage />)
    expect(save()).toBeDisabled()
  })

  it("sends copilot_enabled=false when turned off and saved", async () => {
    render(<AdminSettingsPage />)
    fireEvent.click(toggle())
    expect(save()).toBeEnabled()
    fireEvent.click(save())
    // The write-back line the compiler cannot check: the save diff MUST carry
    // this key, or the switch moves and nothing happens.
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ key: "copilot_enabled", value: false }),
    )
  })

  it("does not send it when the toggle was not touched", async () => {
    render(<AdminSettingsPage />)
    // Change something else so Save is enabled without touching the copilot.
    fireEvent.click(screen.getByLabelText(/Auto-play videos in homepage carousel/i))
    fireEvent.click(save())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    const keys = mutateAsync.mock.calls.map((c) => c[0].key)
    expect(keys).not.toContain("copilot_enabled")
  })
})
