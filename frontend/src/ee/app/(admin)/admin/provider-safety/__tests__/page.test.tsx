import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({ data: null as unknown, save: vi.fn() }))

vi.mock("@/ee/hooks/queries/use-provider-safety", () => ({
  useProviderSafety: () => ({ data: h.data, isLoading: false, isError: false }),
  useSaveProviderSafety: () => ({ mutateAsync: h.save, isPending: false }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/ui/select", async () => {
  const React = await import("react")
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
      <select aria-label="lever" value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children, disabled }: { value: string; children: React.ReactNode; disabled?: boolean }) => (
      <option value={value} disabled={disabled}>{children}</option>
    ),
  }
})

import AdminProviderSafetyPage from "../page"

function view(overrides: Partial<{ guardRegistered: boolean; resultCheckRegistered: boolean; override: boolean | number | null }> = {}) {
  const looseningLocked = overrides.guardRegistered === false || overrides.resultCheckRegistered === false
  return {
    guardRegistered: overrides.guardRegistered ?? true,
    resultCheckRegistered: overrides.resultCheckRegistered ?? true,
    updatedAt: null,
    groups: [
      {
        provider: "replicate",
        label: "Replicate",
        withoutLever: ["ltx-2.3-pro"],
        models: [
          {
            modelId: "flux-2-klein",
            label: "Flux 2 Klein",
            levers: [
              {
                param: "disable_safety_checker",
                kind: "boolean",
                filterOnValue: false,
                today: false,
                override: overrides.override ?? null,
                neverLoosen: false,
                wireUnconfirmed: false,
                probePending: true,
                options: [
                  { value: false, relation: "today" },
                  { value: true, relation: "looser", ...(looseningLocked ? { lock: "loosening-locked" } : {}) },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  h.save.mockReset()
  h.save.mockResolvedValue(undefined)
})

describe("Admin → Provider safety", () => {
  it("renders each provider, its models, today's value and the models with no setting", () => {
    h.data = view()
    render(<AdminProviderSafetyPage />)
    expect(screen.getByText("Replicate")).toBeTruthy()
    expect(screen.getByText("Flux 2 Klein")).toBeTruthy()
    expect(screen.getByText("disable_safety_checker")).toBeTruthy()
    expect(screen.getByText("As today (Filter on)")).toBeTruthy()
    expect(screen.getByText(/1 models with no filter setting/)).toBeTruthy()
  })

  it.each([
    ["no content guard", { guardRegistered: false, resultCheckRegistered: true }],
    ["a guard but no result check", { guardRegistered: true, resultCheckRegistered: false }],
    ["neither", { guardRegistered: false, resultCheckRegistered: false }],
  ])("with %s, says why once and locks looser values", (_name, state) => {
    h.data = view(state)
    render(<AdminProviderSafetyPage />)
    expect(screen.getAllByText(/Loosening is locked/)).toHaveLength(1)
    const looser = screen.getByText("Filter off (looser)") as HTMLOptionElement
    expect(looser.disabled).toBe(true)
  })

  it("with a guard and a result check, says nothing and leaves looser values open", () => {
    h.data = view()
    render(<AdminProviderSafetyPage />)
    expect(screen.queryByText(/Loosening is locked/)).toBeNull()
    const looser = screen.getByText("Filter off (looser)") as HTMLOptionElement
    expect(looser.disabled).toBe(false)
  })

  it("saves the whole setting", async () => {
    h.data = view()
    render(<AdminProviderSafetyPage />)
    fireEvent.change(screen.getByLabelText("lever"), { target: { value: "true" } })
    fireEvent.click(screen.getByRole("button", { name: /Save/ }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ "flux-2-klein": { disable_safety_checker: true } }))
  })

  it("starts from what is saved, and saving As today clears it", async () => {
    h.data = view({ override: true })
    render(<AdminProviderSafetyPage />)
    expect((screen.getByLabelText("lever") as HTMLSelectElement).value).toBe("true")
    fireEvent.change(screen.getByLabelText("lever"), { target: { value: "__today__" } })
    fireEvent.click(screen.getByRole("button", { name: /Save/ }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({}))
  })
})
