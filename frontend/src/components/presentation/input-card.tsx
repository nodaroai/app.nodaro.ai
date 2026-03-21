import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode } from "@/types/nodes"
import { getNodeLabel } from "@/lib/presentation-utils"
import { CONFIG_INPUT_TYPES } from "./node-config-modal"
import { TextInputCard } from "./input-cards/text-input-card"
import { ImageUploadCard } from "./input-cards/image-upload-card"
import { VideoUploadCard } from "./input-cards/video-upload-card"
import { AudioUploadCard } from "./input-cards/audio-upload-card"
import { ParameterCard } from "./input-cards/parameter-card"
import { ListInputCard } from "./input-cards/list-input-card"
import { LoopInputCard } from "./input-cards/loop-input-card"

/** System-wide ceiling for fan-out items. Will be fetched from app_settings in future. */
export const DEFAULT_SYSTEM_MAX_FANOUT = 20

export interface InputCardProps {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  onOpenMedia?: (nodeId: string) => void
  onOpenConfig?: (node: WorkflowNode) => void
  refMap?: Map<string, string>
}

/** Renders the appropriate input card based on node type */
export function InputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  onOpenMedia,
  onOpenConfig,
  refMap,
}: InputCardProps) {
  const label = getNodeLabel(node)
  const data = node.data as Record<string, unknown>
  const effectiveMaxItems = Math.min((data.maxItems as number) ?? 10, DEFAULT_SYSTEM_MAX_FANOUT)

  // Config-type nodes open a modal with their full config panel
  if (node.type && CONFIG_INPUT_TYPES.has(node.type)) {
    return (
      <button
        type="button"
        onClick={() => onOpenConfig?.(node)}
        className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Click to configure</p>
      </button>
    )
  }

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
          readOnly={readOnly}
          refMap={refMap}
          presentationReadOnly={!!(node.data as Record<string, unknown>).presentationReadOnly}
        />
      )

    case "upload-image":
      return (
        <ImageUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
          onOpenMedia={onOpenMedia}
        />
      )

    case "upload-video":
      return (
        <VideoUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
        />
      )

    case "upload-audio":
      return (
        <AudioUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
        />
      )

    case "list":
      return (
        <ListInputCard
          node={node}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
          maxItems={effectiveMaxItems}
        />
      )

    case "loop":
      return (
        <LoopInputCard
          node={node}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
          maxItems={effectiveMaxItems}
        />
      )

    default:
      return (
        <ParameterCard
          nodeId={node.id}
          label={label}
          nodeType={node.type!}
          data={data}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
        />
      )
  }
}
