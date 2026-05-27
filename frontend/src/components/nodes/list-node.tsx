"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { List } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { TEXT_CELL_DEFAULT_MAX_LINES, TEXT_FONT_SIZE_CLASS, TEXT_FONT_SIZE_DEFAULT, type ListNodeData, type WorkflowNode } from "@/types/nodes"
import { extractNodeOutputAsList, resolveEdgeValuesForTableColumn } from "@/components/editor/workflow-editor/node-input-resolver"
import { ScrollArea } from "@/components/ui/scroll-area"
import { isValidListNodeConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { isVisualPickerType } from "@/lib/parameter-picker-types"

// Module-level accepts predicate — defining inside the component would
// create a fresh arrow ref on every render and bust HandleWithPopover's
// useConnection memo. See playbook Feature 1, "Pitfalls already paid for".
const ACCEPTS_IN = (t: string) => isValidListNodeConnection("in", t, isVisualPickerType)

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, external: true },
  { id: "list", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, external: true },
] as const

function ListNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ListNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)

  const connectedItems = useMemo<string[] | null>(() => {
    const inEdge = edges.find((e) => e.target === id && e.targetHandle === "in")
    if (!inEdge) return null
    const upstream = nodes.find((n) => n.id === inEdge.source)
    if (!upstream) return null
    // Pass the list-node's own columns so splitByLoopDelimiter uses the configured splitDelimiter.
    return resolveEdgeValuesForTableColumn(inEdge, upstream, edges, nodes, nodeData.columns)
  }, [id, edges, nodes, nodeData.columns])

  const staticItems = useMemo(
    () => extractNodeOutputAsList({ id, type: "list", data: nodeData } as WorkflowNode) ?? [],
    [id, nodeData],
  )
  const items = connectedItems ?? staticItems
  const itemCount = items.length
  const isConnected = connectedItems !== null
  const textMaxLines = Math.max(1, nodeData.textMaxLines ?? TEXT_CELL_DEFAULT_MAX_LINES)
  const textFontSize = nodeData.textFontSize ?? TEXT_FONT_SIZE_DEFAULT
  const textFontClass = TEXT_FONT_SIZE_CLASS[textFontSize]
  const listLabel = nodeData.columns?.[0]?.name?.trim() || "List"

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<List className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<List className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={HANDLES}
      >
        <div className="p-1 h-full flex flex-col">
          {itemCount === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-1 shrink-0">
                {itemCount} item{itemCount !== 1 ? "s" : ""}
                {isConnected && <span className="ml-1 opacity-70">(upstream)</span>}
              </p>
              <ScrollArea className="flex-1 min-h-0">
                <ul className={`${textFontClass} space-y-2 pl-2 pr-4 pt-2`}>
                  {items.map((item, i) => (
                    <li key={i} className="relative">
                      {/* Inner scrollbar disabled — content clips at textMaxLines via maxHeight + overflow-hidden.
                          To re-enable: replace the <div> below with <ScrollArea style={{ height: `${textMaxLines * 16}px` }}>...</ScrollArea>. */}
                      <div className="rounded-md border border-border/40 bg-muted/10 px-2 py-1" style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: textMaxLines,
                        overflow: "hidden",
                        wordBreak: "break-word",
                      }}>
                        {item}
                      </div>
                      <span className="absolute -top-1.5 -left-1.5 z-10 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white text-[9px] font-medium tabular-nums shadow-sm">{i + 1}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="list" handleId="in"   type="target" position={Position.Left}  label="In"   color={DATA_HANDLE_COLORS.list} icon={<List />} side="left"  top="calc(100% - 20px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="list" handleId="list" type="source" position={Position.Right} label={listLabel} color={DATA_HANDLE_COLORS.list} icon={<List />} side="right" top="20px" />
    </div>
  )
}

export const ListNode = memo(ListNodeComponent)
