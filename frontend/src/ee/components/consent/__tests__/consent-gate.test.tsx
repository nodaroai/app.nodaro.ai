import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

vi.mock("@/ee/components/consent/consent-api", () => ({
  SOURCE_APP: "app",
  fetchConsentState: vi.fn(),
  grantConsent: vi.fn().mockResolvedValue(undefined),
  declineConsent: vi.fn().mockResolvedValue(undefined),
}))

import { ConsentGate } from "../consent-gate"
import { fetchConsentState, grantConsent, declineConsent } from "@/ee/components/consent/consent-api"

const BODY = "We'll email you sometimes."

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(grantConsent).mockResolvedValue(undefined)
  vi.mocked(declineConsent).mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe("ConsentGate", () => {
  it("renders nothing when the server says not to show", async () => {
    vi.mocked(fetchConsentState).mockResolvedValue({ shouldShow: false, status: "pending" })
    const { container } = render(<ConsentGate />)
    await waitFor(() => expect(fetchConsentState).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the card with the admin-configured body when shouldShow is true", async () => {
    vi.mocked(fetchConsentState).mockResolvedValue({ shouldShow: true, status: "pending", text: BODY, version: 1 })
    render(<ConsentGate />)
    expect(await screen.findByText("Want product updates?")).toBeInTheDocument()
    expect(screen.getByText(BODY)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /keep me posted/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /no thanks/i })).toBeInTheDocument()
  })

  it("grants on 'Yes' and shows the confirmation", async () => {
    vi.mocked(fetchConsentState).mockResolvedValue({ shouldShow: true, status: "pending", text: BODY, version: 1 })
    render(<ConsentGate />)
    fireEvent.click(await screen.findByRole("button", { name: /keep me posted/i }))
    await waitFor(() => expect(grantConsent).toHaveBeenCalledWith("app"))
    expect(await screen.findByText(/on the list/i)).toBeInTheDocument()
  })

  it("declines on 'No thanks'", async () => {
    vi.mocked(fetchConsentState).mockResolvedValue({ shouldShow: true, status: "pending", text: BODY, version: 1 })
    render(<ConsentGate />)
    fireEvent.click(await screen.findByRole("button", { name: /no thanks/i }))
    await waitFor(() => expect(declineConsent).toHaveBeenCalled())
    expect(grantConsent).not.toHaveBeenCalled()
  })

  it("dismiss (X) hides the card without recording an answer", async () => {
    vi.mocked(fetchConsentState).mockResolvedValue({ shouldShow: true, status: "pending", text: BODY, version: 1 })
    render(<ConsentGate />)
    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }))
    await waitFor(() => expect(screen.queryByText("Want product updates?")).not.toBeInTheDocument())
    expect(grantConsent).not.toHaveBeenCalled()
    expect(declineConsent).not.toHaveBeenCalled()
  })
})
