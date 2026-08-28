"use client"

import { useCallback, type ReactNode } from "react"
import { AlignLeft, Tag } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

/**
 * Which fragment a parameter picker injects downstream. Mirrors
 * `PickerHintModeFields["hintMode"]` in `@/types/nodes`; absent = "full".
 */
export type HintMode = "full" | "compact"

/**
 * Read a picker node's effective hint mode off its `data`.
 *
 * Compact is opt-in: absent, or ANY unrecognized value (a stale string, a
 * typo, a non-string written by an import), resolves to "full". That mirrors
 * `readHintMode` in `@nodaro/prompts`' `parameter-prompt-hint.ts` — the
 * function that actually composes the injected fragment — so the UI can never
 * claim a mode the injection path won't honour.
 */
export function readHintMode(data: Record<string, unknown> | undefined | null): HintMode {
  return data?.hintMode === "compact" ? "compact" : "full"
}

/**
 * The ONE writer for `data.hintMode`, shared by both surfaces that expose the
 * lever (the canvas node card via `ParameterNodeShell`, and the config panel
 * via `PromptInjectionPreview`).
 *
 * It does TWO writes, and both matter: clearing `height` lets the canvas card
 * re-fit the shorter/longer fragment the same way a display-mode switch does —
 * without it, toggling from the CONFIG PANEL would leave the card sized for the
 * old fragment. Keeping both writes in one place is what stops the two
 * surfaces from drifting.
 */
export function useHintModeSetter(): (nodeId: string, mode: HintMode) => void {
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  return useCallback(
    (nodeId: string, mode: HintMode) => {
      updateNode(nodeId, { height: undefined })
      updateNodeData(nodeId, { hintMode: mode })
    },
    [updateNode, updateNodeData],
  )
}

/**
 * The shared hint-mode lever for every parameter picker. It lives here (not in
 * the 38 per-type config panels) so a new picker gets it on BOTH surfaces for
 * free, and the preview rendered next to it is always
 * `getParameterPromptHint(node, ctx)` — the same function the DAG executor and
 * the backend orchestrator call — so what the user reads is literally what
 * gets injected downstream.
 *
 * Icon-only by design: on the canvas card the row also carries the 3-button
 * display-mode pill, and text labels for both would not fit a 220px picker.
 * The localized "Full" / "Compact" names ride on `aria-label` + `title`, which
 * is also what both surfaces' tests select on.
 */
export function HintModeToggle({
  mode,
  onChange,
  className,
}: {
  readonly mode: HintMode
  readonly onChange: (mode: HintMode) => void
  readonly className?: string
}) {
  const t = useT()
  return (
    <div
      className={cn(
        "nopan flex gap-0 rounded-md border border-gray-200 dark:border-[#2D2D2D] bg-gray-50/95 dark:bg-[#161616]/95 backdrop-blur-sm overflow-hidden shadow-sm",
        className,
      )}
      role="tablist"
      aria-label={t("node.hintMode")}
    >
      <HintModeButton
        active={mode === "full"}
        onClick={() => onChange("full")}
        label={t("node.hintModeFull")}
        icon={<AlignLeft className="size-3" />}
      />
      <HintModeButton
        active={mode === "compact"}
        onClick={() => onChange("compact")}
        label={t("node.hintModeCompact")}
        icon={<Tag className="size-3" />}
      />
    </div>
  )
}

function HintModeButton({
  active,
  onClick,
  label,
  icon,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly label: string
  readonly icon: ReactNode
}) {
  const t = useT()
  const title = t("node.hintModeSwitch", { label })
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex items-center px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "bg-[#ff0073]/15 text-[#ff0073]"
          : "text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-[#1a1a1a]",
      )}
      title={title}
    >
      {icon}
    </button>
  )
}
