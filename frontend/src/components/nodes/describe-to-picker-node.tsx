"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Image as ImageIcon, ScanFace, AlertCircle } from "lucide-react"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { NodeJobProgress } from "./node-job-progress"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { isValidImageToTextConnection } from "@/lib/image-producer-handles"
import type { DescribeToPickerData } from "@/types/nodes"

const ACCEPTS_IMAGE = (t: string) => isValidImageToTextConnection("image", t)

function DescribeToPickerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as DescribeToPickerData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const credits = useModelCredits(
    buildLlmCreditIdentifier("describe-to-picker", nodeData.llmModel || LLM_FEATURE_DEFAULTS["describe-to-picker"], nodeData.reasoningEffort),
    1,
  )
  const status = nodeData.executionStatus ?? "idle"
  const picker = nodeData.generatedPickerJson
  const detected = picker ? Object.keys(picker).length : 0

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ScanFace className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ScanFace className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={240}
        minHeight={150}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
        }
        handles={[
          { id: "image", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "picker-json", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col items-center justify-center gap-2 p-3 text-center h-full">
          <ScanFace className="w-6 h-6 text-muted-foreground" />
          {status === "running" ? (
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          ) : status === "failed" ? (
            <div className="flex flex-col items-center gap-1 text-red-500">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="text-xs font-medium">Analysis failed</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          ) : detected > 0 ? (
            <p className="text-sm font-medium text-foreground">Detected {detected} traits</p>
          ) : (
            <p className="text-xs text-muted-foreground">Connect an image, then run</p>
          )}
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">&rarr; Person</p>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="describe-to-picker" handleId="image" type="target" position={Position.Left} label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_IMAGE} />
      <HandleWithPopover nodeId={id} nodeType="describe-to-picker" handleId="picker-json" type="source" position={Position.Right} label="Picker JSON" color={HANDLE_COLORS.pickerJson} icon={<ScanFace />} side="right" top="24px" />
    </div>
  )
}

export const DescribeToPickerNode = memo(DescribeToPickerNodeComponent)
