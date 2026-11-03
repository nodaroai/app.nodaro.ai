import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * Where my account stands: an import block's end is written as the UTC date,
 * the date a refused import names, so the two never name different days;
 * the other dates are the reader's own.
 */

vi.mock("@/lib/i18n/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/format")>()),
  formatDate: (iso: string, options?: { timeZone?: string }) => `${iso}@${options?.timeZone ?? "local"}`,
}))

import { AccountStandingBox } from "../account-standing-box"

describe("AccountStandingBox dates", () => {
  it("writes an import block's end in UTC, and a warning's date in the reader's own time", () => {
    render(
      <AccountStandingBox
        standing={{
          inForce: [{ kind: "imports_blocked", reason: "r", appliedAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T23:30:00Z" }],
          warnings: [{ kind: "warning", reason: "w", appliedAt: "2026-10-01T00:00:00Z", endsAt: null }],
          infringements: [],
          windowMonths: 24,
        }}
      />,
    )
    expect(screen.getByText("Importing links is blocked on your account until 2026-12-01T23:30:00Z@UTC.")).toBeTruthy()
    expect(screen.getByText("A warning, 2026-10-01T00:00:00Z@local")).toBeTruthy()
  })
})
