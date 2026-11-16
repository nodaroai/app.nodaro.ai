import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

const h = vi.hoisted(() => ({
  offer: {
    mode: null as "offer" | "consent-pending" | null,
    popupDue: false,
    credits: "1,500",
    claim: vi.fn(),
    markShown: vi.fn(),
    answerLater: vi.fn(),
  },
  pathname: "/projects",
}))

vi.mock("../use-welcome-offer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../use-welcome-offer")>()
  return { ...actual, useWelcomeOffer: () => h.offer }
})
vi.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: h.pathname }) }))

import { WelcomeOfferPopup } from "../welcome-offer-popup"
import { useWelcomeOfferStore } from "../welcome-offer-store"
import { CONSENT_REQUIRED_EVENT } from "@/lib/consent-required-event"

beforeEach(() => {
  vi.clearAllMocks()
  h.offer.mode = null
  h.offer.popupDue = false
  h.pathname = "/projects"
  useWelcomeOfferStore.setState({ claimedCredits: null, consentAskVersion: 0 })
})

describe("WelcomeOfferPopup", () => {
  it("renders nothing when the offer does not apply", () => {
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens by itself on the home screen while the popup is due, and tells the server once", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("1,500 free credits are waiting for you")).toBeInTheDocument()
    expect(h.offer.markShown).toHaveBeenCalledTimes(1)
    expect(h.offer.answerLater).not.toHaveBeenCalled()
  })

  it("stays closed away from the home screen, and counts nothing", () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    h.pathname = "/gallery"
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(h.offer.markShown).not.toHaveBeenCalled()
  })

  it("stays closed while the popup is not due (the banner remains)", () => {
    h.offer.mode = "offer"
    h.offer.popupDue = false
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(h.offer.markShown).not.toHaveBeenCalled()
  })

  it("'Maybe later' closes and answers — the popup does not open by itself again", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: "Maybe later" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(h.offer.answerLater).toHaveBeenCalledTimes(1)
    expect(h.offer.claim).not.toHaveBeenCalled()
  })

  it("the × closes without an answer: nothing more is posted", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(h.offer.answerLater).not.toHaveBeenCalled()
    expect(h.offer.markShown).toHaveBeenCalledTimes(1)
  })

  it("Escape closes without an answer: nothing more is posted", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(h.offer.answerLater).not.toHaveBeenCalled()
    expect(h.offer.markShown).toHaveBeenCalledTimes(1)
  })

  it("a click outside closes without an answer: nothing more is posted", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    await screen.findByRole("dialog")
    // Radix attaches its outside listeners in a setTimeout(0).
    await act(() => new Promise((r) => setTimeout(r, 20)))
    const scrim = document.querySelector('[data-slot="dialog-overlay"]')
    expect(scrim).not.toBeNull()
    fireEvent.pointerDown(scrim as Element, { button: 0, pointerType: "mouse" })
    fireEvent.mouseDown(scrim as Element, { button: 0 })
    fireEvent.mouseUp(scrim as Element, { button: 0 })
    fireEvent.click(scrim as Element, { button: 0 })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(h.offer.answerLater).not.toHaveBeenCalled()
    expect(h.offer.markShown).toHaveBeenCalledTimes(1)
  })

  it("opens by itself once per mount, even if the popup stays due", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    const { rerender } = render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    rerender(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(h.offer.markShown).toHaveBeenCalledTimes(1)
  })

  it("the CTA claims, closes, and records the credits for the confirmation strip", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    h.offer.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: /add 1,500 credits/i }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(h.offer.claim).toHaveBeenCalledTimes(1)
    expect(h.offer.answerLater).not.toHaveBeenCalled()
    expect(useWelcomeOfferStore.getState().claimedCredits).toBe(1500)
  })

  it("a failed claim keeps the popup up with an error line", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    h.offer.claim.mockRejectedValue(new Error("boom"))
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: /add 1,500 credits/i }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("opens with the consent ask when the server refuses a creation, on any page", async () => {
    h.offer.mode = "consent-pending"
    h.pathname = "/workflows/abc"
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new CustomEvent(CONSENT_REQUIRED_EVENT))
    })
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Your 1,500 credits are active")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Maybe later" })).not.toBeInTheDocument()
    // The user's own action opened it: not a showing.
    expect(h.offer.markShown).not.toHaveBeenCalled()
  })
})
