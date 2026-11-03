import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * Settings → the way to Content restrictions: shown only to a person with a
 * restriction, and asked for only in an edition with the admin's Complaints
 * screen (where restrictions are made).
 */

const state = vi.hoisted(() => ({ admin: true, data: [] as unknown[], enabled: [] as boolean[] }))

vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasAdmin: () => state.admin,
}))
vi.mock("@/hooks/queries/use-my-restrictions", () => ({
  useMyRestrictions: (enabled: boolean) => {
    state.enabled.push(enabled)
    return { data: enabled ? state.data : undefined }
  },
}))

import { ContentRestrictionsCard } from "../content-restrictions-card"

const show = () =>
  render(
    <MemoryRouter>
      <ContentRestrictionsCard />
    </MemoryRouter>,
  )

beforeEach(() => {
  state.admin = true
  state.data = []
  state.enabled = []
})

describe("ContentRestrictionsCard", () => {
  it("links to the page for a person with a restriction", () => {
    state.data = [{ id: "r-1" }]
    show()
    expect(screen.getByRole("link").getAttribute("href")).toBe("/settings/content-restrictions")
  })

  it("is not there for a person with none", () => {
    show()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("an edition without the Complaints screen never asks", () => {
    state.admin = false
    state.data = [{ id: "r-1" }]
    show()
    expect(state.enabled).toEqual([false])
    expect(screen.queryByRole("link")).toBeNull()
  })
})
