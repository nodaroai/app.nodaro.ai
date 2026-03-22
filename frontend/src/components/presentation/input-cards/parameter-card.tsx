import { Clock, Ruler, Ratio, Sliders } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SceneNodeType } from "@/types/nodes"
import { GlassCard } from "../output-cards/shared"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import type { PromptContext } from "@/lib/prompt-context"

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
  promptHelper?: PromptContext
}

/** Get the primary value field name for a parameter node type */
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
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <span className="text-muted-foreground/50">{getTypeIcon(nodeType)}</span>
          {label}
        </label>
        {promptHelper && ENHANCEABLE_PARAM_TYPES.has(nodeType) && (
          <PromptHelperButton
            nodeType={promptHelper.nodeType}
            currentPrompt={currentValue}
            provider={promptHelper.provider}
            aspectRatio={promptHelper.aspectRatio}
            duration={promptHelper.duration}
            onAccept={handleChange}
          />
        )}
      </div>
      <input
        type="text"
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Enter ${label.toLowerCase()}...`}
        readOnly={readOnly}
        className={`w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200${readOnly ? " opacity-70 cursor-default" : ""}`}
      />
    </GlassCard>
  )
}
