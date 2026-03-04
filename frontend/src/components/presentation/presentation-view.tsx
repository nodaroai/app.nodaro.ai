/**
 * PresentationView — core layout for presentation mode.
 * Two-column responsive grid: inputs (left), outputs (right).
 * Works in both "tab" mode (inside editor) and "fullscreen" mode (shared link).
 */

import { useMemo, useCallback } from "react"
import { Play, Loader2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CreditBalance } from "@/components/credits/CreditBalance"
import { hasCredits } from "@/lib/edition"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import type { WorkflowNode } from "@/types/nodes"
import {
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeLabel,
  getNodeResult,
} from "@/lib/presentation-utils"
import { ShareDialog } from "./share-dialog"
import { TextInputCard } from "./input-cards/text-input-card"
import { ImageUploadCard } from "./input-cards/image-upload-card"
import { VideoUploadCard } from "./input-cards/video-upload-card"
import { AudioUploadCard } from "./input-cards/audio-upload-card"
import { ParameterCard } from "./input-cards/parameter-card"
import { ImageOutputCard } from "./output-cards/image-output-card"
import { VideoOutputCard } from "./output-cards/video-output-card"
import { AudioOutputCard } from "./output-cards/audio-output-card"
import { TextOutputCard } from "./output-cards/text-output-card"

interface PresentationViewProps {
  mode: "tab" | "fullscreen"
  isOwner: boolean
  onExitFullscreen?: () => void
}

