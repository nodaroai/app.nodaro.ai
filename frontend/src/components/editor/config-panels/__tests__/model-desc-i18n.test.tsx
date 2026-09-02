import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"

vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { ModelDescriptionHint } from "../model-description-hint"
import { MultiProviderPicker } from "../multi-provider-picker"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"
import { localizeModelDescription } from "@/lib/i18n/labels"

beforeEach(() => act(() => useLocaleStore.getState().setLocale("he")))
afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

const EN = "Higher detail, production images"

describe("model description surfaces in Hebrew", () => {
  it("the hint below a provider dropdown is Hebrew", () => {
    render(<ModelDescriptionHint modelId="nano-banana-pro" />)
    expect(screen.getByText(localizeModelDescription(EN, "he"))).toBeTruthy()
    expect(screen.queryByText(EN)).toBeNull()
  })

  it("the multi-provider picker's Add button and remove labels are Hebrew", () => {
    render(
      <MultiProviderPicker
        providers={["nano-banana-pro"]}
        options={[{ value: "nano-banana-pro", label: "Nano Banana Pro", desc: EN }, { value: "flux", label: "Flux", desc: "Photorealistic, highest quality output" }]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole("button", { name: translate("he", "cfgshared.addAnotherModel") })).toBeTruthy()
    expect(screen.queryByText("Add another model")).toBeNull()
    expect(screen.getByLabelText(translate("he", "cfgshared.removeModel", { name: "Nano Banana Pro" }))).toBeTruthy()
    // Paired negative: translate() falls back to English silently, so the
    // positive alone would pass with the he key deleted.
    expect(screen.queryByLabelText("Remove Nano Banana Pro")).toBeNull()
  })

  it("the searchable model dropdown shows a Hebrew description for the selected row", () => {
    render(
      <MultiProviderPicker
        providers={["nano-banana-pro"]}
        options={[{ value: "nano-banana-pro", label: "Nano Banana Pro", desc: EN }]}
        onChange={() => {}}
      />,
    )
    // The trigger shows only the label; the description lives ONLY in the
    // opened Popover list, so this click is load-bearing.
    fireEvent.click(screen.getByRole("combobox"))
    expect(screen.getAllByText(localizeModelDescription(EN, "he")).length).toBeGreaterThan(0)
    expect(screen.queryByText(EN)).toBeNull()
  })
})
