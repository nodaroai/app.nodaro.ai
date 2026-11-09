import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const billing = vi.hoisted(() => ({ surface: {} as { deploymentPayer?: boolean } }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: billing.surface, isLoading: false }) }))

import { PersonalFreeCreditsOnly } from "../personal-free-credits-only"

beforeEach(() => {
  billing.surface = {}
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

function promised() {
  return render(<PersonalFreeCreditsOnly><p>free credits</p></PersonalFreeCreditsOnly>).container.innerHTML
}

describe("PersonalFreeCreditsOnly", () => {
  it("renders its children, untouched, on a deployment that sells (and while the billing surface is still answering)", () => {
    expect(promised()).toBe("<p>free credits</p>")
    billing.surface = { deploymentPayer: false }
    expect(promised()).toBe("<p>free credits</p>")
  })

  it("renders nothing on a deployment that sells nothing", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } }
    expect(promised()).toBe("")
  })

  it("renders nothing under a deployment payer", () => {
    billing.surface = { deploymentPayer: true }
    expect(promised()).toBe("")
    expect(screen.queryByText("free credits")).toBeNull()
  })
})
