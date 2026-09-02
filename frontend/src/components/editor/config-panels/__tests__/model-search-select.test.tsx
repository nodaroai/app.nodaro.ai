import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { ModelSearchSelect } from "../model-search-select"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

// Hook is gated behind hasCredits(); stub it so the closed-state render is pure.
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))

const OPTIONS = [
  { value: "flux", label: "Flux", desc: "Photorealistic" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Detailed" },
]

describe("ModelSearchSelect", () => {
  it("shows the selected option's label on the trigger", () => {
    render(
      <ModelSearchSelect value="nano-banana-pro" onChange={() => {}} options={OPTIONS} ariaLabel="Model" />,
    )
    expect(screen.getByLabelText("Model")).toHaveTextContent("Nano Banana Pro")
  })

  it("prefers an explicit triggerLabel override", () => {
    render(
      <ModelSearchSelect value="" onChange={() => {}} options={OPTIONS} triggerLabel="3 models" ariaLabel="Model" />,
    )
    expect(screen.getByLabelText("Model")).toHaveTextContent("3 models")
  })
})

// The search placeholder is chrome copy, so it must follow the LIVE locale —
// resolving it once at module scope froze it on whatever language the store
// held when this module was first imported (boot locale), which is what these
// cover.
describe("ModelSearchSelect search placeholder", () => {
  afterEach(() => {
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
  })

  it("resolves the default placeholder in the locale live at render time", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    render(
      <ModelSearchSelect value="flux" onChange={() => {}} options={OPTIONS} ariaLabel="Model" open onOpenChange={() => {}} />,
    )
    expect(screen.getByPlaceholderText(translate("he", "cfgshared.modelSearchPlaceholder"))).toBeTruthy()
    expect(screen.queryByPlaceholderText(translate("en", "cfgshared.modelSearchPlaceholder"))).toBeNull()
  })

  it("follows a language switch after mount", () => {
    render(
      <ModelSearchSelect value="flux" onChange={() => {}} options={OPTIONS} ariaLabel="Model" open onOpenChange={() => {}} />,
    )
    expect(screen.getByPlaceholderText(translate("en", "cfgshared.modelSearchPlaceholder"))).toBeTruthy()
    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByPlaceholderText(translate("he", "cfgshared.modelSearchPlaceholder"))).toBeTruthy()
    expect(screen.queryByPlaceholderText(translate("en", "cfgshared.modelSearchPlaceholder"))).toBeNull()
  })

  it("still honours an explicit placeholder override", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    render(
      <ModelSearchSelect value="flux" onChange={() => {}} options={OPTIONS} ariaLabel="Model" open onOpenChange={() => {}} placeholder="Find a voice" />,
    )
    expect(screen.getByPlaceholderText("Find a voice")).toBeTruthy()
  })
})
