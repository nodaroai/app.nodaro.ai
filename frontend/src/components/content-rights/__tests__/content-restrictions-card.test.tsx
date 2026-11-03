import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * Settings → the way to Content restrictions: shown only to a person with a
 * restriction, or with something on their account under the repeat-infringer
 * policy (a measure in force, a warning or an infringement in the window),
 * and asked for only in an edition with the admin's Complaints screen (where
 * both are made).
 */

const state = vi.hoisted(() => ({ admin: true, data: [] as unknown[], standing: undefined as unknown, enabled: [] as Array<[string, boolean]> }))

vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasAdmin: () => state.admin,
}))
vi.mock("@/hooks/queries/use-my-restrictions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/use-my-restrictions")>()),
  useMyRestrictions: (enabled: boolean) => {
    state.enabled.push(["restrictions", enabled])
    return { data: enabled ? state.data : undefined }
  },
  useMyAccountStanding: (enabled: boolean) => {
    state.enabled.push(["standing", enabled])
    return { data: enabled ? state.standing : undefined }
  },
}))

import { ContentRestrictionsCard } from "../content-restrictions-card"

const show = () =>
  render(
    <MemoryRouter>
      <ContentRestrictionsCard />
    </MemoryRouter>,
  )

const empty = { inForce: [], warnings: [], infringements: [], windowMonths: 24 }

beforeEach(() => {
  state.admin = true
  state.data = []
  state.standing = undefined
  state.enabled = []
})

describe("ContentRestrictionsCard", () => {
  it("links to the page for a person with a restriction", () => {
    state.data = [{ id: "r-1" }]
    show()
    expect(screen.getByRole("link").getAttribute("href")).toBe("/settings/content-restrictions")
  })

  it("links to the page for a person whose account has a warning, an infringement or a measure in force, with no restriction", () => {
    for (const standing of [
      { ...empty, warnings: [{ kind: "warning", reason: "r", appliedAt: "2026-10-01T00:00:00Z", endsAt: null }] },
      { ...empty, infringements: [{ caseReference: "CR-2026-000001", recordedAt: "2026-10-01T00:00:00Z" }] },
      { ...empty, inForce: [{ kind: "imports_blocked", reason: "r", appliedAt: "2026-10-01T00:00:00Z", endsAt: null }] },
    ]) {
      state.standing = standing
      const { unmount } = show()
      expect(screen.getByRole("link").getAttribute("href")).toBe("/settings/content-restrictions")
      unmount()
    }
  })

  it("is not there for a person with none, and nothing on the account", () => {
    state.standing = empty
    show()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("an edition without the Complaints screen never asks", () => {
    state.admin = false
    state.data = [{ id: "r-1" }]
    state.standing = { ...empty, warnings: [{ kind: "warning", reason: "r", appliedAt: "2026-10-01T00:00:00Z", endsAt: null }] }
    show()
    expect(state.enabled).toEqual([
      ["restrictions", false],
      ["standing", false],
    ])
    expect(screen.queryByRole("link")).toBeNull()
  })
})
