import type { LocaleId } from "@nodaro/shared"
import type { ReactFlowProps } from "@xyflow/react"
import { translate, type MessageKey } from "@/lib/i18n"

type AriaLabelConfig = NonNullable<ReactFlowProps["ariaLabelConfig"]>

/**
 * React Flow names the arrow key that moved a node in English ("left",
 * "up", …: the key name without "Arrow", lower-cased). A direction it adds
 * later passes through rather than going silent.
 */
const DIRECTION_KEYS: Readonly<Record<string, MessageKey>> = {
  up: "canvas.a11yDirUp",
  down: "canvas.a11yDirDown",
  left: "canvas.a11yDirLeft",
  right: "canvas.a11yDirRight",
}

/**
 * React Flow's own accessibility strings — the keyboard-navigation hints it
 * renders into every node and edge, and the names of its controls, MiniMap and
 * handles — ship in English. `ariaLabelConfig` overrides them; this map keys
 * every one of them so screen readers hear the user's language.
 */
export function canvasAriaLabelConfig(locale: LocaleId): AriaLabelConfig {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(locale, key, vars)
  const direction = (raw: string) => {
    const key = DIRECTION_KEYS[raw]
    return key ? t(key) : raw
  }
  return {
    "node.a11yDescription.default": t("canvas.a11yNodeDefault"),
    "node.a11yDescription.keyboardDisabled": t("canvas.a11yNodeKeyboardDisabled"),
    "node.a11yDescription.ariaLiveMessage": ({ direction: raw, x, y }) => t("canvas.a11yMoved", { direction: direction(raw), x, y }),
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
