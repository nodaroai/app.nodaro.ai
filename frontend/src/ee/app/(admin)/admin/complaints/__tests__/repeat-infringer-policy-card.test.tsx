import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

/**
 * The repeat-infringer policy card on the Complaints screen: the policy as it
 * stands (the default until saved), and its editor, which saves only a draft
 * that reads as a policy and says what keeps one from being saved.
 */

const state = vi.hoisted(() => ({
  stored: {
    policy: {
      windowMonths: 24,
      steps: [
        { infringements: 1, kind: "warning" },
        { infringements: 2, kind: "imports_blocked", days: 30 },
        { infringements: 3, kind: "closed" },
      ],
    },
    saved: false,
    updatedAt: null,
  } as Record<string, unknown>,
  saves: [] as unknown[],
}))

vi.mock("@/ee/hooks/queries/use-admin-repeat-infringers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/hooks/queries/use-admin-repeat-infringers")>()),
  useRepeatInfringerPolicy: () => ({ data: state.stored, isLoading: false, isError: false, error: null }),
  useSaveRepeatInfringerPolicy: () => ({
    isPending: false,
    mutateAsync: async (policy: unknown) => {
      state.saves.push(policy)
      return { policy, saved: true, updatedAt: "2026-11-03T12:00:00Z" }
    },
  }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RepeatInfringerPolicyCard } from "../repeat-infringer-policy-card"

beforeEach(() => {
  state.saves = []
})

describe("RepeatInfringerPolicyCard", () => {
  it("shows the policy: the window, each step's count and measure, and that it is the default", () => {
    render(<RepeatInfringerPolicyCard />)
    expect(screen.getByText(/counted over the last 24 months/)).toBeTruthy()
    expect(screen.getByText(/The default: never changed\./)).toBeTruthy()
    expect(screen.getByText("From 2 infringements")).toBeTruthy()
    expect(screen.getByText("Importing links blocked for 30 days")).toBeTruthy()
    expect(screen.getByText("Account closed")).toBeTruthy()
  })

  it("edits and saves the policy as typed", async () => {
    render(<RepeatInfringerPolicyCard />)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getByLabelText("Window, in months"), { target: { value: "12" } })
    fireEvent.change(screen.getAllByLabelText("Days (empty: until lifted)")[0]!, { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Save the policy" }))
    await waitFor(() => expect(state.saves).toHaveLength(1))
    expect(state.saves[0]).toEqual({
      windowMonths: 12,
      steps: [
        { infringements: 1, kind: "warning" },
        { infringements: 2, kind: "imports_blocked" },
        { infringements: 3, kind: "closed" },
      ],
    })
  })

  it("says what keeps a draft from being saved, and saves nothing", () => {
    render(<RepeatInfringerPolicyCard />)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getAllByLabelText("From infringements")[1]!, { target: { value: "1" } })
    expect(screen.getByRole("alert").textContent).toBe("Each step needs more infringements than the one before it.")
    expect((screen.getByRole("button", { name: "Save the policy" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Remove step 2" }))
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Add a step" }))
    expect(screen.getByRole("alert").textContent).toBe("Closing the account is the last step.")
    expect(state.saves).toEqual([])
  })

  it("cancelling leaves the policy as it was", () => {
    render(<RepeatInfringerPolicyCard />)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getByLabelText("Window, in months"), { target: { value: "6" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByText(/counted over the last 24 months/)).toBeTruthy()
    expect(state.saves).toEqual([])
  })
})
