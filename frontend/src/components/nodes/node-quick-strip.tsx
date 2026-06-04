"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useStore } from "@xyflow/react"
import { Settings2 } from "lucide-react"
import { RunNodeButton } from "./run-node-button"
import { PromptEditButton } from "./prompt-edit-button"
import { QuickConfigSelect, getQuickConfigs } from "./node-quick-configs"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"

interface NodeQuickStripProps {
  readonly nodeId: string
  readonly credits: number
  readonly isRunning: boolean
  /** Extra inline controls appended after the registry configs, before Run. */
  readonly children?: ReactNode
}

/**
 * Standard bottom config strip shared by AI nodes without a bespoke quick
 * toolbar. Enforces the canonical layout — **Prompt (left) → configs → Run
 * (right)**. The Prompt button self-hides for node types without a prompt
 * field; the configs come from {@link getQuickConfigs} (per-node-type registry).
 *
 * While a config dropdown is open, its Radix portal renders outside the node,
 * which would let the hover toolbar hide mid-pick — so we pin the node via
 * `setQuickStripPinned` (BaseNode keeps the toolbar visible while pinned).
 */
export function NodeQuickStrip({ nodeId, credits, isRunning, children }: NodeQuickStripProps) {
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const setQuickStripPinned = useWorkflowStore((s) => s.setQuickStripPinned)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const setConfigPanelFullscreen = useWorkflowStore((s) => s.setConfigPanelFullscreen)
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const zoom = useStore((s) => s.transform[2])
  const scale = Math.max(NODE_VISUAL_SCALE_FLOOR, zoom)

  const data = (node?.data ?? {}) as Record<string, unknown>
  const configs = getQuickConfigs(node?.type)

  // Keep the toolbar pinned while any dropdown is open. Count opens/closes;
  // defer the decrement a macrotask so moving between two dropdowns stays net
  // positive (mirrors the bespoke toolbars).
  const [openCount, setOpenCount] = useState(0)
  const pendingClose = useRef<number | null>(null)
  useEffect(() => {
    setQuickStripPinned(openCount > 0 ? nodeId : null)
  }, [openCount, nodeId, setQuickStripPinned])
  useEffect(
    () => () => {
      if (pendingClose.current !== null) clearTimeout(pendingClose.current)
      setQuickStripPinned(null)
    },
    [setQuickStripPinned],
  )
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      setOpenCount((c) => c + 1)
    } else {
      pendingClose.current = window.setTimeout(() => {
        pendingClose.current = null
        setOpenCount((c) => Math.max(0, c - 1))
      }, 0)
    }
  }, [])

  return (
    <div
      className="flex items-center gap-0.5 px-1.5 py-1 backdrop-blur-sm rounded-xl border bg-white/85 border-black/10 text-neutral-900 node-menu-surface dark:border-white/10 dark:text-white"
      style={{ transform: `scale(${scale})`, transformOrigin: "50% 0%" }}
      onClick={(e) => e.stopPropagation()}
    >
      <PromptEditButton nodeId={nodeId} />
      {configs.map((control) => (
        <QuickConfigSelect
          key={control.field}
          nodeId={nodeId}
          control={control}
          value={data[control.field] != null ? String(data[control.field]) : ""}
          disabled={isRunning}
          onOpenChange={handleOpenChange}
        />
      ))}
      {/* Fallback "configurations" affordance for nodes without registered
          quick-configs: opens the node's full settings panel. */}
      {configs.length === 0 && !children && (
        <button
          type="button"
          aria-label="Settings"
          title="Open settings"
          onClick={(e) => {
            e.stopPropagation()
            selectNode(nodeId)
            setConfigPanelFullscreen(true)
          }}
          className="flex items-center gap-1 h-6 px-1.5 rounded-md text-[10px] font-medium whitespace-nowrap text-neutral-900/85 hover:bg-black/10 dark:text-white/85 dark:hover:bg-white/10"
        >
          <Settings2 className="w-3 h-3 opacity-70" />
          <span>Settings</span>
        </button>
      )}
      {children}
      <RunNodeButton
        nodeId={nodeId}
        credits={credits}
        isRunning={isRunning}
        onRun={(nid) => runSingleNode?.(nid)}
      />
    </div>
  )
}
