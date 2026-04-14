"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { List } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { TEXT_CELL_DEFAULT_MAX_LINES, TEXT_FONT_SIZE_CLASS, TEXT_FONT_SIZE_DEFAULT, type ListNodeData, type WorkflowNode } from "@/types/nodes"
import { extractNodeOutputAsList, resolveEdgeValuesForTableColumn } from "@/components/editor/workflow-editor/node-input-resolver"
import { ScrollArea } from "@/components/ui/scroll-area"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
  { id: "list", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
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
      <HandleIcon icon={<List />} color="cyan" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<List />} top="20px" />
    </div>
  )
}

export const ListNode = memo(ListNodeComponent)
