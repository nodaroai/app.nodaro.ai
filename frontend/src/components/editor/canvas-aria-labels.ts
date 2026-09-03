import type { LocaleId } from "@nodaro/shared"
import type { ReactFlowProps } from "@xyflow/react"
import { translate } from "@/lib/i18n"

type AriaLabelConfig = NonNullable<ReactFlowProps["ariaLabelConfig"]>

/**
 * React Flow's own accessibility strings — the keyboard-navigation hints it
 * renders into every node and edge, and the names of its controls, MiniMap and
 * handles — ship in English. `ariaLabelConfig` overrides them; this map keys
 * every one of them so screen readers hear the user's language.
 */
export function canvasAriaLabelConfig(locale: LocaleId): AriaLabelConfig {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(locale, key, vars)
  return {
    "node.a11yDescription.default": t("canvas.a11yNodeDefault"),
    "node.a11yDescription.keyboardDisabled": t("canvas.a11yNodeKeyboardDisabled"),
    "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) => t("canvas.a11yMoved", { direction, x, y }),
    "edge.a11yDescription.default": t("canvas.a11yEdgeDefault"),
    "controls.ariaLabel": t("canvas.a11yControls"),
    "controls.zoomIn.ariaLabel": t("canvas.zoomIn"),
    "controls.zoomOut.ariaLabel": t("canvas.zoomOut"),
    "controls.fitView.ariaLabel": t("canvas.a11yFitView"),
    "controls.interactive.ariaLabel": t("canvas.a11yInteractive"),
    "minimap.ariaLabel": t("canvas.a11yMiniMap"),
    "handle.ariaLabel": t("canvas.a11yHandle"),
  }
}
