/**
 * Generate Image's run strip (hover toolbar + inline strip): Auto (keep a wired
 * photo's shape) is offered on every model and shows when stored; an unset
 * ratio still displays the model's first listed ratio, not Auto.
 */
import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ updateNodeData: store.updateNodeData, runSingleNode: () => {} }),
}))

import { useGenerateImageStripModel } from "../use-generate-image-strip-model"
import { useLocaleStore } from "@/lib/locale-store"

const strip = (data: Record<string, unknown>) =>
  renderHook(() => useGenerateImageStripModel("n1", data as never)).result.current

describe("useGenerateImageStripModel — Auto on every model", () => {
  it("offers Auto first on a model without a native auto", () => {
    const s = strip({ provider: "seedream-5-pro" })
    expect(s.aspectOptions[0]).toEqual({ value: "auto", label: "Auto (match the photo)" })
  })

  it("shows a stored 'auto' as Auto", () => {
    const s = strip({ provider: "seedream-5-pro", aspectRatio: "auto" })
    expect(s.currentAspect).toBe("auto")
    expect(s.aspectShort).toBe("Auto")
  })

  it("shows Auto in the viewer's language on the pill", () => {
    useLocaleStore.setState({ locale: "he" })
    try {
      expect(strip({ provider: "seedream-5-pro", aspectRatio: "auto" }).aspectShort).toBe("אוטומטי")
      expect(strip({ provider: "seedream-5-pro", aspectRatio: "16:9" }).aspectShort).toBe("16:9")
    } finally {
      useLocaleStore.setState({ locale: "en" })
    }
  })

  it("displays an unset ratio as the model's first listed ratio, not Auto", () => {
    expect(strip({ provider: "seedream-5-pro" }).currentAspect).toBe("1:1")
    expect(strip({ provider: "gpt-image-2" }).currentAspect).toBe("auto")
  })
})
