import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

vi.mock("@/ee/components/consent/consent-api", () => ({
  SOURCE_APP: "app",
  fetchConsentStatus: vi.fn(),
  grantConsent: vi.fn().mockResolvedValue(undefined),
  withdrawConsent: vi.fn().mockResolvedValue(undefined),
}))

import { ConsentSettings } from "../consent-settings"
import { fetchConsentStatus, grantConsent, withdrawConsent } from "@/ee/components/consent/consent-api"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(grantConsent).mockResolvedValue(undefined)
  vi.mocked(withdrawConsent).mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe("ConsentSettings", () => {
  it("renders nothing until the status resolves", () => {
    vi.mocked(fetchConsentStatus).mockReturnValue(new Promise(() => {})) // never resolves
    const { container } = render(<ConsentSettings />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the toggle ON for a subscribed user", async () => {
    vi.mocked(fetchConsentStatus).mockResolvedValue({ status: "granted", subscribed: true })
    render(<ConsentSettings />)
    expect(await screen.findByRole("switch")).toBeChecked()
  })

  it("withdraws when toggled off", async () => {
    vi.mocked(fetchConsentStatus).mockResolvedValue({ status: "granted", subscribed: true })
    render(<ConsentSettings />)
    fireEvent.click(await screen.findByRole("switch"))
    await waitFor(() => expect(withdrawConsent).toHaveBeenCalled())
    expect(grantConsent).not.toHaveBeenCalled()
  })

  it("grants when toggled on from an unsubscribed state", async () => {
    vi.mocked(fetchConsentStatus).mockResolvedValue({ status: "withdrawn", subscribed: false })
    render(<ConsentSettings />)
    const sw = await screen.findByRole("switch")
    expect(sw).not.toBeChecked()
    fireEvent.click(sw)
    await waitFor(() => expect(grantConsent).toHaveBeenCalledWith("app"))
    expect(withdrawConsent).not.toHaveBeenCalled()
  })
})