export function PresentationView({ mode, isOwner, onExitFullscreen }: PresentationViewProps) {
  const { user } = useAuth()

  // Tab mode: read from the editor store
  const editorNodes = useWorkflowStore((s) => s.nodes)
  const editorEdges = useWorkflowStore((s) => s.edges)
  const editorName = useWorkflowStore((s) => s.workflowName)
  const workflowId = useWorkflowStore((s) => s.workflowId)

  // Fullscreen mode: read from presentation store
  const presNodes = usePresentationStore((s) => s.nodes)
  const presEdges = usePresentationStore((s) => s.edges)
  const presName = usePresentationStore((s) => s.workflowName)
  const presStatus = usePresentationStore((s) => s.executionStatus)
  const presNodeStates = usePresentationStore((s) => s.nodeStates)
  const presRun = usePresentationStore((s) => s.run)
  const presInputValues = usePresentationStore((s) => s.inputValues)
  const presUpdateInput = usePresentationStore((s) => s.updateInputValue)

  const isFullscreen = mode === "fullscreen"
  const nodes = isFullscreen ? presNodes : editorNodes
  const edges = isFullscreen ? presEdges : editorEdges
  const workflowName = isFullscreen ? presName : editorName

  const inputNodes = useMemo(() => getInputNodes(nodes), [nodes])
  const outputNodes = useMemo(() => getOutputNodes(nodes, edges), [nodes, edges])

  // Tab mode: use editor execution state
  const isEditorRunning = useWorkflowStore((s) => {
    if (isFullscreen) return false
    // Check if any node has executionStatus === "running"
    return s.nodes.some((n) => {
      const data = n.data as Record<string, unknown>
      return data.executionStatus === "running" || data.executionStatus === "loading"
    })
  })

  const isRunning = isFullscreen ? presStatus === "running" : isEditorRunning

  const handleRunClick = useCallback(() => {
    if (isFullscreen) {
      presRun()
    } else {
      // In tab mode, we use the same run handler as the editor
      // This is handled by the parent component
    }
  }, [isFullscreen, presRun])

  // Get node execution status for output cards
  const getNodeStatus = useCallback(
    (nodeId: string): "idle" | "running" | "completed" | "failed" => {
      if (isFullscreen) {
        const state = presNodeStates[nodeId]
        if (!state) return "idle"
        if (state.status === "running") return "running"
        if (state.status === "completed") return "completed"
        if (state.status === "failed") return "failed"
        return "idle"
      }
      // Tab mode: check node data
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return "idle"
      const data = node.data as Record<string, unknown>
      const status = data.executionStatus as string | undefined
      if (status === "running" || status === "loading") return "running"
      if (status === "complete" || status === "completed") return "completed"
      if (status === "error") return "failed"
      return "idle"
    },
    [isFullscreen, presNodeStates, nodes],
  )

  // For fullscreen mode, get results from nodeStates output
  const getFullscreenResult = useCallback(
    (nodeId: string) => {
      const state = presNodeStates[nodeId]
      if (!state?.output) return { url: undefined, text: undefined }
      const output = state.output as Record<string, unknown>
      const url = (output.imageUrl ?? output.videoUrl ?? output.audioUrl) as string | undefined
      const text = output.text as string | undefined
      return { url, text }
    },
    [presNodeStates],
  )

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-[#121212]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-14 border-b border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold truncate">{workflowName || "Untitled"}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {user && hasCredits() && <CreditBalance userId={user.id} />}

          {isOwner && mode === "tab" && workflowId && (
            <ShareDialog workflowId={workflowId} />
          )}

          {mode === "tab" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExitFullscreen}
              title="Open in new tab"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}

          {isRunning ? (
            <Button
              size="sm"
              className="text-white"
              style={{ backgroundColor: "#ff0073" }}
              disabled
            >
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running...
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleRunClick}
              className="text-white hover:opacity-90"
              style={{ backgroundColor: "#ff0073" }}
              disabled={!isFullscreen && mode === "tab"}
            >
              <Play className="h-4 w-4 mr-2" />
              Run
            </Button>
          )}
        </div>
      </div>

      {/* Content: inputs left, outputs right */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Inputs */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Inputs
            </h2>
            {inputNodes.length === 0 ? (
              <div className="text-sm text-gray-400 dark:text-gray-500 p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-center">
                No input nodes found in this workflow
              </div>
            ) : (
              inputNodes.map((node) => (
                <InputCard
                  key={node.id}
                  node={node}
                  isFullscreen={isFullscreen}
                  inputValues={presInputValues}
                  onUpdateInput={presUpdateInput}
                />
              ))
            )}
          </div>

          {/* Outputs */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Outputs
            </h2>
            {outputNodes.length === 0 ? (
              <div className="text-sm text-gray-400 dark:text-gray-500 p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-center">
                No output nodes found in this workflow
              </div>
            ) : (
              outputNodes.map((node) => {
                const outputType = getOutputType(node.type)
                const status = getNodeStatus(node.id)
                const label = getNodeLabel(node)

                // Get result from either fullscreen nodeStates or editor node data
                const result = isFullscreen
                  ? getFullscreenResult(node.id)
                  : getNodeResult(node.data as Record<string, unknown>)

                return (
                  <OutputCard
                    key={node.id}
                    label={label}
                    outputType={outputType}
                    status={status}
                    url={result.url}
                    text={result.text}
                  />
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Renders the appropriate input card based on node type */
function InputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
}: {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
}) {
  const label = getNodeLabel(node)
  const data = node.data as Record<string, unknown>

  switch (node.type) {
    case "text-prompt":
      return (
        <TextInputCard
          label={label}
          value={isFullscreen ? (inputValues[node.id]?.text as string ?? data.text as string ?? "") : (data.text as string ?? "")}
          placeholder={(data.placeholder as string) ?? "Enter text..."}
          onChange={(val) => {
            if (isFullscreen) {
              onUpdateInput(node.id, "text", val)
            } else {
              useWorkflowStore.getState().updateNodeData(node.id, { text: val })
            }
          }}
        />
      )

    case "upload-image":
      return (
        <ImageUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
        />
      )

    case "upload-video":
      return (
        <VideoUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
        />
      )

    case "upload-audio":
      return (
        <AudioUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
        />
      )

    default:
      // Parameter nodes (tone, style-guide, provider, etc.)
      return (
        <ParameterCard
          nodeId={node.id}
          label={label}
          nodeType={node.type!}
          data={data}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
        />
      )
  }
}

/** Renders the appropriate output card based on output type */
function OutputCard({
  label,
  outputType,
  status,
  url,
  text,
}: {
  label: string
  outputType: string
  status: "idle" | "running" | "completed" | "failed"
  url?: string
  text?: string
}) {
  switch (outputType) {
    case "image":
      return <ImageOutputCard label={label} status={status} url={url} />
    case "video":
      return <VideoOutputCard label={label} status={status} url={url} />
    case "audio":
      return <AudioOutputCard label={label} status={status} url={url} />
    case "text":
      return <TextOutputCard label={label} status={status} text={text} />
    default:
      return <TextOutputCard label={label} status={status} text={text ?? url} />
  }
}
