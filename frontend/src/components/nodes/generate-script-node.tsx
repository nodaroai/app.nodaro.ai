"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { BookOpen, Loader2, AlertCircle, X, Play, FileText } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { GenerateScriptData, GeneratedScriptResult } from "@/types/nodes"

function GenerateScriptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateScriptData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeScript = activeResult?.script ?? nodeData.generatedScript

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedScript: newResults[newActiveIndex]?.script,
    })
  }

  return (
    <div className="relative group/run">
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<BookOpen className="h-4 w-4" />}
      category="ai"
      credits={2}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "scenes", type: "source", position: Position.Right, label: "Scenes" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && !activeScript && (
          <div className="flex items-center justify-center h-16 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {activeScript && (
          <div className="relative group">
            <div className="rounded-md bg-muted/30 p-2 text-xs space-y-1">
              {status === "running" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md z-10">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <div className="font-medium truncate max-w-[180px]">{activeScript.title}</div>
              <div className="text-muted-foreground">
                {activeScript.scenes.length} scenes / {activeScript.totalDuration}s
              </div>
              {activeScript.scenes.slice(0, 3).map((scene) => (
                <div key={scene.sceneNumber} className="truncate max-w-[180px] text-muted-foreground/70">
                  {scene.sceneNumber}. {scene.action}
                </div>
              ))}
              {activeScript.scenes.length > 3 && (
                <div className="text-muted-foreground/50">+{activeScript.scenes.length - 3} more</div>
              )}
            </div>
            {results.length > 0 && (
              <button
                type="button"
                className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteResult(activeIndex)
                }}
                title="Delete this result"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {status === "failed" && !activeScript && (
          <div className="flex items-center justify-center gap-1.5 h-16 rounded-md bg-red-500/5 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>Failed</span>
          </div>
        )}

        {status !== "running" && !activeScript && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <BookOpen className="w-5 h-5" />
          </div>
        )}

        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={r.jobId} className="relative group/thumb shrink-0">
                <button
                  type="button"
                  className={`w-8 h-8 flex items-center justify-center rounded cursor-pointer transition-opacity ${
                    i === activeIndex
                      ? "opacity-100 ring-2 ring-primary bg-primary/20"
                      : "opacity-50 hover:opacity-80 bg-muted"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, { activeResultIndex: i, generatedScript: r.script })
                  }}
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteResult(i)
                  }}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between text-muted-foreground">
          <span>{nodeData.provider}</span>
          <span>{nodeData.sceneCount} scenes</span>
        </div>
      </div>
    </BaseNode>
    {status !== "running" && (
      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/run:opacity-100 transition-opacity">
        <button
          type="button"
          className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-b-md shadow-md transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            runSingleNode?.(id)
          }}
          title="Run this node only"
        >
          <Play className="w-3 h-3" />
          Run
        </button>
      </div>
    )}
    </div>
  )
}

export const GenerateScriptNode = memo(GenerateScriptNodeComponent)
