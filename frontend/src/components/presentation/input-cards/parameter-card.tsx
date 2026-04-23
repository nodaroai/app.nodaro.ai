import { Clock, Ruler, Ratio, Sliders } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SceneNodeType, InputMode } from "@/types/nodes"
import type { PromptContext } from "@/lib/prompt-context"
import { PresentationTextInput } from "./shared"

/** Only show prompt helper for text-type parameter nodes */
const ENHANCEABLE_PARAM_TYPES = new Set(["tone", "style-guide"])

interface ParameterCardProps {
  nodeId: string
  label: string
  nodeType: SceneNodeType
  data: Record<string, unknown>
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  inputMode?: InputMode
  minLines?: number
  promptHelper?: PromptContext
}

function getValueField(nodeType: SceneNodeType): string {
  switch (nodeType) {
    case "tone": return "tone"
    case "style-guide": return "styleGuide"
    case "provider": return "provider"
    case "scene-count": return "count"
    case "duration": return "duration"
    case "aspect-ratio": return "aspectRatio"
    case "motion": return "motion"
    case "camera-motion": return "cameraMotion"
    case "framing": return "framing"
    case "lens": return "lens"
    case "camera-format": return "cameraFormat"
    case "lighting": return "lighting"
    case "color-look": return "colorLook"
    case "atmosphere": return "atmosphere"
    case "temporal": return "temporal"
    default: return "value"
  }
}

function getTypeIcon(nodeType: SceneNodeType) {
  switch (nodeType) {
    case "duration": return <Clock className="w-3.5 h-3.5" />
    case "aspect-ratio": return <Ratio className="w-3.5 h-3.5" />
    case "scene-count": return <Ruler className="w-3.5 h-3.5" />
    default: return <Sliders className="w-3.5 h-3.5" />
  }
}

export function ParameterCard({
  nodeId,
  label,
  nodeType,
  data,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  inputMode,
  minLines,
  promptHelper,
}: ParameterCardProps) {
  const field = getValueField(nodeType)
  const currentValue = isFullscreen
    ? (inputValues[nodeId]?.[field] as string ?? data[field] as string ?? "")
    : (data[field] as string ?? "")

  const handleChange = (value: string) => {
    if (isFullscreen) {
      onUpdateInput(nodeId, field, value)
    } else {
      useWorkflowStore.getState().updateNodeData(nodeId, { [field]: value })
    }
  }

  return (
    <PresentationTextInput
      label={label}
      value={currentValue}
      placeholder={`Enter ${label.toLowerCase()}...`}
      onChange={handleChange}
      readOnly={readOnly}
      mode={inputMode ?? "oneline"}
      minLines={minLines}
      icon={<span className="text-muted-foreground/50">{getTypeIcon(nodeType)}</span>}
      promptHelper={ENHANCEABLE_PARAM_TYPES.has(nodeType) ? promptHelper : undefined}
    />
  )
}
