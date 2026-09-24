"use client"

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react"
import { Clapperboard, PenTool } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { setStickyLookPreviewStyle } from "@/lib/parameter-node-prefs"
import {
  ILLUSTRATED_LOOK_PICKERS,
  LOOK_PREVIEW_STYLE_FIELD,
  LookPreviewStyleProvider,
  readLookPreviewStyle,
  useCanSwitchLookPreviewStyle,
  useLookPreviewStyle,
  type LookPreviewStyle,
} from "@/lib/picker-ui"

/**
 * The ONE writer for a node's look preview style, shared by the canvas node
 * and the config panel / fullscreen picker grid. Three writes, all needed:
 * clear the height so the card re-fits (a mood node changes layout between a
 * render and its emoji), save the choice on the node, and remember it as the
 * default for the NEXT node of this type (seeded in the store's `addNode`).
 */
export function useLookPreviewStyleWriter(): (nodeId: string, nodeType: string, style: LookPreviewStyle) => void {
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  return useCallback(
    (nodeId: string, nodeType: string, style: LookPreviewStyle) => {
      updateNode(nodeId, { height: undefined })
      updateNodeData(nodeId, { [LOOK_PREVIEW_STYLE_FIELD]: style })
      setStickyLookPreviewStyle(nodeType, style)
    },
    [updateNode, updateNodeData],
  )
}

/** Whether the switch shows at rest, or only on hover (an unselected canvas node). */
const RevealContext = createContext<"always" | "hover">("always")

/**
 * Scopes every picture of a look option below it to one EDITOR node's saved
 * choice, and makes it switchable. Used by the canvas node shell and the
 * config panel — the two surfaces that edit the node — so the switch on the
 * node and the one above the picker grid write the same value.
 */
export function NodeLookPreviewStyleScope({
  nodeId,
  nodeType,
  data,
  reveal = "always",
  children,
}: {
  readonly nodeId: string | undefined
  readonly nodeType: string | undefined
  readonly data: Readonly<Record<string, unknown>> | undefined
  /** "hover": the switch hides until the node is hovered (canvas, unselected). */
  readonly reveal?: "always" | "hover"
  readonly children: ReactNode
}) {
  const write = useLookPreviewStyleWriter()
  const style = readLookPreviewStyle(data)
  const switchable = nodeId !== undefined && nodeType !== undefined && ILLUSTRATED_LOOK_PICKERS.has(nodeType)
  const onChange = useMemo(
    () => (switchable ? (next: LookPreviewStyle) => write(nodeId, nodeType, next) : undefined),
    [switchable, write, nodeId, nodeType],
  )
  return (
    <RevealContext.Provider value={reveal}>
      <LookPreviewStyleProvider style={style} onChange={onChange}>
        {children}
      </LookPreviewStyleProvider>
    </RevealContext.Provider>
  )
}

/**
 * The real / illustration switch (film = the rendered photo or clip, pen = the
 * drawing). Renders nothing unless it can do something: the picker has both
 * pictures, this edition registered the renders (never on a self-hosted
 * install), and the scope is editable (never on a published app card).
 */
export function LookPreviewStyleSwitch({ pickerKey, className }: { readonly pickerKey: string; readonly className?: string }) {
  const t = useT()
  const canSwitch = useCanSwitchLookPreviewStyle(pickerKey)
  const { style, onChange } = useLookPreviewStyle()
  const reveal = useContext(RevealContext)
  if (!canSwitch || !onChange) return null
  return (
    <div
      className={cn(
        "nopan nodrag inline-flex shrink-0 gap-0 rounded-md border border-gray-200 dark:border-[#2D2D2D] bg-gray-50/95 dark:bg-[#161616]/95 overflow-hidden shadow-sm transition-opacity",
        reveal === "hover" && "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        className,
      )}
      role="tablist"
      aria-label={t("node.previewStyle")}
    >
      <SwitchButton
        active={style === "real"}
        onClick={() => onChange("real")}
        label={t("node.previewStyleReal")}
        icon={<Clapperboard className="size-3" />}
      />
      <SwitchButton
        active={style === "illustration"}
        onClick={() => onChange("illustration")}
        label={t("node.previewStyleIllustration")}
        icon={<PenTool className="size-3" />}
      />
    </div>
  )
}

function SwitchButton({
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
  const title = t("node.previewStyleSwitch", { label })
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={title}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        if (!active) onClick()
      }}
      className={cn(
        "flex items-center px-1.5 py-0.5 transition-colors",
        active
          ? "bg-[#ff0073]/15 text-[#ff0073]"
          : "text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-[#1a1a1a]",
      )}
    >
      {icon}
    </button>
  )
}
