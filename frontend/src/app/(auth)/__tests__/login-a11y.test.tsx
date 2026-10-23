import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { axeViolations } from "@/test/axe"

/**
 * The sign-in page passes the automated WCAG 2.0 A/AA checks (SI 5568) on
 * Nodaro's Cloud, where it shows the accessibility statement link, and on a
 * self-hosted install. Colour contrast is checked in a real browser.
 */

const edition = vi.hoisted(() => ({ cloud: true }))
vi.mock("@/lib/edition", () => ({ isCloud: () => edition.cloud, hasCredits: () => edition.cloud }))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn(), signInWithEmail: vi.fn() }),
}))

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/v1/sso/providers")) return { ok: true, json: async () => ({ providers: [] }) } as Response
      if (url.includes("/v1/setup/status")) return { ok: true, json: async () => ({ hasUsers: true }) } as Response
      return { ok: false, json: async () => ({}) } as Response
    }),
  )
})

import LoginPage from "../login/page"

describe("sign-in page accessibility", () => {
  for (const cloud of [true, false]) {
    it(`has no WCAG 2.0 A/AA violations (${cloud ? "Cloud" : "self-hosted"})`, async () => {
      edition.cloud = cloud
      const { container } = render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>,
      )
      await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(0))
      expect(await axeViolations(container)).toEqual([])
    })
  }
})
