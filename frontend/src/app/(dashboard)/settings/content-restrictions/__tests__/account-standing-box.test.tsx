import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import type { MyAccountStanding } from "@/lib/api"
import { AccountStandingBox } from "../account-standing-box"

/**
 * Settings → Content restrictions → where my account stands: the measures in
 * force (importing links blocked, until when or until lifted; the account
 * closed) with what the administrator told me, the warnings and the
 * infringements within the window by their complaint's reference, and the
 * window; nothing at all when there is nothing on the account.
 */

const standing = (over: Partial<MyAccountStanding> = {}): MyAccountStanding => ({ inForce: [], warnings: [], infringements: [], windowMonths: 24, ...over })

describe("AccountStandingBox", () => {
  it("shows nothing while there is nothing on the account, or nothing was read", () => {
    const { container, rerender } = render(<AccountStandingBox standing={undefined} />)
    expect(container.innerHTML).toBe("")
    rerender(<AccountStandingBox standing={standing()} />)
    expect(container.innerHTML).toBe("")
  })

  it("an import block says until when, with what I was told", () => {
    render(<AccountStandingBox standing={standing({ inForce: [{ kind: "imports_blocked", reason: "Repeated complaints were upheld.", appliedAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }] })} />)
    expect(screen.getByRole("heading", { name: "Your account" })).toBeTruthy()
    expect(screen.getByText(/^Importing links is blocked on your account until .+\.$/)).toBeTruthy()
    expect(screen.getByText("Why: Repeated complaints were upheld.")).toBeTruthy()
  })

  it("an import block until lifted, and a closed account, say so", () => {
    render(
      <AccountStandingBox
        standing={standing({
          inForce: [
            { kind: "imports_blocked", reason: "a", appliedAt: "2026-11-01T00:00:00Z", endsAt: null },
            { kind: "closed", reason: "b", appliedAt: "2026-11-02T00:00:00Z", endsAt: null },
          ],
        })}
      />,
    )
    expect(screen.getByText("Importing links is blocked on your account until an administrator lifts the block.")).toBeTruthy()
    expect(screen.getByText("Your account is closed.")).toBeTruthy()
  })

  it("lists the warnings and the infringements in the window, by reference, and says over how long they are counted", () => {
    render(
      <AccountStandingBox
        standing={standing({
          warnings: [{ kind: "warning", reason: "A copyright complaint was upheld.", appliedAt: "2026-10-01T00:00:00Z", endsAt: null }],
          infringements: [
            { caseReference: "CR-2026-000002", recordedAt: "2026-10-01T00:00:00Z" },
            { caseReference: null, recordedAt: "2026-09-01T00:00:00Z" },
          ],
          windowMonths: 12,
        })}
      />,
    )
    expect(screen.getByText(/^A warning, /)).toBeTruthy()
    expect(screen.getByText("Why: A copyright complaint was upheld.")).toBeTruthy()
    expect(screen.getByText("Infringements recorded on your account in this period: 2")).toBeTruthy()
    expect(screen.getByText("Complaint CR-2026-000002")).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByText(/Counted over the last 12 months\./)).toBeTruthy()
  })
})
