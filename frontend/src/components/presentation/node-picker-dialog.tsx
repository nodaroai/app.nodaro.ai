/**
 * Dialog for selecting which nodes appear as inputs or outputs in presentation mode.
 * Each dialog shows only its own section's nodes.
 * Nodes with exposable fields/outputs show an expandable section with checkboxes.
 */

import { useMemo, useCallback, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Lock, LockOpen, ChevronDown, ChevronRight, Sparkles } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  getInputNodes,
  getNodeLabel,
  getOutputType,
} from "@/lib/presentation-utils"
import type { WorkflowNode, LoopColumn } from "@/types/nodes"
import { NODE_DEF_MAP } from "@/types/nodes"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import type { ExposableField, ExposableOutput, PresentationItem } from "@nodaro-shared/presentation-types"
import { migrateToItems } from "@nodaro-shared/presentation-utils"
import { RestrictPopover } from "./restrict-popover"
import { DEFAULT_SYSTEM_MAX_FANOUT } from "./input-card"

interface NodePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: "inputs" | "outputs"
}

function OutputDisplayModeToggle({
  nodeId,
  presentationSettings,
  updatePresentationSettings,
}: {
  nodeId: string
  presentationSettings: PresentationSettings
  updatePresentationSettings: (settings: Partial<PresentationSettings>) => void
}) {
  const mode = presentationSettings.outputDisplayModes?.[nodeId] ?? "individual"

  const updateDisplayMode = useCallback(
    (newMode: "gallery" | "individual") => {
      const current = presentationSettings.outputDisplayModes ?? {}
      updatePresentationSettings({
        outputDisplayModes: { ...current, [nodeId]: newMode },
      })
    },
    [nodeId, presentationSettings.outputDisplayModes, updatePresentationSettings]
  )

  return (
    <div className="ml-7 mt-1 flex gap-1">
      <span className="text-[10px] text-muted-foreground mr-1">Multiple results:</span>
      <button
        className={`text-[10px] px-2 py-0.5 rounded border ${mode === "gallery" ? "bg-[#ff007320] border-[#ff0073] text-[#ff0073]" : "bg-card border-border text-muted-foreground"}`}
        onClick={() => updateDisplayMode("gallery")}
      >
        Gallery
      </button>
      <button
        className={`text-[10px] px-2 py-0.5 rounded border ${mode !== "gallery" ? "bg-[#ff007320] border-[#ff0073] text-[#ff0073]" : "bg-card border-border text-muted-foreground"}`}
        onClick={() => updateDisplayMode("individual")}
      >
        Individual
      </button>
    </div>
  )
}

/** Look up the NODE_DEFINITIONS entry for a given node type. */
function getNodeDef(nodeType: string) {
  return NODE_DEF_MAP.get(nodeType)
}

/** Type badge for exposable field types. */
const FIELD_TYPE_LABELS: Record<ExposableField["type"], string> = {
  select: "Select",
  slider: "Slider",
  toggle: "Toggle",
  text: "Text",
}

