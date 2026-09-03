import { describe, it, expect, afterEach } from "vitest"
import { act } from "@testing-library/react"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"
import { canvasAriaLabelConfig } from "../canvas-aria-labels"

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")))

// React Flow ships its keyboard-navigation hints and control names in English
// and exposes `ariaLabelConfig` to override them. The canvas passes this map
// so screen readers hear the user's language.
describe("canvasAriaLabelConfig", () => {
  it("covers every key React Flow reads, in Hebrew", () => {
    const cfg = canvasAriaLabelConfig("he")
    for (const k of ["node.a11yDescription.default", "node.a11yDescription.keyboardDisabled", "edge.a11yDescription.default", "controls.ariaLabel", "controls.zoomIn.ariaLabel", "controls.zoomOut.ariaLabel", "controls.fitView.ariaLabel", "controls.interactive.ariaLabel", "minimap.ariaLabel", "handle.ariaLabel"] as const) {
      expect(cfg[k], k).toMatch(/[֐-׿]/)
    }
    expect(cfg["node.a11yDescription.ariaLiveMessage"]!({ direction: "left", x: 10, y: 20 })).toBe(translate("he", "canvas.a11yMoved", { direction: "left", x: 10, y: 20 }))
  })
  it("is English under en", () => {
    expect(canvasAriaLabelConfig("en")["controls.zoomIn.ariaLabel"]).toBe("Zoom In")
  })
})
