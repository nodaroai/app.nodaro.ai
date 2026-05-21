"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Eye, Image as ImageIcon, FileText, Check, X } from "lucide-react"
import { createPortal } from "react-dom"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { ImageCriticData } from "@/types/nodes"

interface ImageCriticDetailsModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly data: ImageCriticData
}

function ImageCriticDetailsModal({ isOpen, onClose, data }: ImageCriticDetailsModalProps) {
  if (!isOpen) return null
  const score = data.score
  const approved = data.approved
  const feedback = data.feedback
  const perMode = data.details?.perMode
  const issues = data.details?.issues

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-background rounded-lg border border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              Image Critic — Score: {score !== undefined ? score.toFixed(2) : "—"}{" "}
              <span className={approved ? "text-green-500" : "text-red-500"}>
                ({approved ? "Approved" : "Rejected"})
              </span>
            </span>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
            aria-label="Close details"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          {feedback && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Feedback</div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{feedback}</p>
            </div>
          )}
          {perMode && Object.keys(perMode).length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Per-mode breakdown
              </div>
              <ul className="text-xs space-y-1">
                {Object.entries(perMode).map(([m, r]) =>
                  r ? (
                    <li key={m}>
                      <strong>{m}:</strong> {r.score.toFixed(2)} — {r.feedback}
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}
          {issues && issues.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Issues</div>
              <ul className="text-xs space-y-1">
                {issues.map((i, idx) => (
                  <li key={idx}>
                    <span
                      className={
                        i.severity === "blocking"
                          ? "text-red-500"
                          : i.severity === "warning"
                            ? "text-orange-500"
                            : "text-muted-foreground"
                      }
                    >
                      [{i.severity}]
                    </span>{" "}
                    {i.category}: {i.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ImageCriticNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageCriticData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const credits = useModelCredits(
    buildLlmCreditIdentifier("image-critic", nodeData.llmModel || LLM_FEATURE_DEFAULTS["image-critic"]),
    1,
  )
  const [modalOpen, setModalOpen] = useState(false)

  const score = nodeData.score
  const approved = nodeData.approved
  const feedback = nodeData.feedback
  const hasResult = score !== undefined && approved !== undefined

  return (
    <div className="relative" style={{ maxWidth: "240px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Eye className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Eye className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={240}
        topToolbarContent={
          <RunNodeButton
            nodeId={id}
            credits={credits}
            isRunning={status === "running"}
            onRun={(nid) => runSingleNode?.(nid)}
          />
        }
        handles={[
          {
            id: "image",
            type: "target",
            position: Position.Left,
            hideHandle: true,
            customStyle: { top: "30%", left: "-29px" },
          },
          {
            id: "reference",
            type: "target",
            position: Position.Left,
            hideHandle: true,
            customStyle: { top: "50%", left: "-29px" },
          },
          {
            id: "prompt",
            type: "target",
            position: Position.Left,
            hideHandle: true,
            customStyle: { top: "70%", left: "-29px" },
          },
          {
            id: "approved",
            type: "source",
            position: Position.Right,
            label: "Approved",
            hideHandle: true,
            customStyle: { top: "35%", right: "-29px" },
          },
          {
            id: "rejected",
            type: "source",
            position: Position.Right,
            label: "Rejected",
            hideHandle: true,
            customStyle: { top: "65%", right: "-29px" },
          },
        ]}
      >
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mode: {nodeData.mode ?? "realism"}
          </div>
          {hasResult ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              aria-label={`Score: ${score!.toFixed(2)}, ${approved ? "approved" : "rejected"}. Click for details.`}
              className={`block w-full rounded-md p-2 text-left text-xs transition-colors ${
                approved
                  ? "bg-green-500/15 hover:bg-green-500/25"
                  : "bg-red-500/15 hover:bg-red-500/25"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base font-bold">{score!.toFixed(2)}</span>
                <span
                  className={`text-[10px] font-medium uppercase ${
                    approved ? "text-green-500" : "text-red-500"
                  }`}
                >
                  {approved ? "Approved" : "Rejected"}
                </span>
              </div>
              {feedback && (
                <div className="mt-1 line-clamp-2 text-muted-foreground">{feedback}</div>
              )}
            </button>
          ) : (
            <div className="rounded-md bg-muted/20 p-2 text-xs italic text-muted-foreground/60">
              Not yet evaluated
            </div>
          )}
        </div>
      </BaseNode>
      {/* Input handle icons (left side) */}
      <HandleIcon icon={<ImageIcon />} color="pink" side="left" top="30%" label="Image" />
      <HandleIcon icon={<ImageIcon />} color="pink" side="left" top="50%" label="Reference" />
      <HandleIcon icon={<FileText />} color="pink" side="left" top="70%" label="Prompt" />
      {/* Output handle icons (right side) */}
      <HandleIcon icon={<Check />} color="green" top="35%" />
      <HandleIcon icon={<X />} color="red" top="65%" />
      <ImageCriticDetailsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        data={nodeData}
      />
    </div>
  )
}

export const ImageCriticNode = memo(ImageCriticNodeComponent)
