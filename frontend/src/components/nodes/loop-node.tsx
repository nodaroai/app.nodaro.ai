"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Film, Image, Info, Music, Repeat, Table2, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { LOOP_COLUMN_TYPE_META, type LoopNodeData, type LoopColumn } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"

function buildHandles(columns: ReadonlyArray<LoopColumn>) {
  const target = {
    id: "in",
    type: "target" as const,
    position: Position.Left,
    customStyle: { top: 'calc(100% - 20px)', left: '-29px' },
    hideHandle: true,
  }

  if (columns.length === 0) {
    return [target]
  }

  const startPct = 30
  const endPct = 80
  const sources = columns.map((col, i) => {
    const pct = columns.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (columns.length - 1)) * (endPct - startPct))
    return {
      id: col.handleId,
      type: "source" as const,
      position: Position.Right,
      top: `${pct}%`,
      customStyle: { top: `${pct}%`, right: '-29px' },
      hideHandle: true,
    }
  })

  return [target, ...sources]
}

function LoopNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LoopNodeData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"
  const [showData, setShowData] = useState(false)

  const columns = nodeData.columns ?? []
  const handles = useMemo(() => buildHandles(columns), [columns])

  const hasUpstreamInput = useMemo(
    () => edges.some((e) => e.target === id && e.targetHandle === "in"),
    [edges, id],
  )

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, columns.length, updateNodeInternals])

  const rows = nodeData.rows ?? []
  const rowCount = rows.length
  const colCount = nodeData.columns?.length ?? 0

  let statusText: string
  if (hasUpstreamInput) {
    statusText = "Connected: waiting for input..."
  } else if (colCount > 0) {
    statusText = `${rowCount} row${rowCount !== 1 ? "s" : ""} \u00D7 ${colCount} col${colCount !== 1 ? "s" : ""}`
  } else {
    statusText = "Click to configure..."
  }

  const sourceHandles = handles.filter(h => h.type === "source")
  const hasTarget = handles.some(h => h.id === "in")

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Repeat className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Repeat className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        minWidth={220}
        hideHeader
        topToolbarContent={
          <div className="flex items-center gap-1">
            {colCount > 0 && rowCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowData(!showData) }}
                className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
                title={showData ? "Show info" : "Show data"}
              >
                {showData ? <Info className="w-3.5 h-3.5" /> : <Table2 className="w-3.5 h-3.5" />}
              </button>
            )}
            {status !== "running" && (
              <RunNodeButton nodeId={id} credits={0} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
            )}
          </div>
        }
        handles={handles}
      >
        <div className="p-3" style={{ minHeight: colCount > 1 ? `${colCount * 22 + 8}px` : undefined }}>
          {showData && colCount > 0 && rowCount > 0 ? (
            <div className="overflow-auto max-h-[200px] rounded border border-border/40">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-muted/30">
                    {columns.map((col) => {
                      const meta = LOOP_COLUMN_TYPE_META[col.type ?? "text"]
                      const colColor = meta?.color ?? "#38BDF8"
                      return (
                        <th key={col.id} className="px-1.5 py-1 text-left font-medium whitespace-nowrap border-b border-border/30">
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[8px] px-1 py-0.5 rounded font-semibold"
                              style={{ background: `${colColor}20`, color: colColor }}>
                              {meta?.shortLabel ?? "TXT"}
                            </span>
                            <span className="text-muted-foreground truncate max-w-[60px]">{col.name}</span>
                          </span>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => (
                    <tr key={rowIdx} className={rowIdx % 2 === 0 ? "bg-muted/10" : ""}>
                      {columns.map((col, colIdx) => {
                        const cell = row[colIdx] ?? ""
                        const colType = col.type ?? "text"
                        return (
                          <td key={col.id} className="px-1.5 py-0.5 align-middle border-b border-border/20">
                            {colType === "image-url" && cell ? (
                              <CachedImage
                                src={cell}
                                alt=""
                                thumbnail
                                thumbnailWidth={48}
                                className="w-6 h-6 object-cover rounded"
                              />
                            ) : colType === "video-url" || colType === "audio-url" ? (
                              <span className="text-muted-foreground/60 italic">
                                {cell ? "media" : "—"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground truncate block max-w-[80px]" title={cell}>
                                {cell || "—"}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {statusText}
              </p>
              {columns.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {columns.map((col) => {
                    const colColor = LOOP_COLUMN_TYPE_META[col.type ?? "text"]?.color ?? "#38BDF8"
                    return (
                      <span key={col.id} className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                        style={{
                          background: `${colColor}20`,
                          color: colColor,
                        }}>
                        {col.name}
                      </span>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </BaseNode>
      {hasTarget && <HandleIcon icon={<Type />} side="left" top="calc(100% - 20px)" />}
      {sourceHandles.map((h) => {
        const col = columns.find((c) => c.handleId === h.id)
        const colType = col?.type ?? "text"
        const icon = colType === "image-url" ? <Image />
          : colType === "video-url" ? <Film />
          : colType === "audio-url" ? <Music />
          : <Type />
        const colorMap: Record<string, "pink" | "indigo" | "green" | "cyan"> = {
          "image-url": "pink",
          "video-url": "indigo",
          "audio-url": "green",
          "text": "cyan",
        }
        return (
          <HandleIcon key={h.id} icon={icon} color={colorMap[colType] ?? "cyan"} top={h.top} />
        )
      })}
    </div>
  )
}

export const LoopNode = memo(LoopNodeComponent)
