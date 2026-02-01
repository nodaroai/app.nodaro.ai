"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import type { GenerateImageData } from "@/types/nodes"

function GenerateImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateImageData
  const status = nodeData.executionStatus ?? "idle"
  const imageUrl = nodeData.generatedImageUrl
  const results = nodeData.generatedResults ?? []
  const olderResults = results.slice(1)

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="ai"
      credits={5}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "image", type: "source", position: Position.Right, label: "Image" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex items-center justify-center h-28 rounded-md bg-muted/30">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {status === "completed" && imageUrl && (
          <img
            src={imageUrl}
            alt="Generated"
            className="w-full h-28 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              window.open(imageUrl, "_blank")
            }}
          />
        )}

        {status === "failed" && (
          <div className="flex items-center justify-center gap-1.5 h-28 rounded-md bg-red-500/5 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>Failed</span>
          </div>
        )}

        {status === "idle" && (
          <div className="flex items-center justify-center h-28 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <ImageIcon className="w-6 h-6" />
          </div>
        )}

        {olderResults.length > 0 && (
          <div className="flex gap-1 overflow-x-auto">
            {olderResults.slice(0, 4).map((r) => (
              <img
                key={r.jobId}
                src={r.url}
                alt="Previous"
                className="w-10 h-10 object-cover rounded cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(r.url, "_blank")
                }}
              />
            ))}
          </div>
        )}

        <div className="flex justify-between text-muted-foreground">
          <span>{nodeData.provider}</span>
          <span>{nodeData.aspectRatio}</span>
        </div>
      </div>
    </BaseNode>
  )
}

export const GenerateImageNode = memo(GenerateImageNodeComponent)
