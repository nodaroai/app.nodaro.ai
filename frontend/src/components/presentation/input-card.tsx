import { memo, useMemo, lazy, Suspense } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode, PresentationDisplay, InputMode } from "@/types/nodes"
import { getNodeLabel } from "@/lib/presentation-utils"
import { CONFIG_INPUT_TYPES } from "./node-config-modal"
import { TextInputCard } from "./input-cards/text-input-card"
import { ImageUploadCard } from "./input-cards/image-upload-card"
import { VideoUploadCard } from "./input-cards/video-upload-card"
import { AudioUploadCard } from "./input-cards/audio-upload-card"
import { ParameterCard } from "./input-cards/parameter-card"
import { ListInputCard } from "./input-cards/list-input-card"
import { LoopInputCard } from "./input-cards/loop-input-card"
import { isParameterPickerNode } from "@/lib/parameter-picker-types"
import { inferPromptContext } from "@/lib/prompt-context"
import { hasCredits } from "@/lib/edition"
import { isMultiColumnList } from "@/lib/list-loop-migration"

// Lazy-load the picker card: it pulls the full parameter-picker registry (~40
// catalogs, incl. person.ts) which would otherwise bloat the public app-runner
// chunk even for apps with zero picker nodes. The branch below is gated by
// isParameterPickerNode(), so the chunk only loads when a picker node renders.
const PickerInputCard = lazy(() =>
  import("./input-cards/picker-input-card").then((m) => ({ default: m.PickerInputCard })),
)

// Lazy-load the ai-avatar card: pulls in the HeyGen avatar+voice pickers
// which import @tanstack/react-virtual and the catalog fetchers — keep them
// out of the main app-runner chunk for apps that don't use ai-avatar nodes.
const AiAvatarInputCard = lazy(() =>
  import("./input-cards/ai-avatar-input-card").then((m) => ({ default: m.AiAvatarInputCard })),
)

/** System-wide ceiling for fan-out items. Will be fetched from app_settings in future. */
export const DEFAULT_SYSTEM_MAX_FANOUT = 20

export type { InputMode }

export interface InputCardProps {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  onOpenMedia?: (nodeId: string) => void
  onOpenConfig?: (node: WorkflowNode) => void
  refMap?: Map<string, string>
  display?: PresentationDisplay
  inputMode?: InputMode
  minLines?: number
  nodes?: Array<{ id: string; type?: string; data: Record<string, unknown> }>
  edges?: Array<{ source: string; target: string }>
}

/** Renders the appropriate input card based on node type */
function InputCardInner({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  onOpenMedia,
  onOpenConfig,
  refMap,
  display,
  inputMode,
  minLines,
  nodes,
  edges,
}: InputCardProps) {
  const label = getNodeLabel(node)
  const data = node.data as Record<string, unknown>
  const effectiveMaxItems = Math.min((data.maxItems as number) ?? 10, DEFAULT_SYSTEM_MAX_FANOUT)
  const cardMeta = useWorkflowStore((s) => s.presentationSettings.cardMeta?.[node.id])

  const promptContext = useMemo(
    () => (nodes && edges ? inferPromptContext(node.id, nodes, edges) : null),
    [node.id, nodes, edges],
  )

  const showPromptHelper = data.presentationPromptHelper !== false
  const promptHelperProp = promptContext && !readOnly && hasCredits() && showPromptHelper ? promptContext : undefined

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
    case "text-prompt": {
      const textValue = isFullscreen ? (inputValues[node.id]?.text as string ?? data.text as string ?? "") : (data.text as string ?? "")
      const isPresReadOnly = !!data.presentationReadOnly
      return (
        <TextInputCard
          label={label}
          value={textValue}
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
          presentationReadOnly={isPresReadOnly}
          inputMode={inputMode}
          minLines={minLines}
          promptHelper={isPresReadOnly ? undefined : promptHelperProp}
        />
      )
    }

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

    // Card chosen by column count (see isMultiColumnList), not node type:
    // multi-column → LoopInputCard (table), single-column → ListInputCard.
    // (loop→list is migrated on every load path, so the old `case "loop"` is gone.)
    case "list": {
      return isMultiColumnList(data) ? (
        <LoopInputCard
          node={node}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
          maxItems={effectiveMaxItems}
          display={display}
          promptHelper={promptHelperProp}
        />
      ) : (
        <ListInputCard
          node={node}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
          maxItems={effectiveMaxItems}
          promptHelper={promptHelperProp}
        />
      )
    }

    case "ai-avatar":
      return (
        <Suspense fallback={null}>
          <AiAvatarInputCard
            node={node}
            isFullscreen={isFullscreen}
            inputValues={inputValues}
            onUpdateInput={onUpdateInput}
            readOnly={readOnly}
          />
        </Suspense>
      )

    default: {
      // Parameter pickers (setting, mood, animal, etc.) get their own
      // visual picker card with optional inline/modal display + allowedValues
      // restriction set in the editor's cardMeta.
      if (isParameterPickerNode(node.type)) {
        return (
          <Suspense fallback={null}>
            <PickerInputCard
              nodeId={node.id}
              label={label}
              nodeType={node.type!}
              data={data}
              isFullscreen={isFullscreen}
              inputValues={inputValues}
              onUpdateInput={onUpdateInput}
              readOnly={readOnly}
              displayMode={cardMeta?.pickerMode ?? "inline"}
              allowedValues={cardMeta?.pickerAllowedValues}
            />
          </Suspense>
        )
      }
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
          inputMode={inputMode}
          minLines={minLines}
          promptHelper={promptHelperProp}
        />
      )
    }
  }
}

/**
 * Memoized so a keystroke in one input card doesn't re-render every other card.
 * The parent passes each card a STABLE per-node `inputValues` slice (a single-key
 * map cached per node id) plus referentially-stable `onUpdateInput`/callbacks, so
 * untouched cards bail out of reconciliation. Cards that read only `node`/`data`
 * stay stable across poll-driven re-renders too.
 */
export const InputCard = memo(InputCardInner)