function NodeRow({
  node,
  section,
  onToggle,
  presentationSettings,
  updatePresentationSettings,
  expanded,
  onToggleExpand,
  allVisibleNodeIds,
}: {
  node: WorkflowNode
  section: "inputs" | "outputs"
  onToggle: (nodeId: string, checked: boolean) => void
  presentationSettings: PresentationSettings
  updatePresentationSettings: (settings: Partial<PresentationSettings>) => void
  expanded: boolean
  onToggleExpand: () => void
  allVisibleNodeIds: string[]
}) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const data = node.data as Record<string, unknown>
  const isVisible = section === "inputs" ? data.presentationInput === true : data.presentationOutput === true
  const isReadOnly = !!data.presentationReadOnly
  const promptHelperEnabled = data.presentationPromptHelper !== false
  const label = getNodeLabel(node)
  const typeBadge = getOutputType(node.type)

  const def = getNodeDef(node.type)
  const exposableFields = def?.exposableFields
  const exposableOutputs = def?.exposableOutputs
  const hasExposable = (exposableFields && exposableFields.length > 0) || (exposableOutputs && exposableOutputs.length > 0)

  const itemsKey = section === "inputs" ? "inputItems" : "outputItems"
  const orderKey = section === "inputs" ? "inputOrder" : "outputOrder"
  // When itemsKey is undefined, migrate existing legacy order so we don't lose node entries
  const currentItems = presentationSettings[itemsKey]
    ?? migrateToItems(presentationSettings[orderKey])
    ?? []

  const isFieldChecked = useCallback(
    (fieldKey: string) => {
      return currentItems.some(
        (item) => item.type === "field" && item.nodeId === node.id && item.field === fieldKey
      )
    },
    [currentItems, node.id]
  )

  const isOutputChecked = useCallback(
    (outputKey: string) => {
      return currentItems.some(
        (item) => item.type === "output" && item.nodeId === node.id && item.outputKey === outputKey
      )
    },
    [currentItems, node.id]
  )

  const getFieldItem = useCallback(
    (fieldKey: string) => {
      return currentItems.find(
        (item): item is Extract<PresentationItem, { type: "field" }> =>
          item.type === "field" && item.nodeId === node.id && item.field === fieldKey
      )
    },
    [currentItems, node.id]
  )

  // When transitioning from legacy to items-based rendering, seed with visible nodes
  const seedIfEmpty = useCallback(
    (items: PresentationItem[]): PresentationItem[] =>
      items.length === 0 && allVisibleNodeIds.length > 0
        ? allVisibleNodeIds.map((id) => ({ type: "node" as const, nodeId: id }))
        : items,
    [allVisibleNodeIds],
  )

  const handleFieldToggle = useCallback(
    (field: ExposableField, checked: boolean) => {
      if (checked) {
        const items = seedIfEmpty(currentItems)
        const newItem: PresentationItem = {
          type: "field",
          id: crypto.randomUUID(),
          nodeId: node.id,
          field: field.key,
        }
        updatePresentationSettings({
          [itemsKey]: [...items, newItem],
        })
      } else {
        updatePresentationSettings({
          [itemsKey]: currentItems.filter(
            (item) => !(item.type === "field" && item.nodeId === node.id && item.field === field.key)
          ),
        })
      }
    },
    [node.id, currentItems, itemsKey, updatePresentationSettings, seedIfEmpty]
  )

  const handleOutputToggle = useCallback(
    (output: ExposableOutput, checked: boolean) => {
      if (checked) {
        const items = seedIfEmpty(currentItems)
        const newItem: PresentationItem = {
          type: "output",
          id: crypto.randomUUID(),
          nodeId: node.id,
          outputKey: output.key,
        }
        updatePresentationSettings({
          [itemsKey]: [...items, newItem],
        })
      } else {
        updatePresentationSettings({
          [itemsKey]: currentItems.filter(
            (item) => !(item.type === "output" && item.nodeId === node.id && item.outputKey === output.key)
          ),
        })
      }
    },
    [node.id, currentItems, itemsKey, updatePresentationSettings, seedIfEmpty]
  )

  const handleRestrictUpdate = useCallback(
    (fieldKey: string, allowedValues: Array<string | number | boolean> | undefined) => {
      updatePresentationSettings({
        [itemsKey]: currentItems.map((item) => {
          if (item.type === "field" && item.nodeId === node.id && item.field === fieldKey) {
            return { ...item, allowedValues }
          }
          return item
        }),
      })
    },
    [node.id, currentItems, itemsKey, updatePresentationSettings]
  )

  return (
    <div>
      <div className="flex items-center gap-1">
        {hasExposable && isVisible ? (
          <button
            className="p-0.5 rounded hover:bg-accent/50 text-muted-foreground shrink-0"
            onClick={onToggleExpand}
            aria-label={expanded ? "Collapse fields" : "Expand fields"}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}
        <label className="flex items-center gap-3 flex-1 min-w-0 px-1 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
          <Checkbox
            checked={isVisible}
            onCheckedChange={(checked) => onToggle(node.id, checked === true)}
          />
          <span className="flex-1 text-sm truncate">{label}</span>
          <Badge variant="secondary" className="text-xs shrink-0">
            {typeBadge}
          </Badge>
          {isVisible && node.type === "text-prompt" && (
            <div className="flex items-center gap-0.5 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                title={promptHelperEnabled ? "AI helper enabled" : "AI helper disabled"}
                onClick={(e) => {
                  e.stopPropagation()
                  updateNodeData(node.id, { presentationPromptHelper: !promptHelperEnabled })
                }}
              >
                <Sparkles className={`h-3.5 w-3.5 ${promptHelperEnabled ? "text-[#ff0073]" : "text-muted-foreground/40"}`} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                title={isReadOnly ? "Read-only in app" : "Editable in app"}
                onClick={(e) => {
                  e.stopPropagation()
                  updateNodeData(node.id, { presentationReadOnly: !isReadOnly })
                }}
              >
                {isReadOnly ? (
                  <Lock className="h-3.5 w-3.5 text-amber-500" />
                ) : (
                  <LockOpen className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
            </div>
          )}
        </label>
      </div>

      {section === "outputs" && isVisible && (
        <OutputDisplayModeToggle
          nodeId={node.id}
          presentationSettings={presentationSettings}
          updatePresentationSettings={updatePresentationSettings}
        />
      )}

      {/* Expanded section: exposable outputs + fields */}
      {isVisible && expanded && hasExposable && (
        <div className="ml-[30px] mb-2 pl-3 border-l border-border/50 space-y-1">
          {/* Exposable outputs */}
          {exposableOutputs && exposableOutputs.length > 0 && (
            <>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider pt-1">
                Outputs
              </p>
              {exposableOutputs.map((output) => (
                <label
                  key={output.key}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/30 cursor-pointer"
                >
                  <Checkbox
                    checked={isOutputChecked(output.key)}
                    onCheckedChange={(checked) =>
                      handleOutputToggle(output, checked === true)
                    }
                  />
                  <span className="text-xs flex-1 truncate">{output.label}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                    {output.outputType}
                  </Badge>
                </label>
              ))}
            </>
          )}

          {/* Exposable fields */}
          {exposableFields && exposableFields.length > 0 && (
            <>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider pt-1">
                Fields
              </p>
              {exposableFields.map((field) => {
                const checked = isFieldChecked(field.key)
                const fieldItem = checked ? getFieldItem(field.key) : undefined
                return (
                  <div key={field.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/30">
                    <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) =>
                          handleFieldToggle(field, c === true)
                        }
                      />
                      <span className="text-xs truncate">{field.label}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                        {FIELD_TYPE_LABELS[field.type]}
                      </Badge>
                    </label>
                    {checked && field.type === "select" && field.options && field.options.length > 0 && (
                      <RestrictPopover
                        field={field}
                        allowedValues={fieldItem?.allowedValues}
                        onUpdate={(av) => handleRestrictUpdate(field.key, av)}
                      />
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function NodePickerDialog({ open, onOpenChange, section }: NodePickerDialogProps) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const presentationSettings = useWorkflowStore((s) => s.presentationSettings)
  const updatePresentationSettings = useWorkflowStore((s) => s.updatePresentationSettings)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const availableNodes = useMemo(() => getInputNodes(nodes, false), [nodes])
  const arrayNodes = useMemo(() => availableNodes.filter(n => n.type === "list" || n.type === "loop"), [availableNodes])
  const standardNodes = useMemo(() => availableNodes.filter(n => n.type !== "list" && n.type !== "loop"), [availableNodes])

  // IDs of nodes currently visible in presentation — used to seed inputItems/outputItems
  // when transitioning from legacy rendering to items-based rendering
  const visibleNodeIds = useMemo(() => {
    const flag = section === "inputs" ? "presentationInput" : "presentationOutput"
    return availableNodes
      .filter((n) => (n.data as Record<string, unknown>)[flag] === true)
      .map((n) => n.id)
  }, [availableNodes, section])

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const handleToggle = (nodeId: string, checked: boolean) => {
    const field = section === "inputs" ? "presentationInput" : "presentationOutput"
    if (!checked) {
      updateNodeData(nodeId, { [field]: false, presentationReadOnly: false })
      // Collapse and clear any field/output items for this node
      setExpandedNodes((prev) => {
        const next = new Set(prev)
        next.delete(nodeId)
        return next
      })
      const itemsKey = section === "inputs" ? "inputItems" : "outputItems"
      const currentItems = presentationSettings[itemsKey] ?? []
      const filtered = currentItems.filter(
        (item) => !("nodeId" in item && item.nodeId === nodeId)
      )
      if (filtered.length !== currentItems.length) {
        updatePresentationSettings({ [itemsKey]: filtered })
      }
    } else {
      updateNodeData(nodeId, { [field]: true })
      // When items-based rendering is active, also add a node item so it appears
      const itemsKey = section === "inputs" ? "inputItems" : "outputItems"
      const currentItems = presentationSettings[itemsKey] ?? []
      if (currentItems.length > 0) {
        const alreadyPresent = currentItems.some(
          (item) => item.type === "node" && item.nodeId === nodeId
        )
        if (!alreadyPresent) {
          updatePresentationSettings({
            [itemsKey]: [...currentItems, { type: "node" as const, nodeId }],
          })
        }
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {section === "inputs" ? "Select Input Nodes" : "Select Output Nodes"}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-auto py-2">
          {availableNodes.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No nodes in this workflow
            </p>
          ) : (
            <div className="space-y-1">
              {standardNodes.length > 0 && arrayNodes.length > 0 && (
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 pt-1 pb-1">
                  Standard Inputs
                </p>
              )}
              {standardNodes.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  section={section}
                  onToggle={handleToggle}
                  presentationSettings={presentationSettings}
                  updatePresentationSettings={updatePresentationSettings}
                  expanded={expandedNodes.has(node.id)}
                  onToggleExpand={() => toggleExpanded(node.id)}
                  allVisibleNodeIds={visibleNodeIds}
                />
              ))}
              {arrayNodes.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Array Inputs
                    </p>
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#ff0073]/10 text-[#ff0073]">
                      New
                    </span>
                  </div>
                  {arrayNodes.map((node) => {
                    const data = node.data as Record<string, unknown>
                    const maxItems = Math.min((data.maxItems as number) ?? 10, DEFAULT_SYSTEM_MAX_FANOUT)
                    let meta = ""
                    if (node.type === "list") {
                      const items = typeof data.items === "string" && data.items.trim()
                        ? data.items.split("\n").filter(Boolean).length
                        : 0
                      meta = `${items} item${items !== 1 ? "s" : ""} \u00b7 max ${maxItems}`
                    } else if (node.type === "loop") {
                      const columns = (data.columns as LoopColumn[]) ?? []
                      const rows = (data.rows as string[][]) ?? []
                      const types = columns.map(c => c.type ?? "text").join(", ")
                      meta = `${columns.length} col${columns.length !== 1 ? "s" : ""} (${types}) \u00b7 max ${maxItems} rows`
                    }
                    return (
                      <div key={node.id}>
                        <NodeRow
                          node={node}
                          section={section}
                          onToggle={handleToggle}
                          presentationSettings={presentationSettings}
                          updatePresentationSettings={updatePresentationSettings}
                          expanded={expandedNodes.has(node.id)}
                          onToggleExpand={() => toggleExpanded(node.id)}
                          allVisibleNodeIds={visibleNodeIds}
                        />
                        {meta && (
                          <p className="text-[10px] text-muted-foreground/60 pl-10 -mt-1 pb-1">
                            {meta}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
